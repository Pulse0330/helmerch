// PDF үзүүлэгчийг (PDF_VIEWER_HTML) Chrome headless-ээр шалгах хуудас: жижиг PDF үүсгэж, апп шиг хэсэгчлэн дамжуулна.
import { writeFileSync } from "node:fs";
import { bridgeJs, toPage } from "../src/web/inject";
import { PDF_VIEWER_HTML } from "../src/web/pdfViewer";

// 1 хуудастай, 2 догол мөртэй хамгийн энгийн PDF
function makePdf(): string {
  const content = "BT /F1 14 Tf 50 750 Td (The project charter formally authorizes the project.) Tj 0 -18 Td " +
    "(It is created during the initiating process group.) Tj 0 -60 Td (Stakeholders are identified early in the project.) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1").toString("base64");
}

const b64 = makePdf();
const store = { pageMode: "bi", settings: { quality: false } };
const respTpl = JSON.stringify(toPage({ kind: "resp", id: 0, data: null }));
const fake = `<script>
window.__log = [];
window.ReactNativeWebView = { postMessage(s) {
  const m = JSON.parse(s); if (m.kind !== "req") return;
  __log.push(m.msg.quality ? "Q" + m.msg.texts.length : "F" + m.msg.texts.length);
  setTimeout(() => {
    const data = { results: m.msg.texts.map((t) => ({ mn: (m.msg.quality ? "AI:" : "MN:") + t })), tier: m.msg.quality ? "pro" : "google", ai: !!m.msg.quality };
    eval(${respTpl}.replace('"id":0', '"id":' + m.id).replace('"data":null', '"data":' + JSON.stringify(data)));
  }, 30);
} };
</script><script>${bridgeJs(store)}</script>`;
const check = `<script>
// апп шиг: ачаалагдсаны дараа хэсэгчлэн дамжуулна
const B64 = ${JSON.stringify(b64)};
for (let i = 0; i < B64.length; i += 200) window.__pdfChunk(B64.slice(i, i + 200));
window.__pdfEnd("test.pdf");
setTimeout(() => {
  const mns = [...document.querySelectorAll(".mn")].map((e) => e.textContent);
  const bad = [];
  if (!document.querySelector("canvas") || !document.querySelector("canvas").width) bad.push("хуудас зурагдсангүй");
  if (mns.length < 2) bad.push("догол мөр олдсонгүй (" + mns.length + ")");
  if (!mns.every((t) => t.startsWith("AI:"))) bad.push("AI орчуулга орсонгүй: " + JSON.stringify(mns));
  document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
  document.body.setAttribute("data-log", __log.join(",") + " | " + mns.join(" / "));
}, 12000);
</script>`;
const html = PDF_VIEWER_HTML.replace("<head>", "<head>" + fake).replace("</body>", check + "</body>");
writeFileSync(process.argv[2], html);
console.log("written", process.argv[2]);
