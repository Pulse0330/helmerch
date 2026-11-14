// Видео солигдох (YouTube дараагийн видеог хуудсаа дахин ачаалалгүй нээдэг): өмнөх видеоны хадмал, Gemini-ийн явц
// шинэ видеонд үлдэхгүй, шинэ видеоны хадмал баригдаж орчуулагдах, Gemini зөвхөн товч дарахад эхлэхийг шалгана.
import { writeFileSync } from "node:fs";
import { bridgeJs, toPage } from "../src/web/inject";
import { VIDEO_BEFORE_JS } from "../src/web/video";

const tt = (lines: [number, number, string][]) => JSON.stringify({ events: lines.map(([s, d, t]) => ({ tStartMs: s * 1000, dDurationMs: d * 1000, segs: [{ utf8: t }] })) });
const A = tt([[0, 2, "Old video one."], [2, 3, "Old video two."], [5, 3, "Old video three."]]);
const B = tt([[0, 2, "New video one."], [2, 3, "New video two."], [5, 3, "New video three."]]);
const respTpl = JSON.stringify(toPage({ kind: "resp", id: 0, data: null }));
const html = `<!doctype html><html><head><meta charset="utf-8">
<script>
history.replaceState({}, "", "?v=AAAAAAAAAAA");
window.__events = []; window.__vai = []; window.__ai = 0;
window.ReactNativeWebView = { postMessage(s) {
  const m = JSON.parse(s);
  if (m.kind === "vai") __vai.push(m);
  if (m.kind === "vnew") __vai.length = 0;                 // зөвхөн солигдсоны дараах Gemini-ийн мэдэгдлийг тоолно
  if (m.kind !== "req") { __events.push(m.kind); return; }
  const ai = m.msg.type === "translateAI";
  if (ai) __ai++;
  setTimeout(() => {
    const data = { results: m.msg.texts.map((t) => ({ mn: (ai ? "AI:" : "MN:") + t })), ai };
    eval(${respTpl}.replace('"id":0', '"id":' + m.id).replace('"data":null', '"data":' + JSON.stringify(data)));
  }, ai ? 900 : 20);
} };
const tt = (id, body) => fetch("data:application/json;src=/api/timedtext&v=" + id + "," + encodeURIComponent(body));
</script>
<script>${bridgeJs({ pageMode: "off", subs: false, settings: { quality: true } })}</script>
<script>${VIDEO_BEFORE_JS}</script>
</head><body style="margin:0">
<video id="v" width="320" height="180" style="display:block;background:#000"></video>
<script>
const v = document.getElementById("v"), bad = [];
const mnT = () => [...v.textTracks].find((x) => x.language === "mn");
const texts = () => { const t = mnT(); return t && t.cues ? [...t.cues].map((c) => c.text) : []; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  tt("AAAAAAAAAAA", ${JSON.stringify(A)});
  await wait(1200);
  if (__ai) bad.push("товч дараагүй ч Gemini ажилласан");
  if (!texts().some((x) => x === "MN:Old video two.")) bad.push("эхний видеоны хадмал гарсангүй: " + JSON.stringify(texts()));
  window.__hmAI();                                         // эхний видеонд AI товч
  await wait(400);                                         // Gemini хүсэлт явж байх үед…
  // дараагийн видео: хадмал нь холбоос солигдохоос ӨМНӨ ирнэ, хуучин видеоны хоцорсон хариу ч ирнэ
  tt("BBBBBBBBBBB", ${JSON.stringify(B)});
  await wait(100);
  history.pushState({}, "", "?v=BBBBBBBBBBB");
  tt("AAAAAAAAAAA", ${JSON.stringify(A)});
  await wait(1500);
  const V = window.__hmV, now = texts();
  if (!__events.includes("vnew")) bad.push("видео солигдсоныг мэдэгдсэнгүй");
  if (V.vid !== "BBBBBBBBBBB") bad.push("шинэ видеог таньсангүй: " + V.vid);
  if (V.cues.length !== 3 || V.cues[0].t !== "New video one.") bad.push("шинэ видеоны хадмал баригдсангүй: " + JSON.stringify(V.cues));
  if (now.some((x) => /Old video/.test(x))) bad.push("өмнөх видеоны хадмал үлдсэн: " + JSON.stringify(now));
  if (!now.includes("MN:New video two.")) bad.push("шинэ видеоны монгол хадмал гарсангүй: " + JSON.stringify(now));
  if (now.some((x) => /^AI:/.test(x))) bad.push("шинэ видеонд товч дараагүй ч Gemini орчуулга гарсан");
  // эхний видеоны Gemini хүсэлт солигдох үед явж байсан — хариу нь шинэ видеонд мэдэгдэл ч, мөр ч болж орохгүй
  if (__vai.length) bad.push("шинэ видеонд хуучин Gemini-ийн явц гарсан: " + JSON.stringify(__vai));
  // шинэ видеонд AI товч → зөвхөн шинэ видеоны мөрүүд
  window.__hmAI();
  await wait(2000);
  const fin = texts();
  if (!fin.includes("AI:New video two.")) bad.push("шинэ видеонд Gemini ажилласангүй: " + JSON.stringify(fin));
  if (fin.some((x) => /Old video/.test(x))) bad.push("Gemini-ийн хуучин хариу шинэ видеонд орсон");
  const last = __vai[__vai.length - 1];
  if (!last || last.state !== "done" || last.total !== 3) bad.push("шинэ видеоны Gemini дууссаныг мэдэгдсэнгүй: " + JSON.stringify(last));
  document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
})();
</script></body></html>`;
writeFileSync(process.argv[2], html);
