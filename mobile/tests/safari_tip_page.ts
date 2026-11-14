// Safari өргөтгөлийн tip.js: удаан дарах болон текст сонгоход орчуулгын хүсэлт background руу очиж байгааг шалгана.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tip = readFileSync(join(__dirname, "..", "targets", "safari", "assets", "tip.js"), "utf8");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script>
window.__sent = [];
window.browser = { runtime: { sendMessage: (m) => { __sent.push(m.kind + ":" + m.texts[0]); return Promise.resolve({ results: [{ mn: "MN:" + m.texts[0] }] }); } } };
</script></head><body>
<p id="q" style="font-size:20px">Stakeholders must be identified early.</p>
<p id="s">Risk register is updated throughout the project.</p>
<script>${tip.replace(/<\/script>/g, "<\\/script>")}</script>
<script>
setTimeout(() => {
  const r = document.getElementById("q").getBoundingClientRect(), x = r.left + 15, y = r.top + 10;
  const touch = new Touch({ identifier: 1, target: document.getElementById("q"), clientX: x, clientY: y });
  document.dispatchEvent(new TouchEvent("touchstart", { touches: [touch], bubbles: true }));
  setTimeout(() => document.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true })), 700);
}, 500);
setTimeout(() => { const rg = document.createRange(); rg.selectNodeContents(document.getElementById("s")); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }, 2000);
setTimeout(() => {
  const bad = [];
  if (!__sent.includes("word:Stakeholders")) bad.push("удаан дарахад үг очсонгүй: " + JSON.stringify(__sent));
  if (!__sent.includes("text:Risk register is updated throughout the project.")) bad.push("сонгосон текст очсонгүй: " + JSON.stringify(__sent));
  if (!document.querySelector("hm-tip")) bad.push("орчуулгын самбар гарсангүй");
  document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
}, 4000);
</script></body></html>`;
writeFileSync(process.argv[2], html);
