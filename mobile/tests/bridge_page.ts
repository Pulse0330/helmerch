// Утасны аппын WebView-д оруулдаг скриптүүдийг (bridgeJs + PAGE_JS) Chrome headless-ээр шалгах хуудас үүсгэнэ.
// ReactNativeWebView.postMessage-ийг дуурайж, апп шиг орчуулгын хариу өгнө.
import { writeFileSync } from "node:fs";
import { bridgeJs, PAGE_JS, toPage } from "../src/web/inject";

const out = process.argv[2];
const store = { pageMode: "bi", trStyle: "line", uiTr: true, examMode: true, wordTap: false, subs: false, settings: { quality: false } };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>bridge</title>
<script>
window.__log = []; window.__events = [];
window.ReactNativeWebView = { postMessage(s) {
  const m = JSON.parse(s); __log.push(m.kind + (m.msg ? ":" + m.msg.type : ""));
  if (m.kind === "req") setTimeout(() => {
    const data = { results: (m.msg.texts || []).map((t) => ({ mn: "MN:" + t })), tier: "google", ai: false };
    eval(${JSON.stringify(toPage({ kind: "resp", id: 0, data: null }))}.replace('"id":0', '"id":' + m.id).replace('"data":null', '"data":' + JSON.stringify(data)));
  }, 30);
  else __events.push(m);
} };
</script>
<script>${bridgeJs(store)}</script>
<style>.hide{display:none}</style>
</head><body>
<p id="q">Which process group develops the project charter for a new initiative?</p>
<button id="ab">The project manager should escalate the issue to the sponsor</button>
<button id="next">Next</button>
<div id="exp" class="hide">The correct answer is Initiating because the charter authorizes the project.</div>
<script>${PAGE_JS.replace(/<\/script>/g, "<\\/script>")}</script>
<script>
const tr = (id) => document.getElementById(id).getAttribute("data-hm-tr") || "";
setTimeout(() => document.getElementById("exp").classList.remove("hide"), 1500);
// удаан дарах: «Which» үг дээр хуруугаа 0.45 сек барина → апп руу «word» очих ёстой
setTimeout(() => {
  const r = document.getElementById("q").getBoundingClientRect(), x = r.left + 12, y = r.top + 8;
  const touch = new Touch({ identifier: 1, target: document.getElementById("q"), clientX: x, clientY: y });
  document.dispatchEvent(new TouchEvent("touchstart", { touches: [touch], bubbles: true }));
  setTimeout(() => document.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true })), 700);
}, 1000);
// апп-аас «Монгол» горим руу шилжүүлнэ (тохиргоо өөрчлөгдөхөд апп ингэж илгээдэг)
setTimeout(() => eval(${JSON.stringify(toPage({ kind: "store", data: { pageMode: "mo" } }))}), 3000);
// текст сонгоход апп руу «sel» мессеж очих ёстой
setTimeout(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("next")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, 3500);
setTimeout(() => {
  const bad = [];
  if (!tr("q").startsWith("MN:")) bad.push("асуулт");
  if (!tr("ab").startsWith("MN:")) bad.push("товч хэлбэртэй хариулт (шалгалтын горим)");
  if (tr("next")) bad.push("Next товчийг орчуулсан");
  if (!tr("exp").startsWith("MN:")) bad.push("нуугдсан тайлбар");
  if (document.documentElement.getAttribute("data-hm-mode") !== "mo") bad.push("апп-аас горим солиход хуудас шинэчлэгдсэнгүй");
  if (document.querySelector("hm-pill")) bad.push("булангийн товч гарсан (утсанд гарах ёсгүй)");
  if (!__events.some((e) => e.kind === "sel" && e.text === "Next")) bad.push("сонгосон текст апп руу очсонгүй");
  if (!__events.some((e) => e.kind === "word" && e.word === "Which")) bad.push("удаан дарахад үг апп руу очсонгүй: " + JSON.stringify(__events));
  document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
  document.body.setAttribute("data-log", __log.join(","));
}, 6000);
</script></body></html>`;
writeFileSync(out, html);
console.log("written", out, html.length);
