# -*- coding: utf-8 -*-
"""
Монгол хадмал — локал сервер.

Chrome өргөтгөл тоглуулж буй видеог мэдэгдэнэ → сервер видеог танина (yt-dlp),
дууг нь тоглуулж буй хэсгээс ТҮРҮҮЛЖ боловсруулна (Whisper, видео карт дээр),
монгол руу орчуулаад видеоны цагтай нь тааруулсан хадмал өргөтгөл рүү буцаана.
Видео өөрөө хадмалтай бол (YouTube гэх мэт) тэр хадмалыг шууд орчуулна.
"""
import os
import sys
import re
import glob
import json
import html
import time
import hashlib
import threading
import queue
import traceback
import subprocess
import urllib.request
import urllib.parse
import urllib.error
from collections import deque
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import numpy as np

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
import warnings
warnings.filterwarnings("ignore", module="huggingface_hub")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(ROOT, "cache")

# ======================= ТОХИРГОО =======================
PORT = 8765
WHISPER_MODEL = "large-v3-turbo"   # удаан бол "medium"
DEVICE = "cuda"                    # видео картын алдаа гарвал "cpu"
COMPUTE_TYPE = "int8_float16"      # GTX 1660 Ti-д тохиромжтой
CLAUDE_MODEL = "claude-haiku-4-5"  # api_key.txt байвал Claude-аар орчуулна
GEMINI_MODEL = ""  # хоосон бол автоматаар сонгоно  # gemini_key.txt байвал Gemini-аар орчуулна
GEMINI_MIN_INTERVAL = 4.0          # үнэгүй эрх (flash-lite): минутад ~15 хүсэлт; хэтэрвэл загвар солигдоно
VIDEO_THREADS = ("hm-worker", "hm-refiner", "hm-resolve")
_VIDEO_WAIT = [0]                  # видеоны хадмал хүлээж буй тоо — текст орчуулга тэднийг түрүүлүүлнэ
VERSION = "1.11.0"  # шинэчлэл бүрт нэмэгдүүлнэ (өргөтгөлийн manifest.json-тэй ижил)
GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions"  # Copilot / GitHub Models
# нөөц хаяг (хуучин GitHub Models endpoint; загварын нэрийг "openai/"-гүйгээр авна)
GITHUB_MODELS_URLS = [GITHUB_MODELS_URL, "https://models.inference.ai.azure.com/chat/completions"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """POST хүсэлтийг өөр хаяг руу (GET болгон) чимээгүй дамжуулахыг хориглоно."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_GH_OPENER = urllib.request.build_opener(_NoRedirect)
GITHUB_MODELS = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "openai/gpt-4.1", "openai/gpt-4o"]
GITHUB_MODELS_PRO = ["openai/gpt-4.1", "openai/gpt-4o", "openai/gpt-4.1-mini", "openai/gpt-4o-mini"]
LOOKAHEAD = 300                    # тоглуулж буй хэсгээс хэдэн секунд түрүүлж бэлдэх
IDLE_UNLOAD_SEC = 600              # 10 мин видео үзээгүй бол видео картын санах ойг чөлөөлнө
# ========================================================

SR = 16000
CHUNK = 28.0    # нэг удаад боловсруулах хэсэг (сек)
FIRST_CHUNK = 8.0  # эхлэх/гүйлгэх үеийн эхний богино хэсэг
WINDOW = 35.0   # өгүүлбэр тасрахгүйн тулд арай урт уншина


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


_DLL_HANDLES = []
VC_REDIST_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe"


def gpu_report():
    """Видео карт, драйверийн хувилбарыг лог-д бичнэ (Windows, NVIDIA)."""
    import ctypes
    try:
        cuda = ctypes.WinDLL("nvcuda.dll")
        v = ctypes.c_int()
        cuda.cuDriverGetVersion(ctypes.byref(v))
        log(f"Драйверийн дэмждэг CUDA хувилбар: {v.value // 1000}.{v.value % 1000 // 10}")
    except OSError:
        log("!!! nvcuda.dll олдсонгүй — NVIDIA драйвер суугаагүй байж магадгүй")
    try:
        nvml = ctypes.WinDLL("nvml.dll")
        if nvml.nvmlInit_v2() == 0:
            buf = ctypes.create_string_buffer(96)
            nvml.nvmlSystemGetDriverVersion(buf, 96)
            h = ctypes.c_void_p()
            name = ""
            if nvml.nvmlDeviceGetHandleByIndex_v2(0, ctypes.byref(h)) == 0:
                nb = ctypes.create_string_buffer(96)
                nvml.nvmlDeviceGetName(h, nb, 96)
                name = nb.value.decode()
            log(f"Видео карт: {name} · драйвер {buf.value.decode()}")
    except Exception as e:
        log("nvml мэдээлэл авч чадсангүй:", e)
    try:
        import ctranslate2
        log(f"ctranslate2 {ctranslate2.__version__} · CUDA төхөөрөмж: {ctranslate2.get_cuda_device_count()}")
    except Exception as e:
        log("ctranslate2 шалгах алдаа:", e)


def add_cuda_dlls():
    """Windows: шаардлагатай DLL-үүдийг шалгаж, видео картын сангуудыг урьдчилан ачаална."""
    if sys.platform != "win32":
        return
    import ctypes
    STATE["missing_vc"] = False
    for name in ("msvcp140.dll", "vcruntime140_1.dll"):
        try:
            _DLL_HANDLES.append(ctypes.WinDLL(name))
        except OSError:
            STATE["missing_vc"] = True
            log(f"!!! {name} олдсонгүй — Visual C++ Redistributable суулгана уу: {VC_REDIST_URL}")
    try:
        import nvidia
        for base in list(nvidia.__path__):
            for bindir in glob.glob(os.path.join(base, "*", "bin")):
                _DLL_HANDLES.append(os.add_dll_directory(bindir))
                os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
                for dll in ("cublasLt64_12.dll", "cublas64_12.dll"):
                    p = os.path.join(bindir, dll)
                    if os.path.exists(p):
                        try:
                            _DLL_HANDLES.append(ctypes.WinDLL(p))
                            log(f"Ачааллаа: {dll}")
                        except OSError as e:
                            log(f"!!! {dll} ачаалж чадсангүй: {e}")
    except Exception as e:
        log("nvidia сангууд олдсонгүй:", e)
    gpu_report()


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


FFMPEG = find_ffmpeg()

# ---------------------------------------------------------------- орчуулга
SYSTEM_PROMPT = (
    "You are a professional subtitle translator. Translate spoken lines from movies and "
    "online videos into natural, colloquial Mongolian (Cyrillic script), the way good "
    "Mongolian subtitles read. Keep lines short and easy to read on screen."
)


PRO_PROMPT = (
    "You are an expert translator of professional and technical English (project management, "
    "PMP/PMBOK, agile, business, finance, IT) into Mongolian (Cyrillic). Translate precisely and "
    "naturally for Mongolian professionals and students: keep the exact meaning, "
    "do not omit, add or summarize anything, keep numbers, formulas, acronyms (PMP, WBS, EVM, CPI, SPI, "
    "RACI, MVP) and proper names unchanged. Use the glossary terms consistently when they appear. "
    "Keep list markers, numbering and sentence structure; translate headings concisely. "
    "The 'Previous lines' are context only — use them to resolve pronouns and ambiguous terms."
)
PRO_TERMS_RULE = (" For key professional terms, write the Mongolian term followed by the original English "
                  "term in parentheses, e.g. 'оролцогч тал (stakeholder)'.")

DEFAULT_GLOSSARY = """# Мэргэжлийн нэр томьёоны толь — "англи = монгол" хэлбэрээр засаж/нэмж болно (мөр бүрт нэг)
project management = төслийн удирдлага
project manager = төслийн менежер
stakeholder = оролцогч тал
stakeholder engagement = оролцогч талуудын оролцоо
scope = хамрах хүрээ
scope creep = хамрах хүрээний хяналтгүй тэлэлт
work breakdown structure = ажлын задаргааны бүтэц
deliverable = хүлээлгэн өгөх үр дүн
milestone = гол үе шат
baseline = суурь төлөвлөгөө
critical path = чухал зам
float = сул хугацаа
slack = сул хугацаа
risk register = эрсдэлийн бүртгэл
risk appetite = эрсдэл хүлээн авах түвшин
risk mitigation = эрсдэлийг бууруулах
issue log = асуудлын бүртгэл
change request = өөрчлөлтийн хүсэлт
change control board = өөрчлөлтийн хяналтын зөвлөл
lessons learned = олж авсан сургамж
project charter = төслийн дүрэм
business case = бизнесийн үндэслэл
benefits realization = үр өгөөжийг бодит болгох
earned value = олсон өртөг
planned value = төлөвлөсөн өртөг
actual cost = бодит зардал
cost performance index = зардлын гүйцэтгэлийн индекс
schedule performance index = хуваарийн гүйцэтгэлийн индекс
procurement = худалдан авалт
quality assurance = чанарын баталгаажуулалт
quality control = чанарын хяналт
predictive = урьдчилан төлөвлөх
hybrid = хосолмол
product backlog = бүтээгдэхүүний ажлын жагсаалт
product owner = бүтээгдэхүүний эзэн
servant leadership = үйлчлэгч манлайлал
team charter = багийн дүрэм
retrospective = эргэн дүгнэлт
minimum viable product = хамгийн бага ашиглагдахуйц бүтээгдэхүүн
governance = засаглал
portfolio = багц
program = хөтөлбөр
conflict management = зөрчил удирдлага
emotional intelligence = сэтгэл хөдлөлийн оюун ухаан
tailoring = тохируулалт
constraint = хязгаарлалт
assumption = таамаглал
dependency = хамаарал
kickoff meeting = нээлтийн уулзалт
process group = процессын бүлэг
knowledge area = мэдлэгийн салбар
business environment = бизнесийн орчин
"""


def glossary_path():
    return os.path.join(ROOT, "glossary.txt")


_GLOSS = {"mtime": None, "items": []}


def load_glossary():
    """glossary.txt-ийг уншина (байхгүй бол үндсэн толиор үүсгэнэ)."""
    path = glossary_path()
    try:
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as f:
                f.write(DEFAULT_GLOSSARY)
        mt = os.path.getmtime(path)
        if mt != _GLOSS["mtime"]:
            items = []
            for line in open(path, encoding="utf-8-sig"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    en, mn = line.split("=", 1)
                    if en.strip() and mn.strip():
                        items.append((en.strip(), mn.strip()))
            _GLOSS.update(mtime=mt, items=items)
    except Exception as e:
        log("Толь уншиж чадсангүй:", e)
    return _GLOSS["items"]


def glossary_for(lines):
    text = " ".join(lines).lower()
    return [(en, mn) for en, mn in load_glossary() if en.lower() in text][:40]


def _untranslated(src, out):
    """Англи өгүүлбэр орчуулагдалгүй буцаж ирсэн эсэх."""
    return (len(src.split()) >= 3 and re.search(r"[A-Za-z]{3}", src)
            and not re.search(r"[\u0400-\u04FF]", out or ""))


def _mark(name, ok, why=""):
    prov = STATE.setdefault("providers", {})
    new = "✓" if ok else ("✗ " + str(why)[:200])
    if new != prov.get(name) and not ok:
        log(f"{name} ажилласангүй: {str(why)[:300]}")
    prov[name] = new


def explain_error(name, msg):
    """Техникийн алдааг хэрэглэгчид ойлгомжтой тайлбар болгоно."""
    m = str(msg)
    low = m.lower()
    if name == "Copilot":
        if "401" in m:
            return "Токен буруу эсвэл хугацаа нь дууссан байна. GitHub дээр шинэ токен үүсгээд оруулна уу."
        if "403" in m or "permission" in low or "models эрхгүй" in low:
            return ("Токенд 'Models' эрх алга. GitHub → Settings → Developer settings → Fine-grained tokens → "
                    "токеноо засаад Permissions → 'Models' → Read-only болгоод Update дарна уу.")
        if "хязгаар" in m or "429" in m:
            return "Өнөөдрийн үнэгүй хязгаар дүүрсэн байна. Маргааш дахин ажиллана (одоогоор Gemini ашиглана)."
        if "404" in m or "model" in low:
            return "Copilot-ийн загвар олдсонгүй. Дэлгэрэнгүй: " + m[:150]
    if "urlopen error" in low or "timed out" in low or "getaddrinfo" in low:
        return "Интернэт холболт эсвэл галт хана (firewall) саад болж байна: " + m[:120]
    return m[:250]


def test_provider(name):
    """Тохиргооны цонхны 'Шалгах' товчинд: (ok, тайлбар)."""
    tr = TRANSLATOR
    if not tr:
        return False, "Програм эхэлж байна, түр хүлээгээд дахин оролдоно уу."
    try:
        if name == "Copilot":
            if not tr.github_token:
                return False, "Copilot токен оруулаагүй байна."
            tr.gh_until = 0
            out = tr._copilot(["Project management is important."], None, system=PRO_PROMPT, pro=True)
        else:
            if not tr.gemini_key:
                return False, "Gemini түлхүүр оруулаагүй байна."
            out = tr._gemini(["Project management is important."], None)
        _mark(name, True)
        return True, f"Ажиллаж байна ✓\n\nТурших орчуулга: {out[0]}"
    except Exception as e:
        _mark(name, False, e)
        return False, explain_error(name, e)


class TranslateError(Exception):
    pass


def _read_key(fname, env):
    key = os.environ.get(env, "").strip()
    path = os.path.join(ROOT, fname)
    if not key and os.path.exists(path):
        key = open(path, encoding="utf-8-sig").read().strip()
    return key


def _json_array(text, n):
    m = re.search(r"\[.*\]", text, re.S)
    arr = json.loads(m.group(0)) if m else []
    if len(arr) != n:
        raise ValueError(f"мөрийн тоо таарсангүй ({len(arr)} != {n})")
    return [str(x).strip() for x in arr]


class Translator:
    """Орчуулагчид дарааллаар: Claude (api_key.txt) → Gemini (gemini_key.txt) → Google."""

    def __init__(self):
        self.claude_key = _read_key("api_key.txt", "ANTHROPIC_API_KEY")
        self.gemini_key = _read_key("gemini_key.txt", "GEMINI_API_KEY")
        self.claude = None
        if self.claude_key:
            try:
                import anthropic
                self.claude = anthropic.Anthropic(api_key=self.claude_key, timeout=30)
            except ImportError:
                log("anthropic сан суугаагүй тул Claude-г алгаслаа")
        self.gemini_models = ["gemini-flash-lite-latest", "gemini-flash-latest"]
        self.gemini_models_pro = ["gemini-flash-latest", "gemini-flash-lite-latest"]
        if self.gemini_key:
            self._discover_gemini()
        self.gemini_next = 0.0      # үнэгүй эрхийн хурдны хязгаар
        self.google_next = 0.0
        self._glock = threading.Lock()
        self._gemlock = threading.Lock()
        self.github_token = _read_key("github_token.txt", "GITHUB_TOKEN")
        self.gh_models = list(GITHUB_MODELS)
        self.gh_models_pro = list(GITHUB_MODELS_PRO)
        self.gh_until = 0.0          # хязгаар дүүрсэн бол энэ хүртэл алгасна
        self.gh_next = 0.0
        self._ghlock = threading.Lock()
        names = [n for n, k in (("Claude", self.claude), ("Copilot", self.github_token),
                                ("Gemini", self.gemini_key)) if k]
        self.name = " → ".join(names + ["Google"])

    def _discover_gemini(self):
        """Одоо байгаа Gemini загваруудыг асууж, хурдан flash-lite → flash дарааллаар сонгоно."""
        try:
            req = urllib.request.Request(
                "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                headers={"x-goog-api-key": self.gemini_key})
            with urllib.request.urlopen(req, timeout=15) as r:
                models = json.loads(r.read().decode("utf-8")).get("models", [])
            names = [m["name"].split("/")[-1] for m in models
                     if "generateContent" in m.get("supportedGenerationMethods", [])]
            flash = [n for n in names if "flash" in n and not any(
                x in n for x in ("image", "tts", "audio", "live", "thinking", "exp"))]

            def ver(n):
                m = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
                return float(m.group(1)) if m else 0.0

            def rank(n):
                return (0 if "lite" in n else 1,          # lite нь хурдан, ачаалал бага
                        1 if "preview" in n else 0,
                        -ver(n), "latest" not in n)
            chosen = sorted(flash, key=rank)
            if GEMINI_MODEL in names:
                chosen.insert(0, GEMINI_MODEL)
            if chosen:
                self.gemini_models = list(dict.fromkeys(chosen))[:5]
                # мэргэжлийн орчуулгад: lite-гүй (илүү хүчтэй) flash эхэнд
                pro = sorted(chosen, key=lambda n: ("lite" in n, "preview" in n, -ver(n), "latest" not in n))
                # хүчтэй загварууд эхэнд, хязгаар дүүрвэл lite загварууд нөөц болно
                strong = [n for n in pro if "lite" not in n][:3]
                lite = [n for n in pro if "lite" in n][:2]
                self.gemini_models_pro = list(dict.fromkeys(strong + lite)) or list(dict.fromkeys(pro))[:5]
            log("Gemini загварууд:", ", ".join(self.gemini_models))
        except Exception as e:
            log("Gemini загварын жагсаалт авч чадсангүй:", str(e)[:150])

    def _prompt(self, lines, context, pro=False):
        gl = ""
        if pro:
            g = glossary_for(lines)
            if g:
                gl = "Glossary (English = Mongolian):\n" + "\n".join(f"{a} = {b}" for a, b in g) + "\n\n"
        return (gl + "Previous lines (context only, do not translate):\n"
                + ("\n".join(c for c in (context or []) if c) or "(none)")
                + f"\n\nTranslate each item of this JSON array into Mongolian. Return ONLY a JSON "
                  f"array of exactly {len(lines)} strings, in the same order.\n"
                + json.dumps(lines, ensure_ascii=False))

    def _claude(self, lines, context, system=SYSTEM_PROMPT, pro=False):
        msg = self.claude.messages.create(
            model=CLAUDE_MODEL, max_tokens=8000, system=system,
            messages=[{"role": "user", "content": self._prompt(lines, context, pro)}])
        return _json_array("".join(b.text for b in msg.content if b.type == "text"), len(lines))

    def _gemini_raw(self, parts, system=None, timeout=30, models=None):
        """Gemini-д хүсэлт илгээж текст хариуг буцаана (ачаалалтай бол өөр загвар руу шилжинэ)."""
        if not self.gemini_key:
            raise RuntimeError("Gemini түлхүүр байхгүй")

        def make_body(model):
            cfg = {"responseMimeType": "application/json", "temperature": 0.3}
            if getattr(self, "no_thinking_cfg", False):
                pass
            elif "2.5" in model:
                cfg["thinkingConfig"] = {"thinkingBudget": 0}
            elif re.search(r"gemini-[3-9]", model):
                cfg["thinkingConfig"] = {"thinkingLevel": "low"}
            body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": cfg}
            if system:
                body["systemInstruction"] = {"parts": [{"text": system}]}
            return json.dumps(body).encode("utf-8")

        ml = models if models is not None else self.gemini_models
        cool = self.__dict__.setdefault("gem_cool", {})   # загвар → энэ хүртэл алгасна (хязгаар дүүрсэн)
        tries = len(ml) + 2
        for attempt in range(tries):
            ready = [m for m in ml if cool.get(m, 0) < time.time()]
            if not ready:
                raise RuntimeError("Gemini хязгаар дүүрсэн (түр хүлээнэ)")
            is_video = threading.current_thread().name in VIDEO_THREADS
            if is_video:
                _VIDEO_WAIT[0] += 1
            else:
                # видео үзэж байх үед хадмалын орчуулгыг түрүүлж явуулна
                t_end = time.time() + 20
                while _VIDEO_WAIT[0] > 0 and time.time() < t_end:
                    time.sleep(0.2)
            try:
                with self._gemlock:
                    wait = self.gemini_next - time.time()
                    if wait > 25:
                        raise RuntimeError("Gemini дараалал их байна (хязгаар)")
                    if wait > 0:
                        time.sleep(wait)
                    self.gemini_next = time.time() + GEMINI_MIN_INTERVAL
            finally:
                if is_video:
                    _VIDEO_WAIT[0] -= 1
            model = ready[0]
            req = urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                data=make_body(model), headers={"Content-Type": "application/json",
                                                "x-goog-api-key": self.gemini_key})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    data = json.loads(r.read().decode("utf-8"))
                cparts = data["candidates"][0]["content"]["parts"]
                return "".join(p.get("text", "") for p in cparts if not p.get("thought"))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "ignore")[:200]
                if e.code == 400 and "thinking" in detail.lower():
                    self.no_thinking_cfg = True
                    continue
                if e.code == 404 and len(ml) > 1:
                    log(f"Gemini загвар {model} олдсонгүй, хасав")
                    ml.remove(model)
                    continue
                if e.code in (429, 500, 503):
                    daily = e.code == 429 and re.search(r"per.?day|daily|PerDay", detail, re.I)
                    # дахин дахин хязгаарт хүрдэг загварыг удаан алгасна (дэмий хүлээлт гаргахгүй)
                    strikes = self.__dict__.setdefault("gem_strikes", {})
                    hist = [t for t in strikes.get(model, []) if time.time() - t < 900] + [time.time()]
                    strikes[model] = hist
                    secs = (3600 if daily else 1800 if len(hist) >= 2 else 90) if e.code == 429 else 20
                    cool[model] = time.time() + secs
                    log(f"Gemini {model} {'хязгаар дүүрсэн' if e.code == 429 else 'завгүй'} ({e.code}) — "
                        f"{secs // 60 or 1} мин алгасна")
                    continue
                raise RuntimeError(f"Gemini {e.code}: {detail}")
        raise RuntimeError("Gemini хариу өгсөнгүй")

    def _gemini(self, lines, context, system=SYSTEM_PROMPT, pro=False, lite=False):
        models = self.gemini_models_pro if pro and not lite else self.gemini_models
        return _json_array(self._gemini_raw([{"text": self._prompt(lines, context, pro)}], system,
                                            timeout=60 if pro else 30, models=models), len(lines))

    def gemini_transcribe(self, audio, lang=None):
        """Видео картгүй үед: дууны хэсгийг Gemini-ээр текст болгож, монгол руу орчуулна."""
        import base64
        import io
        import wave
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm)
        b64 = base64.b64encode(buf.getvalue()).decode()
        prompt = (
            "Transcribe all speech in this audio clip and translate each line into natural, colloquial "
            "Mongolian (Cyrillic), like good movie subtitles. Return ONLY JSON: "
            '{"language": "<ISO 639-1 code of the spoken language>", "segments": [{"start": <seconds from clip start>, '
            '"end": <seconds>, "text": "<original words>", "mn": "<Mongolian>"}]}. '
            "Split into short subtitle-sized lines (at most ~12 words each) with accurate timestamps. "
            "Ignore music, singing without words and noise. If there is no speech, return an empty segments list."
            + (f" The spoken language is probably '{lang}'." if lang else ""))
        text = self._gemini_raw([{"inlineData": {"mimeType": "audio/wav", "data": b64}}, {"text": prompt}],
                                timeout=90)
        m = re.search(r"\{.*\}", text, re.S)
        d = json.loads(m.group(0)) if m else {}
        segs = []
        for x in d.get("segments") or []:
            try:
                segs.append({"start": float(x["start"]), "end": float(x["end"]),
                             "text": str(x.get("text", "")).strip(), "mn": str(x.get("mn", "")).strip()})
            except (KeyError, TypeError, ValueError):
                continue
        return (d.get("language") or "").lower()[:2] or None, segs

    def gemini_image(self, image_b64, mime="image/png"):
        """Зурган дээрх текстийг таниад монгол руу орчуулна."""
        if not self.gemini_key:
            raise TranslateError("Зургаас орчуулахад Gemini түлхүүр хэрэгтэй (тохиргоонд оруулна уу)")
        prompt = ("Read all the text in this image, in natural reading order, keeping paragraph breaks. "
                  "Then translate it into natural Mongolian (Cyrillic). Return ONLY JSON: "
                  '{"original": "<text as written>", "mongolian": "<Mongolian translation>"}. '
                  'If there is no text, return {"original": "", "mongolian": ""}.')
        text = self._gemini_raw([{"inlineData": {"mimeType": mime, "data": image_b64}},
                                 {"text": prompt}], timeout=60)
        m = re.search(r"\{.*\}", text, re.S)
        d = json.loads(m.group(0)) if m else {}
        return {"original": str(d.get("original", "")), "mongolian": str(d.get("mongolian", ""))}

    # Google-ийн үнэгүй орчуулгын хэд хэдэн хаяг — нэг нь хаагдвал (429) дараагийнх руу шилжинэ
    GOOGLE_EPS = [("gtx", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t"),
                  ("dict", "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=mn"),
                  ("gtx", "https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t")]

    def _google_raw(self, text, extra="", kinds=("gtx", "dict")):
        cool = self.__dict__.setdefault("google_cool", {})
        eps = [(k, u) for k, u in self.GOOGLE_EPS if k in kinds and cool.get(u, 0) < time.time()]
        if not eps:
            raise RuntimeError("Google түр хаагдсан (429), хэсэг хүлээнэ")
        last = None
        for kind, base in eps:
            with self._glock:
                wait = self.google_next - time.time()
                if wait > 0:
                    time.sleep(wait)
                self.google_next = time.time() + 0.25
            url = base + (extra if kind == "gtx" else "") + "&q=" + urllib.parse.quote(text)
            try:
                return kind, json.loads(http_get(url, {"User-Agent": "Mozilla/5.0"}))
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (429, 403, 503):
                    # олон хүсэлт илгээвэл Google түр хаадаг — тэр хаягийг 3 мин алгасна
                    cool[base] = time.time() + 180
                    log(f"Google орчуулгын хаяг түр хаагдлаа ({e.code}) — {base.split('/')[2]}, дараагийнхыг оролдоно")
                    continue
                raise
            except Exception as e:
                last = e
                continue
        if all(cool.get(u, 0) > time.time() for k, u in self.GOOGLE_EPS if k in kinds):
            self.google_until = time.time() + 180
        raise last or RuntimeError("Google ажилласангүй")

    def _google_one(self, text):
        kind, data = self._google_raw(text)
        if kind == "dict":
            # [["орчуулга","en"]] эсвэл ["орчуулга"] хэлбэртэй
            item = data[0] if isinstance(data, list) and data else data
            if isinstance(item, list):
                item = item[0] if item else ""
            return str(item or "")
        return "".join(seg[0] for seg in data[0] if seg and seg[0])

    def google_word(self, word):
        """Нэг үгийн орчуулга + толь бичгийн бусад утгууд."""
        _, data = self._google_raw(word, "&dt=bd", kinds=("gtx",))
        mn = "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])
        alts = []
        if len(data) > 1 and isinstance(data[1], list):
            for entry in data[1]:
                if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], list):
                    alts.append({"pos": entry[0], "terms": [str(x) for x in entry[1][:6]]})
        return mn, alts

    def _google(self, lines):
        parts = [p.strip() for p in self._google_one("\n".join(lines)).split("\n")]
        if len(parts) == len(lines):
            return parts
        if len(lines) <= 2:
            return [self._google_one(l).strip() for l in lines]
        # мөрийн тоо таарсангүй — мөр бүрээр (олон хүсэлт) биш, хоёр хуваан дахин оролдоно
        h = len(lines) // 2
        return self._google(lines[:h]) + self._google(lines[h:])

    def translate_batch(self, lines, context=None):
        if not lines:
            return []
        errors = []
        if self.claude:
            try:
                return self._claude(lines, context)
            except Exception as e:
                errors.append(f"Claude: {e}")
        # хурдан AI (Gemini lite) эхэлж — Google зөвхөн нөөц
        if self.gemini_key:
            try:
                out = self._gemini(lines, context)
                if sum(1 for a, b in zip(lines, out) if _untranslated(a, b)) < max(1, -(-len(lines) // 2)):
                    return out
            except Exception as e:
                errors.append(f"Gemini: {e}")
        err = None
        for attempt in range(2):
            try:
                return self._google(lines)
            except Exception as e:
                err = e
                if time.time() < getattr(self, "google_until", 0):
                    break
                time.sleep(2)
        errors.append(f"Google: {err}")
        raise TranslateError(" | ".join(errors))

    def needs_refine(self):
        """Хадмалыг AI-аар сайжруулах эсэх (Copilot-ийг PDF/текстэд хэмнэнэ)."""
        return bool(self.gemini_key or self.claude)

    # --- GitHub Models (Copilot)
    def _copilot(self, lines, context, system=SYSTEM_PROMPT, pro=False, lite=False):
        ml = self.gh_models_pro if pro and not lite else self.gh_models
        if not self.github_token:
            raise RuntimeError("GitHub токен байхгүй")
        if time.time() < self.gh_until:
            raise RuntimeError("Copilot хязгаар дүүрсэн, түр хүлээнэ")
        for _ in range(len(ml) + 1):
            with self._ghlock:
                wait = self.gh_next - time.time()
                if wait > 0:
                    time.sleep(wait)
                self.gh_next = time.time() + 1.0
            model = ml[0]
            ui = getattr(self, "gh_url_idx", 0) % len(GITHUB_MODELS_URLS)
            url = GITHUB_MODELS_URLS[ui]
            body = json.dumps({
                "model": model if ui == 0 else model.split("/")[-1], "temperature": 0.3,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": self._prompt(lines, context, pro)}],
            }).encode("utf-8")
            req = urllib.request.Request(url, data=body, headers={
                "Authorization": "Bearer " + self.github_token, "Content-Type": "application/json",
                "Accept": "application/json", "X-GitHub-Api-Version": "2022-11-28"})
            try:
                with _GH_OPENER.open(req, timeout=60 if pro else 40) as r:
                    raw = r.read().decode("utf-8", "ignore")
                    ctype = r.headers.get("Content-Type", "")
                try:
                    data = json.loads(raw)
                except ValueError:
                    snippet = re.sub(r"\s+", " ", raw)[:160] or "(хоосон)"
                    if not getattr(self, "gh_switched", False):
                        # энэ хаяг ажиллахгүй байна — нөөц хаяг руу шилжиж дахин оролдоно
                        self.gh_switched = True
                        self.gh_url_idx = ui + 1
                        log(f"Copilot {url.split('/')[2]} буруу хариу [{ctype}]: {snippet} → "
                            f"{GITHUB_MODELS_URLS[(ui + 1) % len(GITHUB_MODELS_URLS)].split('/')[2]} оролдоно")
                        continue
                    self.gh_until = time.time() + 1800
                    raise RuntimeError(f"Copilot JSON биш хариу өглөө [{ctype}]: {snippet}")
                text = data["choices"][0]["message"]["content"] or ""
                return _json_array(text, len(lines))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "ignore")[:200]
                if 300 <= e.code < 400:
                    loc = e.headers.get("Location", "")
                    if not getattr(self, "gh_switched", False):
                        self.gh_switched = True
                        self.gh_url_idx = ui + 1
                        log(f"Copilot {url.split('/')[2]} өөр хаяг руу шилжүүллээ ({e.code} → {loc[:100]}) — нөөц хаяг оролдоно")
                        continue
                    self.gh_until = time.time() + 300
                    raise RuntimeError(f"Copilot хаяг шилжүүлэлт ({e.code} → {loc[:100]})")
                if e.code == 429:
                    self.gh_until = time.time() + 60
                    raise RuntimeError("Copilot хязгаар дүүрлээ (1 мин Gemini ашиглана)")
                if e.code in (400, 404) and ("model" in detail.lower()) and len(ml) > 1:
                    log(f"Copilot загвар {model} ажилласангүй, хасав")
                    ml.pop(0)
                    continue
                if e.code in (401, 403):
                    self.gh_until = time.time() + 600
                    raise RuntimeError(f"GitHub токен буруу эсвэл Models эрхгүй ({e.code})")
                raise RuntimeError(f"Copilot {e.code}: {detail}")
            except urllib.error.URLError as e:
                # сүлжээ хүрэхгүй (DNS, firewall) — 30 мин оролдохгүй, бусад орчуулагчийг саатуулахгүй
                self.gh_until = time.time() + 1800
                raise RuntimeError(f"Copilot сүлжээнд хүрсэнгүй: {e.reason}")
        raise RuntimeError("Copilot хариу өгсөнгүй")

    def quality(self, lines, context=None, style="subs", pro_terms=False, exclude=(), lite=False):
        """Сайн чанартай орчуулга: Claude → Copilot → Gemini. Түр алдаанд дахин оролдож,
        орчуулагдаагүй хариуг хүлээж авахгүй. Амжилтгүй бол RuntimeError."""
        pro = style == "pro"
        system = (PRO_PROMPT + (PRO_TERMS_RULE if pro_terms else "")) if pro else SYSTEM_PROMPT
        chain = []
        if self.claude:
            chain.append(("Claude", self._claude))
        if self.github_token:
            chain.append(("Copilot", (lambda *a, **k: self._copilot(*a, lite=True, **k)) if lite else self._copilot))
        if self.gemini_key:
            chain.append(("Gemini", (lambda *a, **k: self._gemini(*a, lite=True, **k)) if lite else self._gemini))
        chain = [c for c in chain if c[0] not in exclude]
        errors = []
        best = None   # хэсэгчлэн орчуулагдсан хариу — өөр арга бүтэхгүй бол үүнийг ашиглана
        for name, fn in chain:
            for attempt in range(2):
                try:
                    out = fn(lines, context, system=system, pro=pro)
                    bad = sum(1 for a, b in zip(lines, out) if _untranslated(a, b))
                    # дууны үг, нэр, гарчиг зэргийг AI зориуд орчуулдаггүй — зөвхөн ихэнх нь орчуулагдаагүй бол татгалзана
                    if bad and bad >= max(1, -(-len(lines) // 2)):
                        if bad < len(lines) and (best is None or bad < best[0]):
                            best = (bad, out, name)
                        raise ValueError(f"{bad} мөр орчуулагдаагүй буцлаа")
                    _mark(name, True)
                    usage_add(name)
                    self.last_provider = name
                    return out
                except Exception as e:
                    msg = str(e)
                    transient = any(x in msg.lower() for x in ("timed out", "timeout", "temporar", "reset",
                                                                "500", "502", "503", "504", "мөрийн тоо"))
                    if attempt == 0 and transient and "хязгаар" not in msg:
                        time.sleep(2)
                        continue
                    errors.append(f"{name}: {msg[:120]}")
                    if "орчуулагдаагүй" not in msg:
                        _mark(name, False, msg)
                    break
        if best:
            usage_add(best[2])
            self.last_provider = best[2]
            return best[1]
        raise RuntimeError(" | ".join(errors) or "сайн чанарын орчуулагч алга")


# ---------------------------------------------------------------- туслах
HALLUCINATIONS = [
    "thank you for watching", "thanks for watching", "subscribe", "like and subscribe",
    "субтитры", "продолжение следует", "ご視聴ありがとうございました", "구독", "시청해주셔서",
    "字幕", "請不吝點贊", "amara.org",
]


def is_junk(text):
    t = text.strip().lower()
    if len(t) < 2 or not any(ch.isalnum() for ch in t):
        return True
    return len(t) < 60 and any(h in t for h in HALLUCINATIONS)


def vtt_time(s):
    sec = 0.0
    for p in s.replace(",", ".").split(":"):
        sec = sec * 60 + float(p)
    return sec


def parse_vtt(text):
    cues = []
    for block in re.split(r"\r?\n\s*\r?\n", text):
        lines = block.strip().splitlines()
        for i, line in enumerate(lines):
            if "-->" in line:
                a, b = line.split("-->")[:2]
                try:
                    s, e = vtt_time(a.strip()), vtt_time(b.strip().split()[0])
                except ValueError:
                    break
                t = re.sub(r"<[^>]+>", "", " ".join(lines[i + 1:]))
                t = html.unescape(t).strip()
                if t:
                    cues.append({"start": s, "end": e, "orig": t})
                break
    return cues


def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def ytdlp_info(url):
    try:
        import yt_dlp
    except ImportError:
        return None
    opts = {"quiet": True, "no_warnings": True, "format": "bestaudio/best",
            "noplaylist": True, "skip_download": True, "socket_timeout": 20}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        log("yt-dlp танисангүй:", str(e)[:160])
        return None
    if info and info.get("_type") == "playlist":
        entries = [x for x in (info.get("entries") or []) if x]
        info = entries[0] if entries else None
    return info


# ---------------------------------------------------------------- хадмалын мөр бүтээх (Netflix-ийн зарчмаар)
SUB_MAX_CHARS = 84      # 2 мөр × 42 тэмдэгт
SUB_MAX_DUR = 6.5
SUB_GAP = 0.7           # үүнээс урт завсар бол шинэ мөр
_END = (".", "?", "!", "…", "。", "？", "！")


def build_cues_from_words(words):
    """[(start, end, word)] → [(start, end, text)]: өгүүлбэр, завсар, уртаар нь хадмалын мөр болгоно."""
    cues, cur = [], []

    def flush():
        if cur:
            text = "".join(w[2] for w in cur).strip()
            text = re.sub(r"\s+", " ", text)
            if text:
                cues.append((cur[0][0], max(cur[-1][1], cur[0][0] + 0.8), text))
        cur.clear()

    for w in words:
        st, en, tx = w
        if not tx.strip():
            continue
        if cur:
            chars = len("".join(x[2] for x in cur))
            prev = cur[-1][2].strip()
            gap = st - cur[-1][1]
            dur = en - cur[0][0]
            if (gap > SUB_GAP or dur > SUB_MAX_DUR or chars + len(tx) > SUB_MAX_CHARS
                    or (prev.endswith(_END) and chars > 12)
                    or (prev.endswith((",", ";", ":")) and chars > 55)):
                flush()
        if not cur and not tx.startswith(" "):
            tx = " " + tx
        cur.append((st, en, tx))
    flush()
    # дараагийн мөртэй давхцахгүй байлгана
    fixed = []
    for i, (a, b, t) in enumerate(cues):
        if i + 1 < len(cues):
            b = max(min(b, cues[i + 1][0] - 0.05), a + 0.3)
        fixed.append((a, b, t))
    return fixed


def group_sentences(texts, times=None, max_items=4, max_chars=320):
    """Тасархай мөрүүдийг өгүүлбэр болгон бүлэглэнэ → [[индексүүд], ...]."""
    groups, cur, chars = [], [], 0
    for i, t in enumerate(texts):
        if cur:
            gap = (times[i][0] - times[cur[-1]][1]) if times else 0
            if gap > 1.5 or len(cur) >= max_items or chars + len(t) > max_chars:
                groups.append(cur)
                cur, chars = [], 0
        cur.append(i)
        chars += len(t)
        if t.rstrip().endswith(_END + ("♪",)):
            groups.append(cur)
            cur, chars = [], 0
    if cur:
        groups.append(cur)
    return groups


def split_translation(mn, src_parts):
    """Нэг өгүүлбэрийн орчуулгыг эх мөрүүдийн уртын харьцаагаар мөрүүдэд хуваана."""
    if len(src_parts) == 1:
        return [mn]
    words = mn.split()
    total = sum(max(1, len(p)) for p in src_parts)
    out, i = [], 0
    for k, p in enumerate(src_parts):
        if k == len(src_parts) - 1:
            out.append(" ".join(words[i:]))
            break
        n = max(1, round(len(words) * max(1, len(p)) / total))
        n = min(n, max(0, len(words) - i - (len(src_parts) - k - 1)))
        out.append(" ".join(words[i:i + n]))
        i += n
    return [o if o else "…" for o in out]


def translate_sentencewise(lines, fn, times=None):
    """lines → өгүүлбэрээр нийлүүлж fn(list)-ээр орчуулаад мөр бүрт буцааж хуваана."""
    groups = group_sentences(lines, times)
    joined = [" ".join(lines[i] for i in g) for g in groups]
    mns = fn(joined)
    out = [""] * len(lines)
    for g, m in zip(groups, mns):
        for i, part in zip(g, split_translation(m or "", [lines[i] for i in g])):
            out[i] = part
    return out


def parse_json3(text):
    """YouTube json3 хадмал → [(start, end, word)] (автомат хадмалд үг бүрийн цагтай)."""
    d = json.loads(text)
    words = []
    events = [e for e in d.get("events", []) if e.get("segs")]
    for k, e in enumerate(events):
        t0 = e.get("tStartMs", 0) / 1000.0
        dur = e.get("dDurationMs", 0) / 1000.0
        segs = e["segs"]
        for j, sg in enumerate(segs):
            tx = sg.get("utf8", "")
            if tx == "\n" or not tx.strip():
                continue
            if j == 0 and not tx.startswith(" ") and not re.match(r"[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]", tx):
                tx = " " + tx  # мөр бүрийн эхний үгийг өмнөхөөс тусгаарлана
            st = t0 + sg.get("tOffsetMs", 0) / 1000.0
            if j + 1 < len(segs):
                en = t0 + segs[j + 1].get("tOffsetMs", 0) / 1000.0
            else:
                en = t0 + dur
            words.append((st, max(en, st + 0.2), tx.replace("\n", " ")))
    words.sort(key=lambda w: w[0])
    # manual json3 нь бүтэн мөртэй байдаг — давхардлыг арилгана
    return words


def parse_srt(text):
    return parse_vtt(text)  # "-->" мөрийг адилхан уншина (таслал/цэг хоёуланг)


def parse_ttml(text):
    cues = []
    for m in re.finditer(r'<p[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>(.*?)</p>', text, re.S):
        def tt(v):
            v = v.strip()
            if v.endswith("t"):
                return int(v[:-1]) / 10_000_000.0
            if v.endswith("ms"):
                return float(v[:-2]) / 1000.0
            if v.endswith("s"):
                return float(v[:-1])
            return vtt_time(v)
        body = re.sub(r"<br\s*/?>", " ", m.group(3))
        body = html.unescape(re.sub(r"<[^>]+>", "", body)).strip()
        if body:
            try:
                cues.append({"start": tt(m.group(1)), "end": tt(m.group(2)), "orig": body})
            except ValueError:
                pass
    return cues


def parse_any_subs(text):
    t = text.lstrip("\ufeff").lstrip()
    if t.startswith("{"):
        return [{"start": a, "end": b, "orig": c} for a, b, c in build_cues_from_words(parse_json3(t))]
    if "<tt" in t[:500] or "<p " in t[:2000] and "begin=" in t[:3000]:
        return parse_ttml(t)
    return parse_vtt(t)


def dedupe_cues(cues):
    """Автомат VTT-ийн давхардсан (гүйдэг) мөрүүдийг цэвэрлэнэ."""
    out = []
    for c in sorted(cues, key=lambda c: c["start"]):
        t = c["orig"].strip()
        if not t or c["end"] - c["start"] < 0.05:
            continue
        if out and (t == out[-1]["orig"] or out[-1]["orig"].endswith(t)):
            out[-1]["end"] = max(out[-1]["end"], c["end"])
            continue
        if out and t.startswith(out[-1]["orig"]) and c["start"] - out[-1]["start"] < 4:
            t = t[len(out[-1]["orig"]):].strip()
            if not t:
                continue
        out.append({"start": c["start"], "end": c["end"], "orig": t})
    return out


def pick_subs(info):
    """(хэл, url, төрөл): хүний бичсэн хадмал → YouTube автомат хадмал (эх хэлээр)."""
    def best(fmts):
        by = {f.get("ext"): f.get("url") for f in fmts if f.get("url")}
        for ext in ("json3", "vtt", "srv3", "ttml"):
            if by.get(ext):
                return by[ext]
        return None

    subs = info.get("subtitles") or {}
    langs = [l for l in subs if not l.startswith("live_chat")]
    langs.sort(key=lambda l: 0 if l.startswith("mn") else 1 if l.startswith("en") else 2)
    for l in langs:
        u = best(subs[l])
        if u:
            return l, u, "manual"
    auto = info.get("automatic_captions") or {}
    orig = [l for l in auto if l.endswith("-orig")]
    vlang = (info.get("language") or "").split("-")[0]
    cands = orig + ([vlang] if vlang in auto else []) + (["en"] if "en" in auto else [])
    for l in cands:
        u = best(auto[l])
        if u:
            return l.replace("-orig", ""), u, "auto"
    return None


def media_url_from_info(info):
    if info.get("url"):
        return info["url"], info.get("http_headers") or {}
    for f in (info.get("requested_downloads") or info.get("requested_formats") or []):
        if f.get("url"):
            return f["url"], f.get("http_headers") or info.get("http_headers") or {}
    return None


# ---------------------------------------------------------------- embed тоглуулагч / эх сурвалж эрэмбэлэх
_DM_ID = re.compile(r"(?:dailymotion\.com|dmcdn\.net)/(?:.*?[/=])?(?:video[/=]|video%2F)(x[0-9a-z]{4,})|dai\.ly/(x[0-9a-z]{4,})"
                    r"|[?&]video=(x[0-9a-z]{4,})", re.I)
_VIMEO_ID = re.compile(r"player\.vimeo\.com/video/(\d+)", re.I)
_AD_RE = re.compile(r"doubleclick|googlesyndication|imasdk|pubads|/vast|vast[._/?]|adserver|adnxs|springserve|"
                    r"spotx|freewheel|fwmrm|moatads|innovid|/ads?/|[/.]ads?\.|adsystem|teads|smartadserver", re.I)
_SEG_RE = re.compile(r"\.(ts|m4s|aac)(\?|$)|/seg[-_]?\d|/frag|[?&](range|bytes)=|/init\.mp4|chunk[-_]?\d", re.I)


def canonical_candidates(urls):
    """Embed тоглуулагчийн холбоос/хүсэлтээс yt-dlp танидаг жинхэнэ видео хуудсыг гаргана."""
    out = []
    for u in urls:
        if not u:
            continue
        m = _DM_ID.search(u)
        if m:
            vid = next(g for g in m.groups() if g)
            out.append("https://www.dailymotion.com/video/" + vid)
        m = _VIMEO_ID.search(u)
        if m:
            out.append("https://player.vimeo.com/video/" + m.group(1))
    return list(dict.fromkeys(out))


def rank_sources(urls):
    """Барьсан видео холбоосуудыг эрэмбэлнэ: зар, хэсэгчилсэн (segment) холбоосыг хасна, m3u8 эхэнд."""
    good = [u for u in dict.fromkeys(reversed(urls)) if not _AD_RE.search(u) and not _SEG_RE.search(u)]

    def score(u):
        p = u.lower().split("?")[0]
        if ".m3u8" in p:
            return 0 if re.search(r"master|manifest", p) else 1
        if ".mpd" in p:
            return 2
        return 3
    return sorted(good, key=score)


# ---------------------------------------------------------------- ажил (нэг видео)
class Job:
    def __init__(self, key, req):
        self.key = key
        self.id = hashlib.sha1(key.encode()).hexdigest()[:16]
        self.page_url = req.get("page_url") or ""
        self.frame_url = req.get("frame_url") or ""
        self.media_urls = req.get("media_urls") or []
        self.sub_urls = req.get("sub_urls") or []
        self.track_cues = req.get("track_cues") or []     # тоглуулагчийн өөрийн хадмал (video.textTracks)
        self.track_lang = req.get("track_lang") or ""
        self.hint_urls = req.get("hint_urls") or []
        self.canonical = req.get("canonical") or ""
        self.user_agent = req.get("user_agent") or ""
        self.title = req.get("title") or ""
        d = req.get("duration")
        self.duration = float(d) if d else None
        self.playhead = float(req.get("time") or 0)
        self.last_seen = time.time()
        self.lock = threading.Lock()

        self.cues, self.intervals = [], []
        self.lang, self.mode = None, None
        self.ended_at = None
        self.sources, self.src_idx, self.src_cues = [], 0, None
        self.prefetch = None
        self.resolved, self.error, self.fails = False, None, 0
        self.status = "Бэлтгэж байна…"
        self.cache_file = os.path.join(CACHE_DIR, self.id + ".v2.json")
        self._load_cache()

    # --- кэш (дахин үзэхэд шууд гарна)
    def _load_cache(self):
        try:
            with open(self.cache_file, encoding="utf-8") as f:
                c = json.load(f)
            self.cues, self.intervals = c["cues"], [tuple(x) for x in c["intervals"]]
            self.lang, self.mode, self.ended_at = c.get("lang"), c.get("mode"), c.get("ended_at")
            log(f"Кэшээс ачааллаа: {len(self.cues)} мөр")
        except Exception:
            pass

    def _save_cache(self):
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump({"key": self.key, "cues": self.cues, "intervals": self.intervals,
                           "lang": self.lang, "mode": self.mode, "ended_at": self.ended_at},
                          f, ensure_ascii=False)
        except Exception as e:
            log("Кэш хадгалах алдаа:", e)

    # --- видеог таних
    def resolve(self):
        info = None
        canon = canonical_candidates([self.frame_url, self.canonical, self.page_url] + self.hint_urls
                                     + self.media_urls)
        cands = canon + [u for u in [self.canonical, self.frame_url, self.page_url]
                         if u.startswith("http") and "geo.dailymotion.com/player" not in u]
        t0 = time.time()
        for u in dict.fromkeys(cands):
            if time.time() - t0 > 60:
                break
            if canon and u == canon[0]:
                log("Embed тоглуулагч → жинхэнэ хуудас:", u)
            info = ytdlp_info(u)
            if info:
                break
        mode = None
        if info:
            if info.get("duration"):
                self.duration = float(info["duration"])
            sub = pick_subs(info)
            if sub:
                try:
                    cues = dedupe_cues(parse_any_subs(http_get(sub[1], info.get("http_headers"))))
                    if len(cues) > 5:
                        self.src_cues, self.lang, mode = cues, sub[0].split("-")[0], "subs"
                        kind = "хүний бичсэн" if sub[2] == "manual" else "YouTube-ийн автомат"
                        log(f"{kind} хадмал олдлоо ({sub[0]}, {len(cues)} мөр) — Whisper хэрэггүй")
                except Exception as e:
                    log("Хадмал татах алдаа:", e)
            m = media_url_from_info(info)
            if m:
                self.sources.append(m)
        # өргөтгөлийн барьсан видео холбоосууд (зар, хэсэгчилсэн холбоосыг хасаад m3u8 эхэнд)
        self.add_media(self.media_urls)

        if mode is None and self.track_cues:
            if self.use_track_cues(self.track_cues, self.track_lang, switch=False):
                mode = "subs"
        if mode is None and self.sub_urls:
            if self.try_site_subs(self.sub_urls, switch=False):
                mode = "subs"
        if mode is None:
            if not self.sources:
                log("Видео холбоос одоогоор олдсонгүй — тоглуулагч ачаалахыг хүлээнэ")
            mode = "audio"
        if self.mode and self.mode != mode:  # кэш өөр аргаар хийгдсэн бол цэвэрлэнэ
            self.cues, self.intervals, self.ended_at = [], [], None
        self.mode = mode
        if mode == "subs" and not self.duration:
            self.duration = max(c["end"] for c in self.src_cues)
        self.resolved = True
        log(f"Танилаа: {self.title[:60]!r} · горим={mode} · урт={self.duration}")

    def src_headers(self):
        hdr = {"Referer": self.frame_url or self.page_url}
        if self.user_agent:
            hdr["User-Agent"] = self.user_agent
        return hdr

    def add_media(self, urls):
        """Шинээр барьсан холбоосуудыг эх сурвалжийн жагсаалтад нэмнэ (/poll-оос ч дуудагдана)."""
        known = {u for u, _ in self.sources} | getattr(self, "bad_urls", set())
        new = [u for u in rank_sources(urls) if u not in known]
        if new:
            hdr = self.src_headers()
            with self.lock:
                self.sources += [(u, hdr) for u in new]
        return len(new)

    # --- тоглуулагчийн өөрийн хадмал (HTML5 video textTracks — өргөтгөл уншиж илгээнэ)
    def use_track_cues(self, raw, lang="", switch=True):
        try:
            cues = dedupe_cues([{"start": float(c["start"]), "end": float(c["end"]),
                                 "orig": html.unescape(re.sub(r"<[^>]+>", "", str(c.get("text", "")))).strip()}
                                for c in raw if c.get("text")])
        except Exception as e:
            log("Тоглуулагчийн хадмал уншиж чадсангүй:", e)
            return False
        if len(cues) < 10:
            return False
        span = cues[-1]["end"]
        if self.duration and span < self.duration * 0.3 and len(cues) < 60:
            return False
        lang = (lang or "").split("-")[0].lower()
        if lang == "mn":
            return False
        with self.lock:
            self.src_cues = cues
            self.lang = lang or None
            if switch:
                self.cues, self.intervals, self.ended_at = [], [], None
                self.mode = "subs"
                self.stop_prefetch()
        log(f"Тоглуулагчийн хадмал ашиглана ({lang or '?'}, {len(cues)} мөр) — Whisper хэрэггүй")
        if not self.duration:
            self.duration = span
        return True

    # --- сайтын хадмалын файл (.vtt/.srt/.ttml)
    def try_site_subs(self, urls, switch=True):
        """Сайтын ачаалсан хадмалын файлыг ашиглана. Амжилттай бол True."""
        tried = getattr(self, "sub_tried", set())
        self.sub_tried = tried
        cands = [u for u in urls if u not in tried]
        cands.sort(key=lambda u: (0 if re.search(r"[^a-z](en|eng|english)[^a-z]", u.lower()) else 1))
        hdr = {"Referer": self.frame_url or self.page_url}
        if self.user_agent:
            hdr["User-Agent"] = self.user_agent
        for u in cands[:6]:
            tried.add(u)
            try:
                cues = dedupe_cues(parse_any_subs(http_get(u, hdr)))
            except Exception as e:
                log("Сайтын хадмал уншиж чадсангүй:", str(e)[:120])
                continue
            if len(cues) < 10:
                continue
            span = cues[-1]["end"]
            if self.duration and span < self.duration * 0.3:
                continue  # трейлер гэх мэт богино хадмал
            mn = sum(1 for c in cues[:50] if re.search(r"[\u04e8\u04e9\u04ae\u04af]", c["orig"]))
            with self.lock:
                self.src_cues = cues
                self.lang = "mn" if mn > 5 else None
                if switch:
                    self.cues, self.intervals, self.ended_at = [], [], None
                    self.mode = "subs"
                    self.stop_prefetch()
            log(f"Сайтын хадмалын файл олдлоо ({len(cues)} мөр) — Whisper хэрэггүй")
            if not self.duration:
                self.duration = span
            return True
        return False

    # --- аль хэсгийг дараа нь боловсруулах
    def next_start(self):
        t = max(0.0, self.playhead - 1.0)
        changed = True
        while changed:
            changed = False
            for s, e in self.intervals:
                if s <= t + 0.5 and e > t:
                    t, changed = e, True
        end = self.ended_at or (self.duration and self.duration - 0.5)
        if end and t >= end:
            return None
        return t

    def ahead(self):
        t = self.next_start()
        if t is None:
            return 1e9
        return t - self.playhead

    def add(self, start, cover, new_cues):
        with self.lock:
            self.cues = sorted(self.cues + new_cues, key=lambda c: c["start"])
            iv = sorted(self.intervals + [(start, start + cover)])
            merged = []
            for s, e in iv:
                if merged and s <= merged[-1][1] + 0.01:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], e))
                else:
                    merged.append((s, e))
            self.intervals = merged
        self._save_cache()

    # --- дуу унших
    def decode(self, start, length):
        """Дууны [start, start+length] хэсгийг буцаана. Дууг ард нь нэг урсгалаар татаж байдаг."""
        self.bad_urls = getattr(self, "bad_urls", set())
        waited = 0.0
        while True:
            if self.src_idx >= len(self.sources):
                # бүх холбоос бүтэлгүйтсэн — тоглуулагч шинэ холбоос ачаалахыг (зарын дараа) хэсэг хүлээнэ
                if waited >= 40:
                    raise RuntimeError("Видеоны дууг уншиж чадсангүй (энэ сайт дууг нь хамгаалсан байж магадгүй)")
                self.status = "Видеоны дууг хайж байна…"
                time.sleep(1)
                waited += 1
                continue
            pf = self.prefetch
            fresh = pf is None or pf.failed or not (pf.start - 0.5 <= start <= pf.end_sec() + 45)
            if fresh:
                if pf:
                    pf.close()
                pf = self.prefetch = Prefetch(self.sources[self.src_idx], start)
            # шинэ холбоос: 25 сек дотор дуу ирэхгүй бол дараагийнх руу; эхний уншилтад
            # зар мэт богино файл эсэхийг шалгахаар бага зэрэг илүү уншина
            extra = 20 if fresh and self.duration and self.duration > 180 else 0
            data = pf.read(start, length, timeout=90, first_byte=25, extra=extra)
            short = (data is not None and pf.done and pf.start < 5 and self.duration and self.duration > 180
                     and pf.end_sec() < self.duration * 0.5)
            if data is not None and not short:
                return data
            u = self.sources[self.src_idx][0]
            why = f"богино ({pf.end_sec():.0f} сек — зар байж магадгүй)" if short else pf.err[-300:]
            log(f"Энэ холбоос тохирсонгүй, дараагийнхыг оролдоно: {why} · {u[:120]}")
            self.bad_urls.add(u)
            pf.close()
            self.prefetch = None
            self.src_idx += 1

    def stop_prefetch(self):
        if self.prefetch:
            self.prefetch.close()
            self.prefetch = None


class Prefetch:
    """ffmpeg-ээр дууг тасралтгүй татаж 16кГц PCM болгон санах ойд хуримтлуулна."""
    BPS = SR * 2  # 1 секунд = 32000 байт

    def __init__(self, source, start):
        self.start = max(0.0, start)
        self.buf = bytearray()
        self.lock = threading.Lock()
        self.done = self.failed = self.closed = False
        self.err = ""
        url, hdr = source
        hs = "".join(f"{k}: {v}\r\n" for k, v in hdr.items() if k.lower() != "accept-encoding")
        cmd = [FFMPEG, "-nostdin", "-loglevel", "error"]
        if url.startswith("http"):
            cmd += ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
        if hs:
            cmd += ["-headers", hs]
        cmd += ["-ss", f"{self.start:.2f}", "-i", url, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.t0 = time.time()
        threading.Thread(target=self._pump, daemon=True).start()
        threading.Thread(target=self._errs, daemon=True).start()

    def _pump(self):
        try:
            while not self.closed:
                chunk = self.proc.stdout.read(65536)
                if not chunk:
                    break
                with self.lock:
                    self.buf.extend(chunk)
        except Exception as e:
            self.err += str(e)
        rc = self.proc.wait()
        if not self.closed and len(self.buf) == 0:  # алдаа эсвэл хоосон гаралт
            self.failed = True
        self.done = True
        if not self.closed and self.buf:
            secs = len(self.buf) / self.BPS
            log(f"Дуу татаж дууслаа: {secs:.0f} сек ({secs / max(0.1, time.time() - self.t0):.0f}x хурдан)")

    def _errs(self):
        try:
            self.err = (self.err + self.proc.stderr.read().decode(errors="ignore"))[-2000:]
        except Exception:
            pass

    def end_sec(self):
        return self.start + len(self.buf) / self.BPS

    def read(self, start, length, timeout=90, first_byte=None, extra=0):
        deadline = time.time() + timeout
        while True:
            if self.failed:
                return None
            if first_byte and not self.buf and time.time() - self.t0 > first_byte:
                self.err += f" ({first_byte} сек хариу ирсэнгүй)"
                self.failed = True
                return None
            if self.end_sec() >= start + length + extra or self.done:
                a = int(max(0.0, start - self.start) * self.BPS) & ~1
                b = int(max(0.0, start + length - self.start) * self.BPS) & ~1
                with self.lock:
                    raw = bytes(self.buf[a:b])
                return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
            if time.time() > deadline:
                self.err += " (хугацаа хэтэрлээ)"
                self.failed = True
                return None
            time.sleep(0.05)

    def close(self):
        self.closed = True
        try:
            self.proc.kill()
        except Exception:
            pass
        self.buf = bytearray()


# ---------------------------------------------------------------- боловсруулах
_CUDA = None


def cuda_available():
    global _CUDA
    if _CUDA is None:
        try:
            import ctranslate2
            _CUDA = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            _CUDA = False
    return _CUDA


def choose_asr():
    """Яриа таних арга: 'local' (Whisper, видео карт/CPU) эсвэл 'gemini' (онлайн)."""
    pref = SETTINGS.get("asr", "auto")
    has_gemini = bool(TRANSLATOR and getattr(TRANSLATOR, "gemini_key", None))
    if pref == "gemini" and has_gemini:
        return "gemini"
    if pref == "local":
        return "local"
    if cuda_available():
        return "local"
    return "gemini" if has_gemini else "local"


class _Seg:
    def __init__(self, d):
        self.start, self.end, self.text, self.mn = d["start"], d["end"], d["text"], d.get("mn", "")
        self.no_speech_prob = 0.0


def process_audio_chunk(job, t, model, translator, asr="local"):
    # тоглуулж буй цэг дээр хадмал бэлэн биш бол эхлээд богино хэсэг хийнэ (хурдан эхлэх)
    first = t - job.playhead < 3 and not any(s <= job.playhead < e for s, e in job.intervals)
    big = asr == "local" and BATCHED is not None   # batched горимд урт цонх илүү үр ашигтай
    chunk, window = (FIRST_CHUNK, FIRST_CHUNK + 5) if first else ((55.0, 62.0) if big else (CHUNK, WINDOW))
    t0 = time.time()
    audio = job.decode(t, window)
    t1 = time.time()
    n = len(audio) / SR
    last = n < window - 1.0
    if n < 0.5:
        job.ended_at = t
        job.add(t, window, [])
        return
    if asr == "gemini":
        try:
            lang, raw = translator.gemini_transcribe(audio, job.lang)
        except Exception as e:
            raise TranslateError(f"Gemini яриа таних: {e}")
        segs = [_Seg(d) for d in raw if d["end"] > d["start"] >= 0]
        job.timing = f"татах {t1 - t0:.1f}с · Gemini {time.time() - t1:.1f}с"
        if job.lang is None and lang:
            job.lang = lang
    else:
        kw = dict(language=job.lang, beam_size=1 if first else 3, vad_filter=True, word_timestamps=True,
                  condition_on_previous_text=False, hallucination_silence_threshold=2.0)
        if BATCHED is not None:
            segs, info = BATCHED.transcribe(audio, batch_size=BATCH_SIZE, **kw)
        else:
            segs, info = model.transcribe(audio, **kw)
        segs = [x for x in segs if x.no_speech_prob < 0.6 and not is_junk(x.text)]
        job.timing = f"татах {t1 - t0:.1f}с · текст {time.time() - t1:.1f}с"
        if job.lang is None and info.language_probability > 0.6:
            job.lang = info.language
        # үг бүрийн цагаар хадмалын мөр бүтээнэ
        words = [(w.start, w.end, w.word) for x in segs for w in (getattr(x, "words", None) or [])]
        if not words:  # word_timestamps ажиллаагүй бол сегментээр
            words = [(x.start, x.end, " " + x.text.strip()) for x in segs]
        kept, cover = [], None
        for w in words:
            if not last and w[0] >= chunk:
                cover = w[0]
                break
            kept.append(w)
        if cover is None:
            cover = n if last else max(chunk, max((w[1] for w in kept), default=0))
        if last:
            job.ended_at = t + n
        lines = [(t + a, t + b, txt) for a, b, txt in build_cues_from_words(kept)]
        finish_chunk(job, t, cover, lines, translator, None)
        return
    keep, cover = [], None
    for s in segs:
        if not last and s.start >= chunk:
            cover = s.start
            break
        keep.append(s)
    if cover is None:
        cover = n if last else max(chunk, max((s.end for s in keep), default=0))
    if last:
        job.ended_at = t + n

    keep = [s for s in keep if s.no_speech_prob < 0.6 and not is_junk(s.text)]
    lines = [(t + s.start, t + s.end, s.text.strip()) for s in keep]
    mns = [s.mn for s in keep] if asr == "gemini" else None
    finish_chunk(job, t, cover, lines, translator, mns)


def process_subs_chunk(job, t, translator):
    covered = lambda x: any(a <= x < b for a, b in job.intervals)
    lines = [(c["start"], c["end"], c["orig"]) for c in job.src_cues
             if (t <= c["start"] < t + CHUNK) or (c["start"] < t < c["end"] and not covered(c["start"]))]
    if t + CHUNK >= job.duration:
        job.ended_at = job.duration
    finish_chunk(job, t, CHUNK, lines, translator)


def finish_chunk(job, t, cover, lines, translator, mns=None):
    origs = [l[2] for l in lines]
    refine = mns is None
    if mns is not None:
        mns = [m or o for m, o in zip(mns, origs)]
    elif job.lang == "mn":
        mns = origs
    else:
        context = [c["orig"] for c in job.cues if c["start"] < t][-3:]
        t2 = time.time()
        mns = translate_sentencewise(origs, lambda xs: translator.translate_batch(xs, context),
                                     [(a, b) for a, b, _ in lines])
        job.timing = (getattr(job, "timing", "") + f" · орчуулга {time.time() - t2:.1f}с").lstrip(" ·")
    cues = [{"start": round(s, 2), "end": round(e, 2), "orig": o, "mn": m}
            for (s, e, o), m in zip(lines, mns)]
    job.add(t, cover, cues)
    if refine and cues and job.lang != "mn" and translator.needs_refine():
        REFINE_Q.put((job, cues))
    log(f"{fmt(t)}–{fmt(t + cover)} бэлэн ({len(cues)} мөр) [{getattr(job, 'timing', '')}]")
    job.timing = ""


def fmt(sec):
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


# ---------------------------------------------------------------- ажлын урсгал
JOBS, JOBS_LOCK = {}, threading.Lock()
STATE = {"active": None, "model": "loading", "model_desc": "", "translator": ""}


BATCHED = None
BATCH_SIZE = 8


def make_batched(model, dev):
    global BATCHED, BATCH_SIZE
    try:
        from faster_whisper import BatchedInferencePipeline
        BATCHED = BatchedInferencePipeline(model=model)
        BATCH_SIZE = 8 if dev == "cuda" else 4
        log(f"Batched Whisper идэвхтэй (batch={BATCH_SIZE})")
    except Exception as e:
        BATCHED = None
        log("Batched горим ажилласангүй, энгийн горим:", e)


def load_model():
    from faster_whisper import WhisperModel
    attempts = [(WHISPER_MODEL, DEVICE, COMPUTE_TYPE)]
    if DEVICE == "cuda":
        attempts.append((WHISPER_MODEL, "cuda", "int8"))
    attempts.append(("small", "cpu", "int8"))
    last = None
    for name, dev, ct in attempts:
        try:
            log(f"Whisper загвар ачаалж байна: {name} ({dev}, {ct}) — анх удаа татахад хэдэн минут болно")
            model = WhisperModel(name, device=dev, compute_type=ct)
            list(model.transcribe(np.zeros(SR, dtype=np.float32), beam_size=1)[0])
            make_batched(model, dev)
            return model, f"{name}/{dev}"
        except Exception as e:
            last = e
            log("Ачаалж чадсангүй:", e)
    raise RuntimeError(f"Whisper загвар ачаалж чадсангүй: {last}")


REFINE_Q = queue.Queue()


def resolve_bg(job):
    try:
        job.resolve()
    except Exception as e:
        if not job.resolved:
            job.error = str(e)
            job.status = "Алдаа: " + str(e)[:120]
            log("Видеог таньж чадсангүй:", e)
    finally:
        job.resolving = False


def refiner():
    """Хадмалын хурдан орчуулгыг ард нь AI-аар (Gemini/Claude) сайжруулна.
    Copilot-ийг PDF/текстэд хэмнэж, видеонд өдрийн хязгаартай."""
    while True:
        job, cues = REFINE_Q.get()
        translator = TRANSLATOR
        if not translator or not translator.needs_refine():
            continue
        if cues[-1]["end"] < job.playhead - 5:
            continue  # тоглуулж буй хэсгээс хол хоцорсон
        if usage_today().get("video", 0) >= VIDEO_AI_DAILY:
            continue  # өнөөдрийн видеоны AI хязгаар дүүрсэн — Google орчуулга үлдэнэ
        try:
            with job.lock:
                context = [c["orig"] for c in job.cues if c["start"] < cues[0]["start"]][-3:]
            src = [c["orig"] for c in cues]
            better = translate_sentencewise(
                src, lambda xs: translator.quality(xs, context, exclude=("Copilot",)),
                [(c["start"], c["end"]) for c in cues])
            usage_add("video")
            with job.lock:
                for c, m in zip(cues, better):
                    if m:
                        c["mn"], c["q"] = m, "ai"
            job._save_cache()
            log(f"Хадмал сайжрууллаа: {fmt(cues[0]['start'])} ({len(cues)} мөр)")
        except Exception as e:
            log("Сайжруулалт алгаслаа:", str(e)[:150])


# ---------------------------------------------------------------- өдрийн хэрэглээ
VIDEO_AI_DAILY = 300
_USAGE = {"day": None, "n": {}, "saved": 0}


def _usage_file():
    return os.path.join(ROOT, "usage.json")


def usage_today():
    day = time.strftime("%Y-%m-%d")
    if _USAGE["day"] != day:
        _USAGE["day"], _USAGE["n"] = day, {}
        try:
            d = json.load(open(_usage_file(), encoding="utf-8"))
            if d.get("day") == day:
                _USAGE["n"] = d.get("n", {})
        except Exception:
            pass
    return _USAGE["n"]


def usage_add(name, k=1):
    n = usage_today()
    n[name] = n.get(name, 0) + k
    STATE["usage"] = dict(n)
    if time.time() - _USAGE["saved"] > 10:
        _USAGE["saved"] = time.time()
        try:
            json.dump({"day": _USAGE["day"], "n": n}, open(_usage_file(), "w", encoding="utf-8"))
        except Exception:
            pass


TRANSLATOR = None


def reload_translator():
    """Түлхүүр солигдсоны дараа орчуулагчийг дахин үүсгэнэ."""
    global TRANSLATOR
    TRANSLATOR = Translator()
    STATE["translator"] = TRANSLATOR.name
    log(f"Орчуулагч: {TRANSLATOR.name}")
    return TRANSLATOR


def worker():
    global TRANSLATOR, BATCHED
    try:
        translator = TRANSLATOR = Translator()
    except Exception as e:
        STATE["model"] = "error: " + str(e)
        log(STATE["model"])
        return
    STATE.update(model="idle", translator=translator.name)
    threading.Thread(target=refiner, daemon=True, name="hm-refiner").start()
    log(f"Бэлэн! [орчуулга: {translator.name}] Chrome дээр видеогоо тоглуулна уу.")
    model, last_work = None, time.time()

    prev_job = None
    while True:
        job = STATE["active"]
        if job is not prev_job:
            if prev_job is not None:
                prev_job.stop_prefetch()
            prev_job = job
        if job and not job.error and time.time() - job.last_seen > 60:
            job.stop_prefetch()  # үзэхээ больсон бол татахаа зогсооно
        if not job or job.error or time.time() - job.last_seen > 20:
            # удаан хэрэглээгүй бол видео картын санах ойг чөлөөлнө
            if model is not None and time.time() - last_work > IDLE_UNLOAD_SEC:
                model = BATCHED = None
                import gc
                gc.collect()
                STATE["model"] = "idle"
                log("Удаан хэрэглээгүй тул Whisper загварыг санах ойгоос буулгалаа")
            time.sleep(0.3)
            continue
        last_work = time.time()
        translator = TRANSLATOR
        if model is None and job.resolved and job.mode == "audio" and choose_asr() == "local":  # хадмалтай видеод Whisper хэрэггүй
            try:
                STATE["model"] = "loading"
                model, desc = load_model()
                STATE.update(model="ready", model_desc=desc)
                log(f"Whisper бэлэн: {desc}")
            except Exception as e:
                msg = str(e)
                if STATE.get("missing_vc"):
                    msg = "Visual C++ Redistributable суулгах хэрэгтэй: " + VC_REDIST_URL
                STATE["model"] = "error: " + msg
                log(STATE["model"])
                time.sleep(30)
                continue
        try:
            if not job.resolved:
                # таних явцыг тусдаа урсгалд (гацвал бусад видеог хүлээлгэхгүй)
                if not getattr(job, "resolving", False):
                    job.resolving, job.resolve_t0 = True, time.time()
                    job.status = "Видеог таньж байна…"
                    threading.Thread(target=resolve_bg, args=(job,), daemon=True).start()
                elif time.time() - job.resolve_t0 > 120:
                    job.error = "Видеог таньж чадсангүй (хугацаа хэтэрлээ)"
                    job.status = "Алдаа: " + job.error
                    log(job.error, job.title[:60])
                time.sleep(0.2)
                continue
            t = job.next_start()
            if t is None or t - job.playhead > LOOKAHEAD:
                job.status = "ready"
                time.sleep(0.3)
                continue
            if job.mode == "subs":
                process_subs_chunk(job, t, translator)
            elif choose_asr() == "gemini":
                STATE["model_desc"] = "Gemini (онлайн)"
                process_audio_chunk(job, t, None, translator, asr="gemini")
            elif model is None:
                continue  # дараагийн давталтаар загвар ачаална
            else:
                process_audio_chunk(job, t, model, translator)
            job.fails = 0
            job.status = "ready" if job.ahead() > 5 else "Бэлтгэж байна…"
        except TranslateError as e:
            log("Орчуулга түр бүтэлгүйтлээ, 10 сек дараа дахин оролдоно:", e)
            job.status = "Орчуулга саатаж байна, дахин оролдож байна…"
            time.sleep(10)
        except Exception as e:
            job.fails += 1
            log("Алдаа:", e)
            traceback.print_exc()
            if job.fails >= 3 or not job.resolved:
                job.error = str(e)
                job.status = "Алдаа: " + str(e)[:120]
            time.sleep(1)


# ---------------------------------------------------------------- тохиргоо
SETTINGS_FILE = os.path.join(ROOT, "settings.json")
DEFAULT_SETTINGS = {
    "subs": True,          # видеоны хадмал
    "hover": True,         # үг дээр mouse очиход орчуулах
    "hover_mode": "ctrl",  # "ctrl" = Ctrl дарсан үед, "always" = шууд
    "select": True,        # сонгосон текстийг орчуулах
    "pdf": True,           # PDF-ийг орчуулагч үзүүлэгчээр нээх
    "quality": True,       # сонголт/хуудсыг Gemini-ээр (түлхүүр байвал)
    "asr": "auto",         # яриа таних: auto / local (Whisper) / gemini (онлайн)
    "pro_terms": True,     # мэргэжлийн нэр томьёог англиар хаалтанд үлдээх
}


def load_settings():
    s = dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            s.update({k: v for k, v in json.load(f).items() if k in DEFAULT_SETTINGS})
    except Exception:
        pass
    return s


SETTINGS = load_settings()


def save_settings(update):
    for k, v in (update or {}).items():
        if k in DEFAULT_SETTINGS and type(v) is type(DEFAULT_SETTINGS[k]):
            SETTINGS[k] = v
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(SETTINGS, f, ensure_ascii=False, indent=1)
    except Exception as e:
        log("Тохиргоо хадгалах алдаа:", e)
    return SETTINGS


# ---------------------------------------------------------------- текст орчуулга
TR_CACHE, TR_CACHE_LOCK = {}, threading.Lock()
# AI-ийн орчуулгыг диск дээр хадгална — програм дахин асахад ижил текстийг дахин AI-аар орчуулж квот зарахгүй.
# (Google-ийн нөөц орчуулга кэшлэгдэхгүй — дараа нь AI-аар сайжруулна.) Хэрэглэгчийн файл: суулгагч/zip-д орохгүй.
TR_CACHE_FILE = os.path.join(CACHE_DIR, "translations.json")
TR_CACHE_MAX = 30000
_TR_DIRTY = [False]


def load_tr_cache():
    try:
        with open(TR_CACHE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        with TR_CACHE_LOCK:
            for k, v in data.items():
                TR_CACHE[tuple(json.loads(k))] = v
        log(f"Орчуулгын кэш: {len(TR_CACHE)} мөр ачааллаа")
    except FileNotFoundError:
        pass
    except Exception as e:
        log("Орчуулгын кэш уншигдсангүй (шинээр эхэлнэ):", repr(e)[:120])


def save_tr_cache():
    with TR_CACHE_LOCK:
        if not _TR_DIRTY[0]:
            return
        data = {json.dumps(list(k), ensure_ascii=False): v for k, v in TR_CACHE.items()}
        _TR_DIRTY[0] = False
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = TR_CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, TR_CACHE_FILE)        # бичиж дуусаагүй файл үлдэхгүй
    except Exception as e:
        _TR_DIRTY[0] = True
        log("Орчуулгын кэш хадгалагдсангүй:", repr(e)[:120])


def _tr_cache_saver():
    while True:
        time.sleep(20)
        save_tr_cache()
        save_words()


# ---------------------------------------------------------------- миний үгс (давтлага)
# Ctrl+үг, сонгосон ганц үгийг автоматаар хадгална → тохиргооны цонхны «Миний үгс»-д жагсаалт, карт.
# Хэрэглэгчийн файл (words.json) — суулгагч/zip-д орохгүй, шинэ хувилбар суулгахад хадгалагдана.
WORDS_FILE = os.path.join(ROOT, "words.json")
WORDS, WORDS_LOCK = {}, threading.Lock()
_WORDS_DIRTY = [False]
WORDS_MAX = 3000
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{1,40}")


def load_words():
    try:
        with open(WORDS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        with WORDS_LOCK:
            WORDS.update({k: v for k, v in data.items() if isinstance(v, dict) and v.get("mn")})
    except FileNotFoundError:
        pass
    except Exception as e:
        log("Миний үгс уншигдсангүй:", repr(e)[:120])


def save_words():
    with WORDS_LOCK:
        if not _WORDS_DIRTY[0]:
            return
        data = dict(WORDS)
        _WORDS_DIRTY[0] = False
    try:
        tmp = WORDS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=0)
        os.replace(tmp, WORDS_FILE)
    except Exception as e:
        _WORDS_DIRTY[0] = True
        log("Миний үгс хадгалагдсангүй:", repr(e)[:120])


def remember_word(word, mn):
    word = (word or "").strip()
    if not mn or not _WORD_RE.fullmatch(word):
        return
    k, now = word.lower(), int(time.time())
    with WORDS_LOCK:
        e = WORDS.get(k) or {"w": word, "n": 0, "learned": False, "first": now}
        e.update(mn=mn[:200], n=e.get("n", 0) + 1, last=now)
        if e["n"] > 1 and e.get("learned"):
            e["learned"] = False          # «сурсан» гэсэн үгээ дахин хайвал давтлагад буцаана
        WORDS[k] = e
        if len(WORDS) > WORDS_MAX:        # хамгийн удаан хайгаагүйг нь хасна
            del WORDS[min(WORDS, key=lambda x: WORDS[x].get("last", 0))]
        _WORDS_DIRTY[0] = True


def words_list():
    with WORDS_LOCK:
        items = [{"k": k, **v} for k, v in WORDS.items()]
    items.sort(key=lambda x: -x.get("last", 0))
    return items


def word_update(k, learned=None, delete=False):
    with WORDS_LOCK:
        if k not in WORDS:
            return False
        if delete:
            del WORDS[k]
        elif learned is not None:
            WORDS[k]["learned"] = bool(learned)
        _WORDS_DIRTY[0] = True
    return True


# ---------------------------------------------------------------- шинэ хувилбар шалгах (GitHub Releases)
# UPDATE_REPO = "owner/repo" — GitHub дээрх Releases-ийн хамгийн сүүлийн хувилбарыг шалгана.
# Release-ийн tag нь "v1.12.0" гэх мэт, хавсралтад Helmerch-Setup-….exe байна. Хоосон бол шалгахгүй.
UPDATE_REPO = "Pulse0330/helmerch"
UPDATE = {}


def _ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", s or "")[:3])


def check_update():
    if not UPDATE_REPO:
        return
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest",
                                     headers={"User-Agent": "Helmerch-updater", "Accept": "application/vnd.github+json"})
        d = json.loads(urllib.request.urlopen(req, timeout=15).read())
        tag = d.get("tag_name") or ""
        if _ver(tag) > _ver(VERSION):
            exe = next((a.get("browser_download_url") for a in d.get("assets") or []
                        if (a.get("name") or "").lower().endswith(".exe")), None)
            UPDATE.update(version=tag.lstrip("vV"), url=exe or d.get("html_url"), direct=bool(exe),
                          notes=(d.get("body") or "")[:800])
            log(f"Шинэ хувилбар гарсан: {tag}")
        else:
            UPDATE.clear()
    except urllib.error.HTTPError as e:
        if e.code != 404:                    # 404 = release хараахан гаргаагүй (хэвийн)
            log("Шинэ хувилбар шалгаж чадсангүй (дараа дахин):", repr(e)[:120])
    except Exception as e:
        log("Шинэ хувилбар шалгаж чадсангүй (дараа дахин):", repr(e)[:120])


def _update_loop():
    time.sleep(30)
    while True:
        check_update()
        time.sleep(6 * 3600)


def _norm(t):
    return re.sub(r"\s+", " ", str(t)).strip()[:5000]


def _google_batches(tr, texts, limit=1800):
    out, batch, size = [], [], 0
    for t in texts:
        if batch and size + len(t) > limit:
            out += tr._google(batch)
            batch, size = [], 0
        batch.append(t)
        size += len(t) + 1
    if batch:
        out += tr._google(batch)
    return out


FRIENDLY_ERR = "Орчуулга түр саатлаа — интернэт холболтоо шалгаад дахин оролдоно уу"


def api_translate(req):
    tr = TRANSLATOR
    for _ in range(50):
        if tr:
            break
        time.sleep(0.2)
        tr = TRANSLATOR
    if not tr:
        return {"error": "Програм эхэлж байна, хэдэн секундийн дараа дахин оролдоно уу"}
    kind = req.get("kind", "text")
    quality = bool(req.get("quality")) and bool(tr.gemini_key or tr.github_token or tr.claude)
    pro_terms = bool(SETTINGS.get("pro_terms", True))
    texts = [_norm(t) for t in (req.get("texts") or [])][:300]
    results = [None] * len(texts)
    todo = []
    key = lambda t: (kind, quality, pro_terms, t)
    with TR_CACHE_LOCK:
        for i, t in enumerate(texts):
            hit = TR_CACHE.get(key(t))
            if hit is not None:
                results[i] = hit
            elif t:
                todo.append(i)
            else:
                results[i] = {"mn": ""}
    cacheable = set()
    tiers, tier = set(), "google"
    if kind == "word":
        for i in todo:
            for attempt in range(2):
                try:
                    mn, alts = tr.google_word(texts[i])
                    results[i] = {"mn": mn, "alts": alts}
                    cacheable.add(i)
                    _mark("Google", True)
                    break
                except Exception as e:
                    _mark("Google", False, e)
                    if attempt == 0:
                        time.sleep(1)
            if results[i] is None and quality:  # Google ажиллахгүй бол AI-аар
                try:
                    results[i] = {"mn": tr.quality([texts[i]], None, style="pro", pro_terms=False)[0]}
                except Exception:
                    pass
    elif todo:
        ctx = [_norm(req.get("context", ""))[:500]] if req.get("context") else None
        N = 20
        for k in range(0, len(todo), N):
            idx = todo[k:k + N]
            src = [texts[i] for i in idx]
            mns = None
            has_ai = bool(tr.gemini_key or tr.github_token or tr.claude) and SETTINGS.get("quality", True)
            if quality:
                try:
                    mns = tr.quality(src, ctx, style="pro", pro_terms=pro_terms)
                    cacheable.update(idx)
                    tier = "pro"
                except Exception as e:
                    log("Сайн чанарын орчуулга бүтсэнгүй, хурдан AI/Google ашиглалаа:", str(e)[:200])
            # хурдан шат: Google-ийн оронд хурдан AI (Gemini lite / GPT mini) — Google зөвхөн нөөц
            if mns is None and has_ai:
                try:
                    mns = tr.quality(src, ctx, style="pro", pro_terms=pro_terms, lite=True)
                    cacheable.update(idx)
                    tier = "pro" if quality else "fast"
                except Exception as e:
                    log("Хурдан AI орчуулга бүтсэнгүй, Google ашиглалаа:", str(e)[:200])
            if mns is None:
                for attempt in range(2):
                    try:
                        mns = _google_batches(tr, src)
                        _mark("Google", True)
                        tier = "google"     # нөөц — кэшлэхгүй, дараа нь AI-аар дахин оролдоно
                        break
                    except Exception as e:
                        _mark("Google", False, e)
                        if attempt == 0 and time.time() >= getattr(tr, "google_until", 0):
                            time.sleep(1.5)
                        else:
                            break
            if mns is not None:
                tiers.add(tier)
                for i, m in zip(idx, mns):
                    results[i] = {"mn": m}
    # AI заримдаа эх бичвэрийг бүтнээр нь хаалтанд давтдаг: "Апп татах (Get the app)" → "Апп татах"
    for i in todo:
        r = results[i]
        if r and r.get("mn") and kind != "word":
            src = texts[i].strip().rstrip(".!?:")
            if len(src) > 2:
                r["mn"] = re.sub(r"\s*\(\s*" + re.escape(src) + r"[.!?:]*\s*\)", "", r["mn"], flags=re.I).strip()
    if any(results[i] is None for i in todo):
        if all(results[i] is None for i in todo):
            log("Текст орчуулга бүтсэнгүй (бүх үйлчилгээ)")
            return {"error": FRIENDLY_ERR}
    with TR_CACHE_LOCK:
        for i in cacheable:  # нөөц (Google) орчуулгыг хадгалахгүй → дараа нь сайн чанартайгаар дахин
            if results[i] is not None:
                TR_CACHE[key(texts[i])] = results[i]
                _TR_DIRTY[0] = True
        while len(TR_CACHE) > TR_CACHE_MAX:      # хамгийн хуучнаас нь хасна (бүгдийг арилгахгүй)
            TR_CACHE.pop(next(iter(TR_CACHE)))
    if kind == "word" and req.get("remember"):   # хэрэглэгч өөрөө хайсан үг → «Миний үгс»
        for i, t in enumerate(texts):
            if results[i] and results[i].get("mn"):
                remember_word(t, results[i]["mn"])
    # tier: "pro" = хүчтэй AI (дахин сайжруулах хэрэггүй), "fast" = хурдан AI, "google" = нөөц
    t = "pro" if tiers == {"pro"} else ("google" if "google" in tiers else ("fast" if tiers else "pro"))
    return {"results": [r or {"mn": ""} for r in results], "tier": t, "ai": t == "pro"}


def api_ocr(req):
    tr = TRANSLATOR
    if not tr:
        return {"error": "Програм бэлэн болоогүй байна"}
    img = req.get("image") or ""
    mime = "image/png"
    m = re.match(r"data:([\w/+.-]+);base64,(.*)", img, re.S)
    if m:
        mime, img = m.group(1), m.group(2)
    try:
        return tr.gemini_image(img, mime)
    except TranslateError as e:
        return {"error": str(e)[:200]}
    except Exception as e:
        log("Зураг орчуулах алдаа:", e)
        _mark("Gemini", False, e)
        return {"error": "Зургийг орчуулж чадсангүй — хэдэн секундийн дараа дахин оролдоно уу"}


ON_SHOW = None  # desktop цонхыг харуулах функц (hadmal_app тохируулна)
UI_HANDLER = None  # desktop цонхны (вэб UI) үйлдлүүд — hadmal_app тохируулна
UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui")


def ui_token():
    """Desktop цонхны нууц түлхүүр — өөр вэб сайт тохиргоог өөрчилж чадахгүй байхын тулд."""
    path = os.path.join(ROOT, "ui_token.txt")
    try:
        t = open(path, encoding="utf-8").read().strip()
        if len(t) >= 20:
            return t
    except Exception:
        pass
    import secrets
    t = secrets.token_urlsafe(24)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(t)
    except Exception:
        pass
    return t


UI_TOKEN = None


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _file(self, path, ctype):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            return self._json({"error": "not found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/ui" or self.path.startswith("/ui?") or self.path.startswith("/ui#"):
            return self._file(os.path.join(UI_DIR, "index.html"), "text/html; charset=utf-8")
        if self.path.startswith("/ui/"):
            name = os.path.basename(self.path.split("?")[0])
            ctype = {"svg": "image/svg+xml", "png": "image/png", "ico": "image/x-icon",
                     "css": "text/css; charset=utf-8", "js": "text/javascript; charset=utf-8"}.get(
                name.rsplit(".", 1)[-1], "application/octet-stream")
            return self._file(os.path.join(UI_DIR, name), ctype)
        if self.path.startswith("/settings"):
            return self._json({**SETTINGS, "_version": VERSION})
        self._json({"ok": True, "version": VERSION, "update": UPDATE.get("version") or "",
                    **{k: v for k, v in STATE.items() if k != "active"}})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json({"error": "bad request"}, 400)

        if self.path == "/ui/api":
            if not UI_TOKEN or req.get("t") != UI_TOKEN:
                return self._json({"error": "forbidden"}, 403)
            if not UI_HANDLER:
                return self._json({"error": "UI бэлэн биш"}, 503)
            try:
                return self._json(UI_HANDLER(req))
            except Exception as e:
                log("UI алдаа:", e)
                return self._json({"error": str(e)[:200]}, 500)
        if self.path in ("/translate", "/ocr"):
            # гэнэтийн алдаа гарсан ч серверийн хариу эвдрэхгүй — өргөтгөл чимээгүй дахин оролдоно
            try:
                return self._json(api_translate(req) if self.path == "/translate" else api_ocr(req))
            except Exception as e:
                log("Орчуулгын хүсэлт:", repr(e)[:200])
                return self._json({"error": FRIENDLY_ERR})
        if self.path == "/settings":
            return self._json(save_settings(req))
        if self.path == "/show":
            if ON_SHOW:
                ON_SHOW()
                return self._json({"ok": True})
            return self._json({"ok": False})

        if self.path == "/start":
            if not SETTINGS.get("subs", True):
                return self._json({"disabled": True})
            key = "|".join([req.get("page_url") or "", req.get("frame_url") or "",
                            str(round(req.get("duration") or 0))])
            jid = hashlib.sha1(key.encode()).hexdigest()[:16]
            with JOBS_LOCK:
                job = JOBS.get(jid)
                if job is None or job.error:
                    job = Job(key, req)
                    JOBS[jid] = job
                    log("Шинэ видео:", (req.get("title") or req.get("page_url") or "")[:80])
                job.playhead = float(req.get("time") or 0)
                job.last_seen = time.time()
                STATE["active"] = job
            return self._json({"job_id": job.id})

        if self.path == "/poll":
            job = JOBS.get(req.get("job_id") or "")
            if job is None:
                return self._json({"error": "unknown"})
            t = float(req.get("time") or 0)
            job.playhead, job.last_seen = t, time.time()
            if req.get("media_urls") and job.resolved and job.mode == "audio":
                n = job.add_media(req["media_urls"])
                if n:
                    log(f"Шинэ видео холбоос {n} барилаа")
            tc = req.get("track_cues") or []
            if tc and job.resolved and job.mode == "audio" and len(tc) > len(getattr(job, "track_seen", [])) + 20:
                job.track_seen = tc
                threading.Thread(target=job.use_track_cues, args=(tc, req.get("track_lang") or ""),
                                 daemon=True).start()
            new_subs = [u for u in (req.get("sub_urls") or []) if u not in getattr(job, "sub_tried", set())]
            if new_subs and job.resolved and job.mode == "audio" and not getattr(job, "sub_busy", False):
                job.sub_busy = True

                def _late(j=job, urls=new_subs):
                    try:
                        j.try_site_subs(urls, switch=True)
                    finally:
                        j.sub_busy = False
                threading.Thread(target=_late, daemon=True).start()
            STATE["active"] = job
            with job.lock:
                cues = [c for c in job.cues if t - 15 <= c["start"] <= t + LOOKAHEAD]
            if STATE["model"] == "loading" and job.mode != "subs":
                status = "Загвар ачаалж байна…"
            elif STATE["model"] not in ("ready", "idle", "loading") or job.error:
                # алдааг хэрэглэгчид харуулахгүй (логт аль хэдийн бичигдсэн) — хадмал чимээгүй л гарахгүй
                status = ""
            elif job.ahead() > 3:
                status = "ready"
            else:
                status = job.status if job.status != "ready" else "Бэлтгэж байна…"
            return self._json({"status": status, "cues": cues})

        self._json({"error": "not found"}, 404)


class _Tee:
    """Хар цонх болон hadmal.log файлд зэрэг бичнэ."""
    def __init__(self, stream, f):
        self.stream, self.f = stream, f

    def write(self, s):
        for out in (self.stream, self.f):
            try:
                out.write(s)
                out.flush()
            except Exception:
                pass

    def flush(self):
        pass


def setup_log():
    try:
        f = open(os.path.join(ROOT, "hadmal.log"), "w", encoding="utf-8")
        sys.stdout = _Tee(sys.__stdout__, f)
        sys.stderr = _Tee(sys.__stderr__, f)
    except Exception:
        pass


class Server(ThreadingHTTPServer):
    # Windows: SO_REUSEADDR-гүй bind нь өөр идэвхтэй сервер байвал алдаа өгнө (хоёр дахь хуулбар асахгүй),
    # харин хуучин холболтууд (TIME_WAIT) дахин эхлүүлэхэд саад болохгүй.
    allow_reuse_address = sys.platform != "win32"
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Chrome хүлээлгүй холболтоо таслах нь хэвийн (таб хаагдах, хуудас солигдох) — логийг дүүргэхгүй
        e = sys.exc_info()[1]
        if isinstance(e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError)):
            return
        log("HTTP хүсэлтийн алдаа:", repr(e)[:200])


def start():
    """Серверийг асаана. Аль хэдийн ажиллаж байвал OSError."""
    server = Server(("127.0.0.1", PORT), Handler)
    setup_log()
    global UI_TOKEN
    UI_TOKEN = ui_token()
    log(f"Хэлмэрч v{VERSION} эхэллээ")
    log(f"Python {sys.version.split()[0]} · {sys.executable}")
    add_cuda_dlls()
    load_tr_cache()
    load_words()
    import atexit
    atexit.register(save_tr_cache)
    atexit.register(save_words)
    threading.Thread(target=_tr_cache_saver, daemon=True, name="hm-cache").start()
    threading.Thread(target=_update_loop, daemon=True, name="hm-update").start()
    threading.Thread(target=worker, daemon=True, name="hm-worker").start()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"Сервер ажиллаж байна: http://127.0.0.1:{PORT}")
    return server


def main():
    try:
        start()
    except OSError:
        print("Монгол хадмал аль хэдийн ажиллаж байна (taskbar-ийн МН дүрсийг харна уу).")
        return
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise
