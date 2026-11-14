// АВТОМАТААР ҮҮССЭН (scripts/build-safari.mjs) — гараар бүү засаарай.
"use strict";
(() => {
  // src/safari/store-shim.ts
  var st = { geminiKey: "", githubToken: "", quality: true, proTerms: true };
  async function loadState() {
    Object.assign(st, await browser.storage.local.get(["geminiKey", "githubToken", "quality", "proTerms", "trcache"]));
    if (st.trcache) for (const [k, v] of Object.entries(st.trcache)) cache.set(k, v);
  }
  browser.storage.onChanged.addListener((c) => {
    for (const k of Object.keys(c)) if (k !== "trcache") st[k] = c[k].newValue;
  });
  var keys = { get: () => ({ gemini: String(st.geminiKey || ""), github: String(st.githubToken || "") }) };
  var settings = { get: () => ({ quality: st.quality !== false, proTerms: st.proTerms !== false }) };
  var cache = /* @__PURE__ */ new Map();
  var saveT = null;
  var trCache = {
    get: (k) => cache.get(k),
    set(k, v) {
      cache.set(k, v);
      while (cache.size > 3e3) cache.delete(cache.keys().next().value);
      if (saveT) clearTimeout(saveT);
      saveT = setTimeout(() => {
        browser.storage.local.set({ trcache: Object.fromEntries(cache) }).catch(() => {
        });
      }, 2e3);
    }
  };
  function rememberWord(_w, _mn) {
  }

  // src/lib/glossary.ts
  var RAW = `project management = төслийн удирдлага
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
business environment = бизнесийн орчин`;
  var ITEMS = RAW.split("\n").map((l) => {
    const [en, mn] = l.split("=");
    return [en.trim(), mn.trim()];
  });
  function glossaryFor(lines) {
    const text = lines.join(" ").toLowerCase();
    return ITEMS.filter(([en]) => text.includes(en.toLowerCase())).slice(0, 40);
  }

  // src/lib/translator.ts
  var PRO_PROMPT = "You are an expert translator of professional and technical English (project management, PMP/PMBOK, agile, business, finance, IT) into Mongolian (Cyrillic). Translate precisely and naturally for Mongolian professionals and students: keep the exact meaning, do not omit, add or summarize anything, keep numbers, formulas, acronyms (PMP, WBS, EVM, CPI, SPI, RACI, MVP) and proper names unchanged. Use the glossary terms consistently when they appear. Keep list markers, numbering and sentence structure; translate headings concisely. The 'Previous lines' are context only — use them to resolve pronouns and ambiguous terms.";
  var PRO_TERMS_RULE = " For key professional terms, write the Mongolian term followed by the original English term in parentheses, e.g. 'оролцогч тал (stakeholder)'.";
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var now = () => Date.now();
  async function fetchJson(url, init = {}, timeoutMs = 3e4) {
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
  var untranslated = (src, out) => src.split(/\s+/).length >= 3 && /[A-Za-z]{3}/.test(src) && !/[Ѐ-ӿ]/.test(out || "");
  function jsonArray(text, n) {
    const m = text.match(/\[[\s\S]*\]/);
    const arr = m ? JSON.parse(m[0]) : [];
    if (!Array.isArray(arr) || arr.length !== n) throw new Error(`мөрийн тоо таарсангүй (${arr.length} != ${n})`);
    return arr.map((x) => String(x).trim());
  }
  function prompt(lines, context, pro) {
    let gl = "";
    if (pro) {
      const g = glossaryFor(lines);
      if (g.length) gl = "Glossary (English = Mongolian):\n" + g.map(([a, b]) => `${a} = ${b}`).join("\n") + "\n\n";
    }
    return gl + "Previous lines (context only, do not translate):\n" + ((context || []).filter(Boolean).join("\n") || "(none)") + `

Translate each item of this JSON array into Mongolian. Return ONLY a JSON array of exactly ${lines.length} strings, in the same order.
` + JSON.stringify(lines);
  }
  function spacer(minMs) {
    let next = 0;
    return async () => {
      const wait = next - now();
      next = Math.max(now(), next) + minMs;
      if (wait > 25e3) throw new Error("дараалал их байна (хязгаар)");
      if (wait > 0) await sleep(wait);
    };
  }
  var GOOGLE_EPS = [
    ["gtx", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t"],
    ["dict", "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=mn"],
    ["gtx", "https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t"]
  ];
  var googleCool = {};
  var googleGap = spacer(250);
  async function googleRaw(text, extra = "", kinds = ["gtx", "dict"]) {
    const eps = GOOGLE_EPS.filter(([k, u]) => kinds.includes(k) && (googleCool[u] || 0) < now());
    if (!eps.length) throw new Error("Google түр хаагдсан");
    let last = null;
    for (const [kind, base] of eps) {
      await googleGap();
      const url = base + (kind === "gtx" ? extra : "") + "&q=" + encodeURIComponent(text);
      try {
        return [kind, await fetchJson(url, {}, 15e3)];
      } catch (e) {
        last = e;
        if ([429, 403, 503].includes(e?.status)) googleCool[base] = now() + 18e4;
      }
    }
    throw last || new Error("Google ажилласангүй");
  }
  async function googleOne(text) {
    const [kind, data] = await googleRaw(text);
    if (kind === "dict") {
      let item = Array.isArray(data) && data.length ? data[0] : data;
      if (Array.isArray(item)) item = item[0] ?? "";
      return String(item ?? "");
    }
    return (data[0] || []).map((s) => s && s[0] || "").join("");
  }
  async function google(lines) {
    const parts = (await googleOne(lines.join("\n"))).split("\n").map((p) => p.trim());
    if (parts.length === lines.length) return parts;
    if (lines.length <= 2) return Promise.all(lines.map(async (l) => (await googleOne(l)).trim()));
    const h = Math.floor(lines.length / 2);
    return [...await google(lines.slice(0, h)), ...await google(lines.slice(h))];
  }
  async function googleBatches(texts, limit = 1800) {
    const out = [];
    let batch = [], size = 0;
    for (const t of texts) {
      if (batch.length && size + t.length > limit) {
        out.push(...await google(batch));
        batch = [];
        size = 0;
      }
      batch.push(t);
      size += t.length + 1;
    }
    if (batch.length) out.push(...await google(batch));
    return out;
  }
  async function googleWord(word) {
    const [, data] = await googleRaw(word, "&dt=bd", ["gtx"]);
    const mn = (data[0] || []).map((s) => s && s[0] || "").join("");
    const alts = [];
    if (Array.isArray(data[1])) {
      for (const e of data[1]) if (Array.isArray(e) && Array.isArray(e[1])) alts.push({ pos: String(e[0]), terms: e[1].slice(0, 6).map(String) });
    }
    return { mn, alts };
  }
  var geminiModels = ["gemini-flash-lite-latest", "gemini-flash-latest"];
  var geminiModelsPro = ["gemini-flash-latest", "gemini-flash-lite-latest"];
  var geminiDiscovered = "";
  var geminiCool = {};
  var geminiGap = spacer(4e3);
  var noThinkingCfg = false;
  async function discoverGemini(key) {
    if (geminiDiscovered === key) return;
    geminiDiscovered = key;
    try {
      const d = await fetchJson(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        { headers: { "x-goog-api-key": key } },
        15e3
      );
      const names = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name).split("/").pop());
      const flash = names.filter((n) => n.includes("flash") && !/image|tts|audio|live|thinking|exp/.test(n));
      const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
      const cmp = (lite) => (a, b) => (Number(a.includes("lite")) - Number(b.includes("lite"))) * (lite ? -1 : 1) || Number(a.includes("preview")) - Number(b.includes("preview")) || ver(b) - ver(a);
      const chosen = [...flash].sort(cmp(true));
      if (chosen.length) {
        geminiModels = chosen.slice(0, 5);
        const pro = [...flash].sort(cmp(false));
        geminiModelsPro = [...pro.filter((n) => !n.includes("lite")).slice(0, 3), ...pro.filter((n) => n.includes("lite")).slice(0, 2)];
      }
    } catch {
    }
  }
  async function geminiRaw(parts, system, timeoutMs = 3e4, pro = false) {
    const key = keys.get().gemini;
    if (!key) throw new Error("Gemini түлхүүр байхгүй");
    await discoverGemini(key);
    const ml = pro ? geminiModelsPro : geminiModels;
    for (let attempt = 0; attempt < ml.length + 2; attempt++) {
      const ready2 = ml.filter((m) => (geminiCool[m] || 0) < now());
      if (!ready2.length) throw new Error("Gemini хязгаар дүүрсэн (түр хүлээнэ)");
      await geminiGap();
      const model = ready2[0];
      const cfg = { responseMimeType: "application/json", temperature: 0.3 };
      if (!noThinkingCfg) {
        if (model.includes("2.5")) cfg.thinkingConfig = { thinkingBudget: 0 };
        else if (/gemini-[3-9]/.test(model)) cfg.thinkingConfig = { thinkingLevel: "low" };
      }
      const body = { contents: [{ role: "user", parts }], generationConfig: cfg };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      try {
        const d = await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
          timeoutMs
        );
        return (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
      } catch (e) {
        const st2 = e?.status, detail = String(e?.body || "");
        if (st2 === 400 && /thinking/i.test(detail)) {
          noThinkingCfg = true;
          continue;
        }
        if (st2 === 404 && ml.length > 1) {
          ml.splice(ml.indexOf(model), 1);
          continue;
        }
        if ([429, 500, 503].includes(st2)) {
          const daily = st2 === 429 && /per.?day|daily|PerDay/i.test(detail);
          geminiCool[model] = now() + (st2 === 429 ? daily ? 3600 : 120 : 20) * 1e3;
          continue;
        }
        throw e;
      }
    }
    throw new Error("Gemini хариу өгсөнгүй");
  }
  async function gemini(lines, context, system, pro, lite) {
    const text = await geminiRaw([{ text: prompt(lines, context, pro) }], system, pro ? 6e4 : 3e4, pro && !lite);
    return jsonArray(text, lines.length);
  }
  var GH_URLS = ["https://models.github.ai/inference/chat/completions", "https://models.inference.ai.azure.com/chat/completions"];
  var GH_MODELS = ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "openai/gpt-4.1", "openai/gpt-4o"];
  var GH_MODELS_PRO = ["openai/gpt-4.1", "openai/gpt-4o", "openai/gpt-4.1-mini", "openai/gpt-4o-mini"];
  var ghUntil = 0;
  var ghUrl = 0;
  var ghGap = spacer(1e3);
  async function copilot(lines, context, system, pro, lite) {
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
          body: JSON.stringify({
            model: ghUrl % 2 === 0 ? model : model.split("/").pop(),
            temperature: 0.3,
            messages: [{ role: "system", content: system }, { role: "user", content: prompt(lines, context, pro) }]
          })
        }, pro ? 6e4 : 4e4);
        return jsonArray(d.choices?.[0]?.message?.content || "", lines.length);
      } catch (e) {
        const st2 = e?.status;
        if (st2 === 429) {
          ghUntil = now() + 6e4;
          throw new Error("Copilot хязгаар дүүрсэн");
        }
        if (st2 === 401 || st2 === 403) {
          ghUntil = now() + 6e5;
          throw new Error(`GitHub токен буруу эсвэл Models эрхгүй (${st2})`);
        }
        if ((st2 === 400 || st2 === 404) && /model/i.test(String(e?.body))) continue;
        if (e instanceof SyntaxError && ghUrl === 0) {
          ghUrl = 1;
          continue;
        }
        if (!st2) {
          ghUntil = now() + 3e5;
          throw new Error("Copilot сүлжээнд хүрсэнгүй");
        }
        throw e;
      }
    }
    throw new Error("Copilot хариу өгсөнгүй");
  }
  var hasAI = () => !!(keys.get().gemini || keys.get().github);
  async function quality(lines, context, proTerms, lite = false) {
    const system = PRO_PROMPT + (proTerms ? PRO_TERMS_RULE : "");
    const chain = [];
    if (keys.get().github) chain.push(["Copilot", copilot]);
    if (keys.get().gemini) chain.push(["Gemini", gemini]);
    const errors = [];
    let best = null;
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
        } catch (e) {
          const msg = String(e?.message || e);
          if (attempt === 0 && /timeout|abort|50\d|мөрийн тоо/i.test(msg) && !msg.includes("хязгаар")) {
            await sleep(2e3);
            continue;
          }
          errors.push(`${name}: ${msg.slice(0, 120)}`);
          break;
        }
      }
    }
    if (best) return best[1];
    throw new Error(errors.join(" | ") || "AI орчуулагч алга");
  }
  var norm = (t) => String(t).replace(/\s+/g, " ").trim().slice(0, 5e3);
  async function translate(req) {
    const kind = req.kind || "text";
    const s = settings.get();
    const wantQ = !req.fast && !!req.quality && s.quality && hasAI();
    const texts = (req.texts || []).map(norm).slice(0, 300);
    const results = texts.map(() => null);
    const key = (t) => JSON.stringify([kind, wantQ, s.proTerms, t]);
    const todo = [];
    texts.forEach((t, i) => {
      const hit = trCache.get(key(t));
      if (hit) results[i] = hit;
      else if (t) todo.push(i);
      else results[i] = { mn: "" };
    });
    const tiers = /* @__PURE__ */ new Set();
    if (kind === "word") {
      for (const i of todo) {
        try {
          results[i] = await googleWord(texts[i]);
          trCache.set(key(texts[i]), results[i]);
        } catch {
          if (hasAI()) {
            try {
              results[i] = { mn: (await quality([texts[i]], null, false, true))[0] };
            } catch {
            }
          }
        }
      }
    } else if (todo.length) {
      const ctx = req.context ? [norm(req.context).slice(0, 500)] : null;
      for (let k = 0; k < todo.length; k += 20) {
        const idx = todo.slice(k, k + 20), src = idx.map((i) => texts[i]);
        let mns = null, tier2 = "google", cacheable = false;
        if (wantQ) {
          try {
            mns = await quality(src, ctx, s.proTerms);
            tier2 = "pro";
            cacheable = true;
          } catch {
          }
        }
        if (!mns && !req.fast && hasAI() && s.quality) {
          try {
            mns = await quality(src, ctx, s.proTerms, true);
            tier2 = wantQ ? "pro" : "fast";
            cacheable = true;
          } catch {
          }
        }
        if (!mns) {
          for (let a = 0; a < 2 && !mns; a++) {
            try {
              mns = await googleBatches(src);
              tier2 = "google";
            } catch {
              await sleep(1500);
            }
          }
        }
        if (mns) {
          tiers.add(tier2);
          idx.forEach((i, j) => {
            let mn = mns[j] || "";
            const srcT = texts[i].trim().replace(/[.!?:]+$/, "");
            if (srcT.length > 2) mn = mn.replace(new RegExp("\\s*\\(\\s*" + srcT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[.!?:]*\\s*\\)", "i"), "").trim();
            results[i] = { mn };
            if (cacheable && mn) trCache.set(key(texts[i]), results[i]);
          });
        }
      }
    }
    if (todo.length && todo.every((i) => !results[i])) return { error: "Орчуулга түр саатлаа" };
    if (kind === "word" && req.remember) texts.forEach((t, i) => results[i]?.mn && rememberWord(t, results[i].mn));
    const tier = tiers.size === 1 && tiers.has("pro") ? "pro" : tiers.has("google") ? "google" : tiers.size ? "fast" : "pro";
    return { results: results.map((r) => r || { mn: "" }), tier, ai: tier === "pro" };
  }
  async function testProvider(name) {
    try {
      if (name === "Copilot") {
        if (!keys.get().github) return { ok: false, msg: "Токен оруулаагүй байна." };
        ghUntil = 0;
        const out2 = await copilot(["Project management is important."], null, PRO_PROMPT, true, false);
        return { ok: true, msg: "Ажиллаж байна ✓\n\n" + out2[0] };
      }
      if (!keys.get().gemini) return { ok: false, msg: "Түлхүүр оруулаагүй байна." };
      geminiDiscovered = "";
      const out = await gemini(["Project management is important."], null, PRO_PROMPT, false, true);
      return { ok: true, msg: "Ажиллаж байна ✓\n\n" + out[0] };
    } catch (e) {
      const m = String(e?.message || e);
      if (/401/.test(m)) return { ok: false, msg: "Токен/түлхүүр буруу эсвэл хугацаа нь дууссан байна. Шинээр авч оруулна уу." };
      if (/403|Models эрхгүй/.test(m)) return { ok: false, msg: "Токенд «Models: Read-only» эрх алга. GitHub дээр токеноо засаад Models → Read-only болгоно уу." };
      if (/хязгаар|429/.test(m)) return { ok: false, msg: "Өнөөдрийн үнэгүй хязгаар дүүрсэн байна. Маргааш дахин ажиллана." };
      return { ok: false, msg: "Холбогдож чадсангүй. Интернэтээ шалгаад дахин оролдоно уу." };
    }
  }

  // src/safari/background.ts
  var ready = loadState().catch(() => {
  });
  async function handle(msg) {
    await ready;
    if (msg?.type === "translate") {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await translate({ kind: msg.kind, texts: msg.texts || [], quality: msg.quality, context: msg.context });
          if (!r.error) return r;
        } catch {
        }
        await new Promise((res) => setTimeout(res, [800, 2e3, 4e3][i]));
      }
      return { error: "busy" };
    }
    if (msg?.type === "test") return testProvider(msg.name);
    if (msg?.type === "getSettings") return {};
    return void 0;
  }
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg).then((r) => sendResponse(r ?? {})).catch(() => sendResponse({ error: "x" }));
    return true;
  });
})();
