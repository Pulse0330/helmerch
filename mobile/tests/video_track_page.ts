// Видео: YouTube хадмалаа видеонд text track болгон залгасан үед (iPhone) бүх мөрийг түүнээс авч, урьдчилан орчуулж,
// монгол хадмалыг өөрийн track болгон залгаж байгааг шалгана (бүтэн дэлгэцийн тоглуулагч track-ийг харуулдаг).
import { writeFileSync } from "node:fs";
import { bridgeJs, toPage } from "../src/web/inject";
import { VIDEO_BEFORE_JS } from "../src/web/video";

const respTpl = JSON.stringify(toPage({ kind: "resp", id: 0, data: null }));
const html = `<!doctype html><html><head><meta charset="utf-8">
<script>
window.__events = [];
window.ReactNativeWebView = { postMessage(s) {
  const m = JSON.parse(s);
  if (m.kind !== "req") { __events.push(m.kind); return; }
  setTimeout(() => {
    const data = { results: m.msg.texts.map((t) => ({ mn: "MN:" + t })), tier: "google", ai: false };
    eval(${respTpl}.replace('"id":0', '"id":' + m.id).replace('"data":null', '"data":' + JSON.stringify(data)));
  }, 20);
} };
</script>
<script>${bridgeJs({ pageMode: "off", settings: { quality: false } })}</script>
<script>${VIDEO_BEFORE_JS}</script>
</head><body style="margin:0">
<video id="v" width="320" height="180" style="display:block;background:#000"></video>
<script>
// YouTube-ийн залгадагтай адил англи track (хүсэлт баригдаагүй гэж үзнэ)
const v = document.getElementById("v");
const en = v.addTextTrack("captions", "English", "en");
[[0, 2, "Thank you."], [2, 5, "I am honored to be with you today."], [7, 9, "Stay hungry, stay foolish."]].forEach(([s, e, t]) => en.addCue(new VTTCue(s, e, t)));
setTimeout(() => {
  const V = window.__hmV, bad = [];
  if (!V.got || V.cues.length !== 3) bad.push("track-аас хадмал авсангүй (" + V.cues.length + ")");
  if (!__events.includes("vready")) bad.push("урьдчилан орчуулж дуусгасангүй");
  const mn = [...v.textTracks].find((t) => t.language === "mn");
  if (!mn) bad.push("монгол track залгагдсангүй");
  else if (!mn.cues || mn.cues.length !== 3 || mn.cues[1].text !== "MN:I am honored to be with you today.") bad.push("монгол track-ийн мөр буруу: " + (mn.cues ? mn.cues.length : "null"));
  if (mn && mn.mode === "showing") bad.push("апп дотор (бүтэн дэлгэц биш) монгол track харагдаж байна — давхар гарна");
  document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
}, 3000);
</script></body></html>`;
writeFileSync(process.argv[2], html);
