// Олон Gemini түлхүүр: хүсэлтүүд түлхүүрүүдэд хуваагдах, 429 (хязгаар) гарвал дараагийн түлхүүр рүү шилжих,
// бүх түлхүүр дүүрвэл «limit» шалтгаан буцаахыг шалгана. translator.ts-ийг тестийн store-оор бүтээж, fetch-ийг дуурайна.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shim = `export const keys = { get: () => ({ gemini: "K1", gemini2: "K2", gemini3: "K3", github: "" }) };
export const settings = { get: () => ({ quality: true, proTerms: false }) };
const c = new Map(); export const trCache = { get: (k) => c.get(k), set: (k, v) => c.set(k, v) };
export function rememberWord() {}`;
const out = await build({
  entryPoints: [join(root, "src", "lib", "translator.ts")], bundle: true, format: "esm", write: false, platform: "neutral",
  plugins: [{ name: "shim", setup(b) {
    b.onResolve({ filter: /^\.\/store$/ }, () => ({ path: "store", namespace: "shim" }));
    b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: shim, loader: "js" }));
  } }],
});
const used = [];
let limited = new Set();
globalThis.fetch = async (url, init = {}) => {
  const key = init.headers && init.headers["x-goog-api-key"];
  const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (String(url).includes("/models?")) return ok({ models: [] });   // загвар асуухад хоосон → анхны загварууд
  used.push(key);
  if (limited.has(key)) return { ok: false, status: 429, text: async () => '{"error":"quota"}' };
  const lines = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.split("\n").pop());
  return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(lines.map((l) => "МН " + l)) }] } }] });
};
// хурдны хязгаарлагчийн 4 сек хүлээлтийг тестэд алгасна
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realTimeout(f, Math.min(ms || 0, 5), ...a);

const T = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const bad = [];
// 1) хуваагдах: 3 хүсэлт → K1, K2, K3
for (const w of ["alpha one", "beta two", "gamma three"]) await T.translateAI([w + " is here"]);
if (new Set(used).size !== 3) bad.push("хүсэлтүүд түлхүүрүүдэд хуваагдсангүй: " + used.join(","));
// 2) K1, K2 хязгаар дүүрсэн → K3 ажиллана
used.length = 0; limited = new Set(["K1", "K2"]);
const r2 = await T.translateAI(["delta four is here"]);
if (!r2.results || !/МН/.test(r2.results[0].mn)) bad.push("дараагийн түлхүүр рүү шилжсэнгүй: " + JSON.stringify(r2) + " used=" + used.join(","));
// 3) бүгд дүүрсэн → limit
limited = new Set(["K1", "K2", "K3"]);
const r3 = await T.translateAI(["epsilon five is here"]);
if (r3.reason !== "limit") bad.push("бүгд дүүрэхэд limit гэж хэлсэнгүй: " + JSON.stringify(r3));
console.log(bad.length ? "FAIL: " + bad.join("; ") : "PASS");
process.exit(bad.length ? 1 : 0);
