// Орчуулгын гинж — компьютерын програмын hadmal_server.py (Translator, api_translate)-тай ижил логик.
//   Хурдан шат: хурдан AI (GPT mini / Gemini lite) → бүтэхгүй бол Google (нөөц)
//   Чанарын шат: хүчтэй AI (Copilot → Gemini)
// Алдааг хэрэглэгчид харуулахгүй: бүх үйлчилгээ бүтэлгүйтвэл { error } буцааж, дуудагч чимээгүй дахин оролдоно.
import { keys, settings, trCache, rememberWord, type Alt } from "./store";
import { glossaryFor } from "./glossary";

const PRO_PROMPT =
  "You are an expert translator of professional and technical English (project management, " +
  "PMP/PMBOK, agile, business, finance, IT) into Mongolian (Cyrillic). Translate precisely and " +
  "naturally for Mongolian professionals and students: keep the exact meaning, " +
  "do not omit, add or summarize anything, keep numbers, formulas, acronyms (PMP, WBS, EVM, CPI, SPI, " +
  "RACI, MVP) and proper names unchanged. Use the glossary terms consistently when they appear. " +
  "Keep list markers, numbering and sentence structure; translate headings concisely. " +
  "The 'Previous lines' are context only — use them to resolve pronouns and ambiguous terms.";
const PRO_TERMS_RULE =
  " For key professional terms, write the Mongolian term followed by the original English " +
  "term in parentheses, e.g. 'оролцогч тал (stakeholder)'.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 30000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`), { status: r.status, body: text });
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

// англи өгүүлбэр орчуулагдалгүй буцаж ирсэн эсэх
const untranslated = (src: string, out: string) =>
  src.split(/\s+/).length >= 3 && /[A-Za-z]{3}/.test(src) && !/[Ѐ-ӿ]/.test(out || "");

function jsonArray(text: string, n: number): string[] {
  const m = text.match(/\[[\s\S]*\]/);
  const arr = m ? JSON.parse(m[0]) : [];
  if (!Array.isArray(arr) || arr.length !== n) throw new Error(`мөрийн тоо таарсангүй (${arr.length} != ${n})`);
  return arr.map((x: unknown) => String(x).trim());
}

function prompt(lines: string[], context: string[] | null, pro: boolean) {
  let gl = "";
  if (pro) {
    const g = glossaryFor(lines);
    if (g.length) gl = "Glossary (English = Mongolian):\n" + g.map(([a, b]) => `${a} = ${b}`).join("\n") + "\n\n";
  }
  return gl + "Previous lines (context only, do not translate):\n" +
    ((context || []).filter(Boolean).join("\n") || "(none)") +
    `\n\nTranslate each item of this JSON array into Mongolian. Return ONLY a JSON array of exactly ${lines.length} strings, in the same order.\n` +
    JSON.stringify(lines);
}

// нэг үйлчилгээ рүү хэт олон хүсэлт зэрэг явуулахгүй (үнэгүй эрхийн хурдны хязгаар)
function spacer(minMs: number) {
  let next = 0;
  return async () => {
    const wait = next - now();
    next = Math.max(now(), next) + minMs;
    if (wait > 25000) throw new Error("дараалал их байна (хязгаар)");
    if (wait > 0) await sleep(wait);
  };
}

// ---------------------------------------------------------------- Google (үнэгүй, нөөц)
const GOOGLE_EPS: [string, string][] = [
  ["gtx", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t"],
  ["dict", "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=mn"],
  ["gtx", "https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t"],
];
const googleCool: Record<string, number> = {};
const googleGap = spacer(250);

async function googleRaw(text: string, extra = "", kinds = ["gtx", "dict"]): Promise<[string, any]> {
  const eps = GOOGLE_EPS.filter(([k, u]) => kinds.includes(k) && (googleCool[u] || 0) < now());
  if (!eps.length) throw new Error("Google түр хаагдсан");
  let last: unknown = null;
  for (const [kind, base] of eps) {
    await googleGap();
    const url = base + (kind === "gtx" ? extra : "") + "&q=" + encodeURIComponent(text);
    try {
      return [kind, await fetchJson(url, {}, 15000)];
    } catch (e: any) {
      last = e;
      if ([429, 403, 503].includes(e?.status)) googleCool[base] = now() + 180000;   // 3 мин алгасна
    }
  }
  throw last || new Error("Google ажилласангүй");
}

async function googleOne(text: string): Promise<string> {
  const [kind, data] = await googleRaw(text);
  if (kind === "dict") {
    let item = Array.isArray(data) && data.length ? data[0] : data;
    if (Array.isArray(item)) item = item[0] ?? "";
    return String(item ?? "");
  }
  return (data[0] || []).map((s: any[]) => (s && s[0]) || "").join("");
}

async function google(lines: string[]): Promise<string[]> {
  const parts = (await googleOne(lines.join("\n"))).split("\n").map((p) => p.trim());
  if (parts.length === lines.length) return parts;
  if (lines.length <= 2) return Promise.all(lines.map(async (l) => (await googleOne(l)).trim()));
  const h = Math.floor(lines.length / 2);   // мөрийн тоо таарсангүй — хоёр хуваан дахин
  return [...(await google(lines.slice(0, h))), ...(await google(lines.slice(h)))];
}

async function googleBatches(texts: string[], limit = 1800): Promise<string[]> {
  const out: string[] = [];
  let batch: string[] = [], size = 0;
  for (const t of texts) {
    if (batch.length && size + t.length > limit) { out.push(...(await google(batch))); batch = []; size = 0; }
    batch.push(t); size += t.length + 1;
  }
  if (batch.length) out.push(...(await google(batch)));
  return out;
}

export async function googleWord(word: string): Promise<{ mn: string; alts: Alt[] }> {
  const [, data] = await googleRaw(word, "&dt=bd", ["gtx"]);
  const mn = (data[0] || []).map((s: any[]) => (s && s[0]) || "").join("");
  const alts: Alt[] = [];
  if (Array.isArray(data[1])) {
    for (const e of data[1]) if (Array.isArray(e) && Array.isArray(e[1])) alts.push({ pos: String(e[0]), terms: e[1].slice(0, 6).map(String) });
  }
  return { mn, alts };
}

// ---------------------------------------------------------------- Gemini
let geminiModels = ["gemini-flash-lite-latest", "gemini-flash-latest"];
let geminiModelsPro = ["gemini-flash-latest", "gemini-flash-lite-latest"];
let geminiDiscovered = "";
const geminiCool: Record<string, number> = {};
const geminiGap = spacer(4000);            // үнэгүй эрх: минутад ~15 хүсэлт
let noThinkingCfg = false;

async function discoverGemini(key: string) {
  if (geminiDiscovered === key) return;
  geminiDiscovered = key;
  try {
    const d = await fetchJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": key } }, 15000);
    const names: string[] = (d.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: any) => String(m.name).split("/").pop());
    const flash = names.filter((n) => n.includes("flash") && !/image|tts|audio|live|thinking|exp/.test(n));
    const ver = (n: string) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
    const cmp = (lite: boolean) => (a: string, b: string) =>
      (Number(a.includes("lite")) - Number(b.includes("lite"))) * (lite ? -1 : 1) ||
      Number(a.includes("preview")) - Number(b.includes("preview")) || ver(b) - ver(a);
    const chosen = [...flash].sort(cmp(true));
    if (chosen.length) {
      geminiModels = chosen.slice(0, 5);
      const pro = [...flash].sort(cmp(false));
      geminiModelsPro = [...pro.filter((n) => !n.includes("lite")).slice(0, 3), ...pro.filter((n) => n.includes("lite")).slice(0, 2)];
    }
  } catch {
    // анхны загваруудыг ашиглана
  }
}

async function geminiRaw(parts: any[], system: string | null, timeoutMs = 30000, pro = false): Promise<string> {
  const key = keys.get().gemini;
  if (!key) throw new Error("Gemini түлхүүр байхгүй");
  await discoverGemini(key);
  const ml = pro ? geminiModelsPro : geminiModels;     // шинэчлэгдсэн жагсаалтаас сонгоно
  for (let attempt = 0; attempt < ml.length + 2; attempt++) {
    const ready = ml.filter((m) => (geminiCool[m] || 0) < now());
    if (!ready.length) throw new Error("Gemini хязгаар дүүрсэн (түр хүлээнэ)");
    await geminiGap();
    const model = ready[0];
    const cfg: any = { responseMimeType: "application/json", temperature: 0.3 };
    if (!noThinkingCfg) {
      if (model.includes("2.5")) cfg.thinkingConfig = { thinkingBudget: 0 };
      else if (/gemini-[3-9]/.test(model)) cfg.thinkingConfig = { thinkingLevel: "low" };
    }
    const body: any = { contents: [{ role: "user", parts }], generationConfig: cfg };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    try {
      const d = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }, timeoutMs);
      return (d.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("");
    } catch (e: any) {
      const st = e?.status, detail = String(e?.body || "");
      if (st === 400 && /thinking/i.test(detail)) { noThinkingCfg = true; continue; }
      if (st === 404 && ml.length > 1) { ml.splice(ml.indexOf(model), 1); continue; }
      if ([429, 500, 503].includes(st)) {
        const daily = st === 429 && /per.?day|daily|PerDay/i.test(detail);
        geminiCool[model] = now() + (st === 429 ? (daily ? 3600 : 120) : 20) * 1000;
        continue;
      }
      throw e;
    }
  }
  throw new Error("Gemini хариу өгсөнгүй");
}

async function gemini(lines: string[], context: string[] | null, system: string, pro: boolean, lite: boolean) {
  const text = await geminiRaw([{ text: prompt(lines, context, pro) }], system, pro ? 60000 : 30000, pro && !lite);
  return jsonArray(text, lines.length);
}

// ---------------------------------------------------------------- Copilot (GitHub Models)
const GH_URLS = ["https://models.github.ai/inference/chat/completions", "https://models.inference.ai.azure.com/chat/completions"];
const GH_MODELS = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "openai/gpt-4.1", "openai/gpt-4o"];
const GH_MODELS_PRO = ["openai/gpt-4.1", "openai/gpt-4o", "openai/gpt-4.1-mini", "openai/gpt-4o-mini"];
let ghUntil = 0, ghUrl = 0;
const ghGap = spacer(1000);

async function copilot(lines: string[], context: string[] | null, system: string, pro: boolean, lite: boolean) {
  const token = keys.get().github;
  if (!token) throw new Error("GitHub токен байхгүй");
  if (now() < ghUntil) throw new Error("Copilot хязгаар дүүрсэн, түр хүлээнэ");
  const ml = pro && !lite ? GH_MODELS_PRO : GH_MODELS;
  for (let i = 0; i < ml.length + 1; i++) {
    await ghGap();
    const model = ml[Math.min(i, ml.length - 1)], url = GH_URLS[ghUrl % GH_URLS.length];
    try {
      const d = await fetchJson(url, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ model: ghUrl % 2 === 0 ? model : model.split("/").pop(), temperature: 0.3,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt(lines, context, pro) }] }),
      }, pro ? 60000 : 40000);
      return jsonArray(d.choices?.[0]?.message?.content || "", lines.length);
    } catch (e: any) {
      const st = e?.status;
      if (st === 429) { ghUntil = now() + 60000; throw new Error("Copilot хязгаар дүүрсэн"); }
      if (st === 401 || st === 403) { ghUntil = now() + 600000; throw new Error(`GitHub токен буруу эсвэл Models эрхгүй (${st})`); }
      if ((st === 400 || st === 404) && /model/i.test(String(e?.body))) continue;
      if (e instanceof SyntaxError && ghUrl === 0) { ghUrl = 1; continue; }      // JSON биш хариу → нөөц хаяг
      if (!st) { ghUntil = now() + 300000; throw new Error("Copilot сүлжээнд хүрсэнгүй"); }
      throw e;
    }
  }
  throw new Error("Copilot хариу өгсөнгүй");
}

// ---------------------------------------------------------------- сайн чанарын орчуулга: Copilot → Gemini
export const hasAI = () => !!(keys.get().gemini || keys.get().github);

async function quality(lines: string[], context: string[] | null, proTerms: boolean, lite = false, prefer?: string): Promise<string[]> {
  const system = PRO_PROMPT + (proTerms ? PRO_TERMS_RULE : "");
  const chain: [string, typeof copilot][] = [];
  if (keys.get().github) chain.push(["Copilot", copilot]);
  if (keys.get().gemini) chain.push(["Gemini", gemini]);
  if (prefer === "gemini" && chain.length === 2 && chain[0][0] === "Copilot") chain.reverse();   // видео хадмал гэх мэт: Gemini эхэлж
  const errors: string[] = [];
  let best: [number, string[]] | null = null;
  for (const [name, fn] of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await fn(lines, context, system, true, lite);
        const bad = lines.filter((a, i) => untranslated(a, out[i])).length;
        if (bad && bad >= Math.max(1, Math.ceil(lines.length / 2))) {
          if (bad < lines.length && (!best || bad < best[0])) best = [bad, out];
          throw new Error(`${bad} мөр орчуулагдаагүй`);
        }
        return out;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (attempt === 0 && /timeout|abort|50\d|мөрийн тоо/i.test(msg) && !msg.includes("хязгаар")) { await sleep(2000); continue; }
        errors.push(`${name}: ${msg.slice(0, 120)}`);
        break;
      }
    }
  }
  if (best) return best[1];
  throw new Error(errors.join(" | ") || "AI орчуулагч алга");
}

// ---------------------------------------------------------------- гадаад API (хуудас, PDF, үг)
export type TrResult = { results?: { mn: string; alts?: Alt[] }[]; tier?: "pro" | "fast" | "google"; ai?: boolean; error?: string };
const norm = (t: string) => String(t).replace(/\s+/g, " ").trim().slice(0, 5000);

// fast: AI-г алгасаж шууд Google (видео хадмал гэх мэт хоцрох ёсгүй үед — Gemini үнэгүй эрх хүсэлт бүрийн хооронд 4 сек хүлээлгэдэг)
export async function translate(req: { kind?: string; texts: string[]; quality?: boolean; context?: string; remember?: boolean; fast?: boolean; prefer?: string }): Promise<TrResult> {
  const kind = req.kind || "text";
  const s = settings.get();
  const wantQ = !req.fast && !!req.quality && s.quality && hasAI();
  const texts = (req.texts || []).map(norm).slice(0, 300);
  const results: ({ mn: string; alts?: Alt[] } | null)[] = texts.map(() => null);
  const key = (t: string) => JSON.stringify([kind, wantQ, s.proTerms, t]);
  const todo: number[] = [];
  texts.forEach((t, i) => {
    const hit = trCache.get(key(t));
    if (hit) results[i] = hit;
    else if (t) todo.push(i);
    else results[i] = { mn: "" };
  });
  const tiers = new Set<string>();

  if (kind === "word") {
    for (const i of todo) {
      try {
        results[i] = await googleWord(texts[i]);
        trCache.set(key(texts[i]), results[i]!);
      } catch {
        if (hasAI()) {
          try { results[i] = { mn: (await quality([texts[i]], null, false, true))[0] }; } catch { /* дараа дахин */ }
        }
      }
    }
  } else if (todo.length) {
    const ctx = req.context ? [norm(req.context).slice(0, 500)] : null;
    for (let k = 0; k < todo.length; k += 20) {
      const idx = todo.slice(k, k + 20), src = idx.map((i) => texts[i]);
      let mns: string[] | null = null, tier: "pro" | "fast" | "google" = "google", cacheable = false;
      if (wantQ) {
        try { mns = await quality(src, ctx, s.proTerms, false, req.prefer); tier = "pro"; cacheable = true; } catch { /* хурдан шат руу */ }
      }
      if (!mns && !req.fast && hasAI() && s.quality) {
        try { mns = await quality(src, ctx, s.proTerms, true); tier = wantQ ? "pro" : "fast"; cacheable = true; } catch { /* Google руу */ }
      }
      if (!mns) {
        for (let a = 0; a < 2 && !mns; a++) {
          try { mns = await googleBatches(src); tier = "google"; } catch { await sleep(1500); }
        }
      }
      if (mns) {
        tiers.add(tier);
        idx.forEach((i, j) => {
          let mn = mns![j] || "";
          // AI заримдаа эх бичвэрийг хаалтанд давтдаг: "Апп татах (Get the app)" → "Апп татах"
          const srcT = texts[i].trim().replace(/[.!?:]+$/, "");
          if (srcT.length > 2) mn = mn.replace(new RegExp("\\s*\\(\\s*" + srcT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[.!?:]*\\s*\\)", "i"), "").trim();
          results[i] = { mn };
          if (cacheable && mn) trCache.set(key(texts[i]), results[i]!);   // Google-ийн нөөцийг кэшлэхгүй
        });
      }
    }
  }
  if (todo.length && todo.every((i) => !results[i])) return { error: "Орчуулга түр саатлаа" };
  if (kind === "word" && req.remember) texts.forEach((t, i) => results[i]?.mn && rememberWord(t, results[i]!.mn));
  const tier = tiers.size === 1 && tiers.has("pro") ? "pro" : tiers.has("google") ? "google" : tiers.size ? "fast" : "pro";
  return { results: results.map((r) => r || { mn: "" }), tier, ai: tier === "pro" };
}

// Зөвхөн AI (видео хадмалыг ар талд сайжруулахад): хурдан загвар (Gemini flash-lite / GPT mini), Google руу шилжихгүй,
// удаан дахин оролдохгүй — бүтэхгүй бол шалтгааныг нь буцаана (апп хэрэглэгчид харуулна).
export type AiReason = "nokey" | "limit" | "badkey" | "net" | "other";
export async function translateAI(texts: string[], context?: string, prefer?: string): Promise<TrResult & { reason?: AiReason }> {
  const s = settings.get();
  if (!hasAI()) return { error: "nokey", reason: "nokey" };
  const src = texts.map(norm);
  const key = (t: string) => JSON.stringify(["text", true, s.proTerms, t]);
  const out = src.map((t) => trCache.get(key(t))?.mn || "");
  const todo = out.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
  if (todo.length) {
    try {
      const mns = await quality(todo.map((i) => src[i]), context ? [norm(context).slice(0, 500)] : null, s.proTerms, true, prefer);
      todo.forEach((i, j) => { out[i] = mns[j] || ""; if (out[i]) trCache.set(key(src[i]), { mn: out[i] }); });
    } catch (e: any) {
      const m = String(e?.message || e);
      const reason: AiReason = /хязгаар|429/.test(m) ? "limit" : /401|403|буруу|эрхгүй|API key/i.test(m) ? "badkey"
        : /сүлжээ|timeout|abort|network|fetch/i.test(m) ? "net" : "other";
      return { error: m.slice(0, 160), reason };
    }
  }
  return { results: out.map((mn) => ({ mn })), tier: "pro", ai: true };
}

// зурган дээрх текстийг уншиж орчуулна (Gemini)
export async function ocrImage(base64: string, mime = "image/jpeg"): Promise<{ original: string; mongolian: string } | { error: string }> {
  if (!keys.get().gemini) return { error: "nokey" };
  const p = "Read all the text in this image, in natural reading order, keeping paragraph breaks. " +
    "Then translate it into natural Mongolian (Cyrillic). Return ONLY JSON: " +
    '{"original": "<text as written>", "mongolian": "<Mongolian translation>"}. ' +
    'If there is no text, return {"original": "", "mongolian": ""}.';
  for (let a = 0; a < 3; a++) {
    try {
      const text = await geminiRaw([{ inlineData: { mimeType: mime, data: base64 } }, { text: p }], null, 90000);
      const m = text.match(/\{[\s\S]*\}/);
      const d = m ? JSON.parse(m[0]) : {};
      return { original: String(d.original || ""), mongolian: String(d.mongolian || "") };
    } catch {
      await sleep(2000 * (a + 1));
    }
  }
  return { error: "busy" };
}

// тохиргооны «Шалгах» товч
export async function testProvider(name: "Copilot" | "Gemini"): Promise<{ ok: boolean; msg: string }> {
  try {
    if (name === "Copilot") {
      if (!keys.get().github) return { ok: false, msg: "Токен оруулаагүй байна." };
      ghUntil = 0;
      const out = await copilot(["Project management is important."], null, PRO_PROMPT, true, false);
      return { ok: true, msg: "Ажиллаж байна ✓\n\n" + out[0] };
    }
    if (!keys.get().gemini) return { ok: false, msg: "Түлхүүр оруулаагүй байна." };
    geminiDiscovered = "";
    const out = await gemini(["Project management is important."], null, PRO_PROMPT, false, true);
    return { ok: true, msg: "Ажиллаж байна ✓\n\n" + out[0] };
  } catch (e: any) {
    const m = String(e?.message || e);
    if (/401/.test(m)) return { ok: false, msg: "Токен/түлхүүр буруу эсвэл хугацаа нь дууссан байна. Шинээр авч оруулна уу." };
    if (/403|Models эрхгүй/.test(m)) return { ok: false, msg: "Токенд «Models: Read-only» эрх алга. GitHub дээр токеноо засаад Models → Read-only болгоно уу." };
    if (/хязгаар|429/.test(m)) return { ok: false, msg: "Өнөөдрийн үнэгүй хязгаар дүүрсэн байна. Маргааш дахин ажиллана." };
    return { ok: false, msg: "Холбогдож чадсангүй. Интернэтээ шалгаад дахин оролдоно уу." };
  }
}
