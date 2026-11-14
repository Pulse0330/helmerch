// Видеоны скриптийг (VIDEO_BEFORE_JS) шалгах хуудас: YouTube-гүйгээр хадмалын хүсэлтийг дуурайна.
// fetch (json3) болон XHR (xml) хоёуланг барьж, орчуулж, видеоны цагт тохирох монгол хадмал харуулж байгааг шалгана.
import { writeFileSync } from "node:fs";
import { bridgeJs, toPage } from "../src/web/inject";
import { VIDEO_BEFORE_JS, youtubeId } from "../src/web/video";

// холбоосоос ID таних
const ids = ["https://youtu.be/UF8uR6Z6KLc?si=x", "https://www.youtube.com/watch?v=UF8uR6Z6KLc&t=3", "https://m.youtube.com/shorts/UF8uR6Z6KLc"].map(youtubeId);
const idOk = ids.every((x) => x === "UF8uR6Z6KLc") && youtubeId("https://example.com") === null;

const json3 = JSON.stringify({ events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Thank you." }] },
  { tStartMs: 2000, dDurationMs: 3000, segs: [{ utf8: "I am honored " }, { utf8: "to be with you today." }] },
  { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: "\n" }] },
  { tStartMs: 7000, dDurationMs: 2000, segs: [{ utf8: "Stay hungry, stay foolish." }] },
] });
const respTpl = JSON.stringify(toPage({ kind: "resp", id: 0, data: null }));
const html = `<!doctype html><html><head><meta charset="utf-8">
<script>
window.__events = [];
window.ReactNativeWebView = { postMessage(s) {
  const m = JSON.parse(s);
  if (m.kind !== "req") { __events.push(m.kind); return; }
  setTimeout(() => {
    const data = { results: m.msg.texts.map((t) => ({ mn: (m.msg.quality ? "AI:" : "MN:") + t })), tier: m.msg.quality ? "pro" : "google", ai: !!m.msg.quality };
    eval(${respTpl}.replace('"id":0', '"id":' + m.id).replace('"data":null', '"data":' + JSON.stringify(data)));
  }, 20);
} };
</script>
<script>${bridgeJs({ pageMode: "off", subs: false, settings: { quality: true } })}</script>
<script>${VIDEO_BEFORE_JS}</script>
</head><body style="margin:0">
<video id="decoy" width="40" height="20" style="display:block"></video>
<div style="position:relative"><video id="v" width="320" height="180" style="display:block;background:#000"></video>
<div class="ytp-caption-window-container" style="position:absolute;left:0;right:0;bottom:10px"><span class="ytp-caption-segment" id="cc"></span></div></div>
<script>
// тоглуулагч хадмал татаж буй мэт (fetch, json3)
fetch("data:application/json;src=/api/timedtext," + encodeURIComponent(${JSON.stringify(json3)}));
const v = document.getElementById("v");
setTimeout(() => { v.currentTime = 3; }, 1500);
setTimeout(() => {
  const V = window.__hmV, box = document.querySelector("hm-sub");
  const at3 = box ? box.innerText : "";
  const bad = [];
  if (!${idOk}) bad.push("YouTube холбоосоос ID таньсангүй");
  if (!V.got || V.cues.length !== 3) bad.push("хадмал баригдсангүй (" + V.cues.length + ")");
  if (!/AI:I am honored to be with you today\\./.test(at3)) bad.push("3-р секундэд буруу хадмал: " + JSON.stringify(at3));
  if (!__events.includes("vstatus")) bad.push("төлөв апп руу очсонгүй");
  if (!__events.includes("vready")) bad.push("бүх хадмал бэлэн болсныг мэдэгдсэнгүй");
  if (V.preparing) bad.push("бэлдэж дуусаагүй");
  // XML (srv1) хэлбэр
  const x = new XMLHttpRequest(); x.open("GET", "data:text/xml;src=/api/timedtext," + encodeURIComponent('<transcript><text start="0.5" dur="1.5">Hello &amp; welcome</text><text start="2" dur="2">Second line</text></transcript>'));
  V.got = false;
  x.onload = () => setTimeout(() => {      // hook-ийн load listener (send дотор нэмэгддэг) дараа нь ажилладаг
    if (V.cues.length !== 2 || V.cues[0].t !== "Hello & welcome") bad.push("xml хадмал задарсангүй: " + JSON.stringify(V.cues));
    // хүсэлт баригдаагүй ч YouTube-ийн CC дэлгэц дээр гарвал түүнийг уншиж орчуулна
    V.cues = []; V.got = false;
    document.getElementById("cc").textContent = "Stay hungry, stay foolish.";
    setTimeout(() => {
      const shown = document.querySelector("hm-sub").innerText;
      if (!/MN:Stay hungry, stay foolish\\./.test(shown)) bad.push("дэлгэцийн хадмалыг орчуулсангүй: " + JSON.stringify(shown));
      if (getComputedStyle(document.getElementById("cc")).opacity !== "0") bad.push("англи (YouTube) хадмал харагдсаар байна");
      // «МН хадмал» унтраахад монгол хадмал алга болж, англи нь ч нуугдахаа болино
      window.__hmSubs(false);
      setTimeout(() => {
        if (document.querySelector("hm-sub").innerText.trim()) bad.push("унтраасан ч монгол хадмал гарсаар байна");
        if (getComputedStyle(document.getElementById("cc")).opacity === "0") bad.push("унтраасны дараа англи хадмал нуугдсаар");
        document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
      }, 500);
    }, 800);
  }, 200);
  x.send();
}, 4000);
</script></body></html>`;
writeFileSync(process.argv[2], html);
console.log("written", process.argv[2]);
