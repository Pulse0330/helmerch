# -*- coding: utf-8 -*-
"""
Хэлмэрч — desktop програм (видео хадмал, PDF/текст орчуулга).
  • Цонх: хадмал / текст орчуулгыг асаах-унтраах, тохиргоо
  • Tray (цагны хажууд) МН дүрс — цонхыг хаахад энд үлдэнэ
  • Ctrl+Alt+T — дэлгэцийн хэсгийг зурж орчуулах (скан PDF, зураг, бусад програм)
"""
import os
import sys
import json
import queue
import subprocess
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

APP_NAME = "Хэлмэрч"
TITLE = APP_NAME
OLD_NAMES = [n for n in ("Mongol hadmal", "My Heart", "Хэлмэрч") if n != APP_NAME]
ICON_PATH = os.path.join(ROOT, "helmerch.ico")
WIN = sys.platform == "win32"

# ffmpeg, deno гэх мэт дэд програмууд хар цонх гаргахгүй байх
if WIN:
    _orig_popen_init = subprocess.Popen.__init__

    def _quiet_popen_init(self, *args, **kwargs):
        if not kwargs.get("creationflags"):
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        _orig_popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _quiet_popen_init


# ---------------------------------------------------------------- дүрс
def heart_points(cx, cy, scale, n=90):
    """Зүрхний хэлбэрийн цэгүүд (параметрт тэгшитгэл)."""
    import math
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * scale, cy - y * scale))
    return pts


def make_image(state="idle", size=64):
    """Tray дүрс: Хэлмэрчийн лого, өлзий хээний өнгө нь төлөвийг заана."""
    import logo
    return logo.icon_image(state, size)


COLORS = {"ready": 1, "idle": 1, "loading": 1, "error": 1}


# ---------------------------------------------------------------- товчлол, автоматаар эхлэх
def startup_lnk():
    return os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup",
                        APP_NAME + ".lnk")


def make_shortcut(path, args=""):
    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK);"
          "$s.TargetPath=$env:TGT;$s.Arguments=$env:ARG;"
          "$s.WorkingDirectory=$env:WD;$s.IconLocation=$env:ICO;$s.Save()")
    env = dict(os.environ, LNK=path, TGT=pythonw, ARG=f'"{os.path.abspath(__file__)}" {args}'.strip(),
               WD=ROOT, ICO=ICON_PATH)
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                   env=env, capture_output=True)


def autostart_on():
    return os.path.exists(startup_lnk())


def set_autostart(on):
    lnk = startup_lnk()
    if on:
        make_shortcut(lnk, "--tray")
    elif os.path.exists(lnk):
        os.remove(lnk)


def desktop_dir():
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(260)
        ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf)
        if buf.value:
            return buf.value
    except Exception:
        pass
    return os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")


def remove_old_shortcuts():
    startup = os.path.dirname(startup_lnk())
    for name in OLD_NAMES:
        for d in (desktop_dir(), startup):
            try:
                os.remove(os.path.join(d, name + ".lnk"))
            except OSError:
                pass


def migrate_shortcuts():
    """Хуучин нэртэй (Mongol hadmal, My Heart) товчлолуудыг шинэ нэрээр солино — дахин суулгахгүйгээр."""
    try:
        startup = os.path.dirname(startup_lnk())
        had_desk = any(os.path.exists(os.path.join(desktop_dir(), n + ".lnk")) for n in OLD_NAMES)
        had_start = any(os.path.exists(os.path.join(startup, n + ".lnk")) for n in OLD_NAMES)
        if not (had_desk or had_start):
            return
        remove_old_shortcuts()
        try:
            import logo
            logo.save_ico(ICON_PATH)          # хуучин (зүрхтэй) дүрсийг өлзийгөөр солино
        except Exception:
            pass
        if had_desk:
            make_shortcut(os.path.join(desktop_dir(), APP_NAME + ".lnk"))
        if had_start:
            set_autostart(True)
    except Exception:
        pass


def install():
    """Суулгагчаас нэг удаа: дүрс, Desktop товчлол, автоматаар эхлэх."""
    remove_old_shortcuts()
    import logo
    logo.save_ico(ICON_PATH)
    make_shortcut(os.path.join(desktop_dir(), APP_NAME + ".lnk"))
    set_autostart(True)


# ---------------------------------------------------------------- Ctrl+Alt+T
def hotkey_thread(ui_q):
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, WM_HOTKEY = 0x1, 0x2, 0x4000, 0x0312
    if not user32.RegisterHotKey(None, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, ord("T")):
        ui_q.put(("log", "Ctrl+Alt+T товчлол өөр програмд эзлэгдсэн байна"))
        return
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        if msg.message == WM_HOTKEY:
            ui_q.put(("capture",))


# ---------------------------------------------------------------- цонх (вэб UI)
def browser_exe():
    """Edge (Windows бүрт бий) эсвэл Chrome — цонхыг 'app' горимоор (хаягийн мөргүй) нээнэ."""
    pf, pf86, la = (os.environ.get(k, "") for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"))
    for p in (os.path.join(pf86, r"Microsoft\Edge\Application\msedge.exe"),
              os.path.join(pf, r"Microsoft\Edge\Application\msedge.exe"),
              os.path.join(pf, r"Google\Chrome\Application\chrome.exe"),
              os.path.join(pf86, r"Google\Chrome\Application\chrome.exe"),
              os.path.join(la, r"Google\Chrome\Application\chrome.exe")):
        if p and os.path.exists(p):
            return p
    return None


def find_windows(prefix):
    """Гарчиг нь prefix-ээр эхэлсэн цонхнуудыг олно (UI цонхыг дахин нээхгүй, урд нь гаргахад)."""
    if not WIN:
        return []
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                if buf.value.startswith(prefix):
                    found.append(hwnd)
        return True
    user32.EnumWindows(cb, 0)
    return found


def focus_window(hwnd):
    import ctypes
    user32 = ctypes.windll.user32
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # өөр програм идэвхтэй үед ч урд нь гаргах
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetForegroundWindow(hwnd)


class App:
    def __init__(self, hs, start_hidden):
        import tkinter as tk
        from tkinter import ttk
        self.tk, self.ttk, self.hs = tk, ttk, hs
        self.ui_q = queue.Queue()
        self.ocr = {}
        hs.ON_SHOW = lambda: self.ui_q.put(("show",))
        hs.UI_HANDLER = self.ui_api

        # tkinter нь зөвхөн дэлгэцээс зурах, мэндчилгээнд хэрэгтэй — үндсэн цонх нь вэб UI
        self.root = root = tk.Tk()
        root.withdraw()
        self.f = max(1.0, root.winfo_fpixels("1i") / 96.0)
        try:
            root.iconbitmap(ICON_PATH)
        except Exception:
            pass

        if not os.path.exists(ICON_PATH):
            try:
                import logo
                logo.save_ico(ICON_PATH)
            except Exception:
                pass
        self.icon = None
        self.start_tray()
        if WIN:
            threading.Thread(target=hotkey_thread, args=(self.ui_q,), daemon=True).start()
        if not start_hidden:
            self.root.after(200, self.show)
        self.root.after(100, self.poll)
        self.root.after(500, self.refresh_status)

    # --- вэб UI нээх
    def ui_url(self, extra=""):
        return f"http://127.0.0.1:{self.hs.PORT}/ui?t={self.hs.UI_TOKEN}{extra}"

    def open_window(self, url, w, h, x=None, y=None):
        exe = browser_exe()
        if not exe:
            import webbrowser
            webbrowser.open(url)
            return
        f = self.f
        args = [exe, f"--app={url}", "--user-data-dir=" + os.path.join(ROOT, "ui-profile"),
                "--no-first-run", "--no-default-browser-check", "--disable-sync",
                f"--window-size={int(w * f)},{int(h * f)}"]
        if x is not None:
            args.append(f"--window-position={int(x)},{int(y)}")
        subprocess.Popen(args, cwd=ROOT)

    def show(self):
        wins = find_windows(TITLE) if WIN else []
        wins = [w for w in wins if not self._title(w).startswith(TITLE + " — ")]
        if wins:
            try:
                focus_window(wins[0])
                return
            except Exception:
                pass
        sh = self.root.winfo_screenheight() / self.f
        self.open_window(self.ui_url(), 480, min(860, sh - 80))
        self.root.after(1500, self.splash)

    def _title(self, hwnd):
        import ctypes
        n = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, n + 1)
        return buf.value

    def close_windows(self):
        if not WIN:
            return
        import ctypes
        for h in find_windows(TITLE):
            ctypes.windll.user32.PostMessageW(h, 0x0010, 0, 0)  # WM_CLOSE

    # --- вэб UI-ийн хүсэлтүүд (сервер дуудна, өөр урсгалд)
    def ui_api(self, req):
        hs, a = self.hs, req.get("action")
        if a == "state":
            return self.ui_state()
        if a == "settings":
            upd = {k: v for k, v in (req.get("update") or {}).items() if k in hs.DEFAULT_SETTINGS}
            return {"settings": hs.save_settings(upd)}
        if a == "key":
            name = {"gemini": "gemini_key.txt", "github": "github_token.txt"}.get(req.get("name"))
            if not name:
                return {"error": "unknown key"}
            self.write_key(name, (req.get("value") or "").strip())
            return {"ok": True}
        if a == "test":
            v = (req.get("value") or "").strip()
            if v and v != self._read_key("github_token.txt"):
                self.write_key("github_token.txt", v, reload=False)
                hs.reload_translator()
            ok, msg = hs.test_provider(req.get("name") or "Copilot")
            return {"ok": ok, "msg": msg}
        if a == "open":
            self.ui_q.put(("open", req.get("what")))
            return {"ok": True}
        if a == "autostart":
            set_autostart(bool(req.get("on")))
            return {"ok": True}
        if a == "capture":
            self.ui_q.put(("capture",))
            return {"ok": True}
        if a == "restart":
            self.ui_q.put(("restart",))
            return {"ok": True}
        if a == "quit":
            self.ui_q.put(("quit",))
            return {"ok": True}
        if a == "ocr":
            r = self.ocr.get(req.get("id"))
            return r if r is not None else {"pending": True}
        if a == "words":
            return {"words": hs.words_list()}
        if a == "word":
            ok = hs.word_update(req.get("k") or "", learned=req.get("learned"), delete=bool(req.get("delete")))
            return {"ok": ok}
        if a == "update":
            if not hs.UPDATE.get("url"):
                return {"error": "Шинэ хувилбар олдсонгүй"}
            threading.Thread(target=self.run_update, daemon=True).start()
            return {"ok": True}
        return {"error": "unknown action"}

    def run_update(self):
        """Шинэ Setup.exe-г татаж ажиллуулна. Суулгагч ажиллаж буй програмыг өөрөө хааж, тохиргоо/түлхүүрийг үлдээнэ."""
        import tempfile
        import webbrowser
        u = self.hs.UPDATE
        if not u.get("direct"):
            webbrowser.open(u["url"])             # .exe хавсралтгүй бол хуудсыг нь нээнэ
            return
        try:
            path = os.path.join(tempfile.gettempdir(), f"Helmerch-Setup-{u['version']}.exe")
            req = urllib.request.Request(u["url"], headers={"User-Agent": "Helmerch-updater"})
            with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
                while True:
                    b = r.read(1 << 16)
                    if not b:
                        break
                    f.write(b)
            os.replace(path + ".part", path)
            self.save_state()
            os.startfile(path)
        except Exception as e:
            self.hs.log("Шинэчлэлт татаж чадсангүй, хуудсыг нээлээ:", repr(e)[:150])
            webbrowser.open(u["url"])

    def ui_state(self):
        hs = self.hs
        k, text = self.state()
        try:
            usage = hs.usage_today()
        except Exception:
            usage = {}
        keys = {}
        for short, fname in (("gemini", "gemini_key.txt"), ("github", "github_token.txt")):
            v = self._read_key(fname)
            keys[short] = {"set": bool(v), "tail": v[-4:] if len(v) > 8 else ""}
        return {
            "version": hs.VERSION, "status": {"kind": k, "text": text}, "app_name": APP_NAME,
            "settings": hs.SETTINGS, "autostart": autostart_on(), "keys": keys,
            "providers": hs.STATE.get("providers") or {}, "translator": hs.STATE.get("translator") or "",
            "asr_desc": hs.STATE.get("model_desc") or "", "usage": usage, "video_daily": hs.VIDEO_AI_DAILY,
            "update": {k: hs.UPDATE.get(k) for k in ("version", "notes")} if hs.UPDATE.get("version") else None,
            "words_n": len(hs.WORDS), "words_todo": sum(1 for w in list(hs.WORDS.values()) if not w.get("learned")),
        }

    def write_key(self, name, value, reload=True):
        path = os.path.join(ROOT, name)
        if value:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(value)
        elif os.path.exists(path):
            os.remove(path)
        if reload:
            threading.Thread(target=self.hs.reload_translator, daemon=True).start()

    def open_thing(self, what):
        import webbrowser
        try:
            if what == "guide":
                os.startfile(os.path.join(ROOT, "ZAAVAR.html"))
            elif what == "log":
                os.startfile(os.path.join(ROOT, "hadmal.log"))
            elif what == "glossary":
                self.hs.load_glossary()  # байхгүй бол үүсгэнэ
                os.startfile(self.hs.glossary_path())
            elif what == "token":
                webbrowser.open("https://github.com/settings/personal-access-tokens/new")
            elif what == "gemini_key":
                webbrowser.open("https://aistudio.google.com/apikey")
        except Exception as e:
            self.hs.log("Нээж чадсангүй:", e)

    # --- хувийн мэндчилгээ: message.txt байвал л (бусад хүнд гарахгүй)
    def splash(self):
        import math
        import random
        path = os.path.join(ROOT, "message.txt")
        try:
            lines = [l.strip() for l in open(path, encoding="utf-8-sig").read().splitlines() if l.strip()]
        except Exception:
            return
        if not lines:
            return
        # нэг л удаа харуулна (бичиг өөрчлөгдвөл шинээр нэг удаа)
        import hashlib
        digest = hashlib.sha1("\n".join(lines).encode("utf-8")).hexdigest()
        seen = os.path.join(ROOT, "message_shown.txt")
        try:
            if open(seen, encoding="utf-8").read().strip() == digest:
                return
        except Exception:
            pass
        try:
            with open(seen, "w", encoding="utf-8") as fh:
                fh.write(digest)
        except Exception:
            pass
        tk = self.tk
        f = self.f
        W, H = int(480 * f), int(330 * f)
        BG, PINK, DEEP = "#fff1f5", "#ec407a", "#ad1457"
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        try:
            win.attributes("-alpha", 0.0)
        except Exception:
            pass
        sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
        win.geometry(f"{W}x{H}+{(sw - W) // 2}+{(sh - H) // 2 - 40}")
        cv = tk.Canvas(win, width=W, height=H, bg=BG, highlightthickness=2, highlightbackground="#f8bbd0")
        cv.pack()
        hx, hy, hs = W / 2, H * 0.34, 3.6 * f
        bubbles = []
        for _ in range(10):
            x, y, sc = random.uniform(20, W - 20), random.uniform(H * 0.4, H + 80), random.uniform(0.5, 1.1) * f
            col = random.choice(["#f8bbd0", "#f48fb1", "#f06292"])
            bubbles.append([cv.create_polygon(heart_points(x, y, sc), fill=col, outline="", smooth=True),
                            x, y, sc, random.uniform(0.6, 1.4) * f, random.uniform(0, 6.28)])
        hid = cv.create_polygon(heart_points(hx, hy, hs), fill=PINK, outline="", smooth=True)
        cv.create_text(hx, hy, text="♥", fill="white", font=("Segoe UI", 16, "bold"))
        cv.create_text(W / 2, H * 0.67, text=lines[0], fill=DEEP, font=("Segoe UI", 20, "bold"),
                       width=W - 30, justify="center")
        if len(lines) > 1:
            cv.create_text(W / 2, H * 0.80, text="\n".join(lines[1:3]), fill=PINK, font=("Segoe UI", 12),
                           width=W - 30, justify="center")
        st = {"t": 0.0, "alive": True}

        def fade(d, a):
            try:
                a = min(1.0, max(0.0, a + 0.08 * d))
                win.attributes("-alpha", a)
                if (d > 0 and a < 1.0) or (d < 0 and a > 0):
                    win.after(25, lambda: fade(d, a))
                elif d < 0:
                    win.destroy()
            except Exception:
                try:
                    win.destroy()
                except Exception:
                    pass

        def close(e=None):
            if st["alive"]:
                st["alive"] = False
                fade(-1, 1.0)

        def tick():
            if not st["alive"]:
                return
            st["t"] += 0.06
            t = st["t"]
            beat = 1 + 0.07 * max(0, math.sin(t * 3.2)) ** 3 + 0.04 * max(0, math.sin(t * 3.2 - 0.9)) ** 3
            cv.coords(hid, *[c for p in heart_points(hx, hy, hs * beat) for c in p])
            for b in bubbles:
                b[2] -= b[4]
                if b[2] < -20:
                    b[2], b[1] = H + 20, random.uniform(20, W - 20)
                cv.coords(b[0], *[c for p in heart_points(b[1] + 6 * math.sin(t + b[5]), b[2], b[3]) for c in p])
            win.after(40, tick)

        cv.bind("<Button-1>", close)
        tick()
        fade(+1, 0.0)
        win.after(8000, close)

    def open_guide(self):
        self.open_thing("guide")

    def _read_key(self, name="gemini_key.txt"):
        try:
            return open(os.path.join(ROOT, name), encoding="utf-8-sig").read().strip()
        except Exception:
            return ""

    # --- төлөв
    def state(self):
        m = self.hs.STATE.get("model", "")
        job = self.hs.STATE.get("active")
        busy = job and time.time() - job.last_seen < 20
        if m.startswith("error"):
            return "error", "Алдаа: " + m[7:90]
        if m == "loading":
            return "loading", "Whisper загвар ачаалж байна…"
        if busy:
            return "ready", "Хадмал хийж байна: " + (job.title or "видео")[:45]
        return "idle", "Бэлэн — Chrome дээр видео үзэх эсвэл текст орчуулах"

    def refresh_status(self):
        k, text = self.state()
        if self.icon:
            if getattr(self, "_last_k", None) != k:
                self.icon.icon = self.images[k]
                self._last_k = k
            self.icon.title = (TITLE + " — " + text)[:120]
        self.root.after(1500, self.refresh_status)

    # --- tray
    def start_tray(self):
        try:
            import pystray
        except Exception:
            return
        self.images = {k: make_image(k) for k in COLORS}
        q = self.ui_q
        menu = pystray.Menu(
            pystray.MenuItem("Нээх", lambda i, it: q.put(("show",)), default=True),
            pystray.MenuItem("📖 Ашиглах заавар", lambda i, it: q.put(("guide",))),
            pystray.MenuItem("Дэлгэцээс орчуулах (Ctrl+Alt+T)", lambda i, it: q.put(("capture",))),
            pystray.MenuItem("Видео хадмал", lambda i, it: q.put(("toggle", "subs")),
                             checked=lambda it: self.hs.SETTINGS.get("subs", True)),
            pystray.MenuItem("Текст орчуулга", lambda i, it: q.put(("toggle", "hover", "select")),
                             checked=lambda it: self.hs.SETTINGS.get("hover", True) or self.hs.SETTINGS.get("select", True)),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Дахин эхлүүлэх", lambda i, it: q.put(("restart",))),
            pystray.MenuItem("Гарах", lambda i, it: q.put(("quit",))),
        )
        try:
            self.icon = pystray.Icon(APP_NAME, self.images["idle"], TITLE, menu)
            self.icon.run_detached()
        except Exception as e:
            self.icon = None
            self.hs.log("Tray дүрс үүсгэж чадсангүй:", e)

    def poll(self):
        try:
            while True:
                cmd = self.ui_q.get_nowait()
                if cmd[0] == "show":
                    self.show()
                elif cmd[0] == "capture":
                    self.capture()
                elif cmd[0] == "toggle":
                    on = not any(self.hs.SETTINGS.get(k) for k in cmd[1:])
                    self.hs.save_settings({k: on for k in cmd[1:]})
                    if self.icon:
                        self.icon.update_menu()
                elif cmd[0] == "open":
                    self.open_thing(cmd[1])
                elif cmd[0] == "quit":
                    self.quit()
                elif cmd[0] == "restart":
                    self.restart()
                elif cmd[0] == "guide":
                    self.open_guide()
                elif cmd[0] == "call":
                    cmd[1]()
                elif cmd[0] == "log":
                    self.hs.log(cmd[1])
        except queue.Empty:
            pass
        self.root.after(100, self.poll)

    def restart(self):
        """Шинэчлэлт хийсний дараа програмыг дахин эхлүүлнэ (нээлттэй цонх өөрөө дахин холбогдоно)."""
        args = [sys.executable, os.path.abspath(__file__), "--wait", "--tray"]
        self.save_state()
        subprocess.Popen(args, cwd=ROOT)
        try:
            if self.icon:
                self.icon.stop()
        finally:
            os._exit(0)

    def save_state(self):
        """os._exit нь atexit-ийг алгасдаг тул гарахаасаа өмнө орчуулгын кэш, үгсийг хадгална."""
        for fn in ("save_tr_cache", "save_words"):
            try:
                getattr(self.hs, fn)()
            except Exception:
                pass

    def quit(self):
        self.close_windows()
        self.save_state()
        try:
            if self.icon:
                self.icon.stop()
        finally:
            os._exit(0)

    # --- дэлгэцээс орчуулах
    def capture(self):
        if getattr(self, "_capturing", False):
            return
        self._capturing = True
        from PIL import ImageGrab, ImageTk, ImageEnhance
        tk = self.tk
        try:
            shot = ImageGrab.grab(all_screens=True)
        except Exception:
            shot = ImageGrab.grab()
        # олон дэлгэцийн зүүн дээд цэг
        vx = vy = 0
        if WIN:
            import ctypes
            vx = ctypes.windll.user32.GetSystemMetrics(76)
            vy = ctypes.windll.user32.GetSystemMetrics(77)
        dim = ImageEnhance.Brightness(shot).enhance(0.55)
        top = tk.Toplevel(self.root)
        top.overrideredirect(True)
        top.geometry(f"{shot.width}x{shot.height}+{vx}+{vy}")
        top.attributes("-topmost", True)
        cv = tk.Canvas(top, width=shot.width, height=shot.height, highlightthickness=0, cursor="crosshair")
        cv.pack()
        bg = ImageTk.PhotoImage(dim)
        cv.create_image(0, 0, anchor="nw", image=bg)
        cv.create_text(shot.width // 2, 40, text="Орчуулах хэсгээ хулганаар зурна уу  ·  Esc = болих",
                       fill="white", font=("Segoe UI", 16, "bold"))
        st = {"x": 0, "y": 0, "rect": None, "crop": None, "photo": None}

        def press(e):
            st["x"], st["y"] = e.x, e.y

        def drag(e):
            x1, y1, x2, y2 = min(st["x"], e.x), min(st["y"], e.y), max(st["x"], e.x), max(st["y"], e.y)
            if x2 - x1 < 2 or y2 - y1 < 2:
                return
            st["photo"] = ImageTk.PhotoImage(shot.crop((x1, y1, x2, y2)))
            if st["crop"]:
                cv.delete(st["crop"])
                cv.delete(st["rect"])
            st["crop"] = cv.create_image(x1, y1, anchor="nw", image=st["photo"])
            st["rect"] = cv.create_rectangle(x1, y1, x2, y2, outline="#4f9cf2", width=2)

        def release(e):
            x1, y1, x2, y2 = min(st["x"], e.x), min(st["y"], e.y), max(st["x"], e.x), max(st["y"], e.y)
            close()
            if x2 - x1 > 8 and y2 - y1 > 8:
                self.translate_image(shot.crop((x1, y1, x2, y2)), (x1 + vx, y2 + vy))

        def close(e=None):
            self._capturing = False
            top.destroy()

        cv.bind("<ButtonPress-1>", press)
        cv.bind("<B1-Motion>", drag)
        cv.bind("<ButtonRelease-1>", release)
        top.bind("<Escape>", close)
        top.bg = bg
        top.focus_force()

    def translate_image(self, img, pos):
        """Зурсан хэсгийг Gemini-ээр уншиж орчуулаад, жижиг цонхонд харуулна."""
        import base64
        import io
        import uuid
        if img.width > 1800:
            img = img.resize((1800, int(img.height * 1800 / img.width)))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        oid = uuid.uuid4().hex[:12]
        self.ocr[oid] = None
        if len(self.ocr) > 20:
            self.ocr.pop(next(iter(self.ocr)))

        def work():
            try:
                r = self.hs.api_ocr({"image": "data:image/png;base64," + b64})
            except Exception as e:
                r = {"error": str(e)[:200]}
            self.ocr[oid] = r
        threading.Thread(target=work, daemon=True).start()
        # px (физик) → цонхны байрлал
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        w, h = 520, 440
        x = max(0, min(pos[0], sw - int(w * self.f) - 10))
        y = max(0, min(pos[1] + 10, sh - int(h * self.f) - 50))
        self.open_window(self.ui_url(f"#ocr={oid}"), w, h, x, y)

    def run(self):
        self.root.mainloop()


def main():
    # дотроо суулгасан Python (Setup.exe): Tcl/Tk-ийн сангийн байрлал
    for var, sub in (("TCL_LIBRARY", "tcl8.6"), ("TK_LIBRARY", "tk8.6")):
        for base in (os.path.join(sys.prefix, "tcl"), os.path.join(sys.prefix, "Library", "lib")):
            if not os.environ.get(var) and os.path.isdir(os.path.join(base, sub)):
                os.environ[var] = os.path.join(base, sub)
    if "--install" in sys.argv:
        install()
        return
    if WIN:
        try:  # тод дэлгэц, дэлгэцийн зургийн координат зөв байх
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

    import hadmal_server as hs
    started = False
    for _ in range(240 if "--wait" in sys.argv else 1):  # дахин эхлүүлэхэд хуучин нь хаагдахыг хүлээнэ
        try:
            hs.start()
            started = True
            break
        except OSError:
            time.sleep(0.25)
    if not started:
        # аль хэдийн ажиллаж байна → тэр цонхыг нь харуулна
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{hs.PORT}/show", data=b"{}",
                                         headers={"Content-Type": "application/json"})
            ok = json.loads(urllib.request.urlopen(req, timeout=3).read()).get("ok")
        except Exception:
            ok = False
        if not ok and WIN:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                None, "Хэлмэрч аль хэдийн ажиллаж байна.",
                TITLE, 0x40)
        return
    if WIN:
        threading.Thread(target=migrate_shortcuts, daemon=True).start()
    App(hs, start_hidden="--tray" in sys.argv).run()


if __name__ == "__main__":
    main()
