// Safari өргөтгөлийн background.js-ийг (= аппын translator.ts) Node дээр жинхэнэ Google орчуулгатай шалгана.
// browser.* API-г дуурайна. Интернэт шаардлагатай. Ажиллуулах: node tests/safari_background.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, "..", "targets", "safari", "assets", "background.js"), "utf8");
if (/expo-file-system|expo-secure-store|react-native/.test(code)) { console.log("FAIL: background.js-д React Native/Expo модуль орсон"); process.exit(1); }

let handler = null;
const store = {};
const browser = {
  storage: {
    local: { get: async (keys) => Object.fromEntries((keys || []).filter((k) => k in store).map((k) => [k, store[k]])), set: async (o) => Object.assign(store, o) },
    onChanged: { addListener() {} },
  },
  runtime: { onMessage: { addListener: (f) => { handler = f; } } },
};
vm.runInNewContext(code, { browser, fetch, AbortController, setTimeout, clearTimeout, console, TextDecoder, URL, encodeURIComponent });
const ask = (msg) => new Promise((res) => handler(msg, {}, res));

const bad = [];
const t = await ask({ type: "translate", kind: "text", texts: ["The project charter formally authorizes the project.", "Stakeholders must be identified early."], quality: false });
const okText = t.results?.length === 2 && t.results.every((r) => /[Ѐ-ӿ]/.test(r.mn));
if (!okText) bad.push("текст орчуулга: " + JSON.stringify(t));
const w = await ask({ type: "translate", kind: "word", texts: ["stakeholder"] });
if (!/[Ѐ-ӿ]/.test(w.results?.[0]?.mn || "")) bad.push("үг орчуулга: " + JSON.stringify(w));
console.log("текст:", t.tier, t.results?.map((r) => r.mn).join(" | "));
console.log("үг:", w.results?.[0]?.mn, (w.results?.[0]?.alts || []).slice(0, 2).map((a) => a.pos + ": " + a.terms.slice(0, 3).join(", ")).join("; "));
console.log(bad.length ? "FAIL: " + bad.join("; ") : "PASS");
// process.exit() нээлттэй fetch холболттой үед Windows-ийн Node-д заримдаа унадаг (libuv assertion) — өөрөө дуусгана
process.exitCode = bad.length ? 1 : 0;
