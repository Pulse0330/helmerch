// PDF үзүүлэгч (WebView доторх HTML) — pdf.js-ээр хуудас бүрийг зурж, догол мөрүүдийг орчуулна.
// Орчуулгыг bridge-ээр (chrome.runtime.sendMessage) апп руу хүсэнэ. Харагдаж буй хуудсыг л орчуулна.
// PDF-ийн өгөгдлийг апп хэсэгчлэн (__pdfChunk) дамжуулна.
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build";

export const PDF_VIEWER_HTML = `<!doctype html><html lang="mn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4">
<style>
:root{--bg:#f4f5f8;--card:#fff;--text:#1b1f2a;--muted:#6b7385;--accent:#1565c0;--line:#e6e8ef}
@media (prefers-color-scheme: dark){:root{--bg:#16181d;--card:#1f2229;--text:#eceef3;--muted:#9aa2b2;--accent:#5c9bff;--line:#2d313b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,system-ui,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
#msg{padding:40px 20px;text-align:center;color:var(--muted)}
.pg{background:var(--card);margin:10px;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.pn{font-size:12px;color:var(--muted);padding:10px 14px 0}
canvas{display:block;width:100%;height:auto;border-bottom:1px solid var(--line)}
body.noimg canvas{display:none}
.tr{padding:10px 14px 14px}
.p{margin:0 0 12px}
.p .src{font-size:13px;color:var(--muted);margin-bottom:2px}
body:not(.showsrc) .p .src{display:none}
.p .mn{white-space:pre-wrap}
.wait{height:12px;border-radius:6px;margin:8px 0;background:linear-gradient(90deg,rgba(127,140,160,.14) 25%,rgba(127,140,160,.3) 37%,rgba(127,140,160,.14) 63%);background-size:400% 100%;animation:sh 1.3s ease infinite}
@keyframes sh{0%{background-position:100% 50%}100%{background-position:0 50%}}
.q{font-size:11px;margin-left:4px}
</style></head><body class="showsrc">
<div id="msg">PDF уншиж байна…</div><div id="doc"></div>
<script>
// апп PDF-ийг шууд дамжуулж эхэлнэ — pdf.js (модуль) ачаалагдаж дуустал энд хадгална
window.__chunks = []; window.__pdfChunk = function(c){ window.__chunks.push(c); };
window.__pdfEnd = function(n){ window.__pdfName = n; window.__pdfReady = true; if (window.__pdfGo) window.__pdfGo(); };
window.__pdfView = function(o){ document.body.classList.toggle("noimg", !o.img); document.body.classList.toggle("showsrc", !!o.src); };
</script>
<script type="module">
import * as pdfjsLib from "${PDFJS}/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "${PDFJS}/pdf.worker.min.mjs";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));
let pdf = null, title = "";
window.__pdfGo = async () => {
  if (pdf) return;
  title = window.__pdfName || "";
  try {
    const bin = atob(window.__chunks.join("")); window.__chunks = [];
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    $("msg").style.display = "none";
    build();
  } catch (e) {
    $("msg").textContent = "Энэ PDF-ийг нээж чадсангүй. Өөр файл сонгоно уу.";
  }
};
if (window.__pdfReady) window.__pdfGo();

// текстийн хэсгүүдийг мөр → догол мөр болгоно (мөр хоорондын зай томровол шинэ догол мөр)
function paragraphs(items) {
  const lines = [];
  for (const it of items) {
    const s = it.str; if (!s || !s.trim()) { if (it.hasEOL && lines.length) lines[lines.length - 1].eol = true; continue; }
    const y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < h * 0.5 && !last.eol) last.text += (/\\s$/.test(last.text) ? "" : " ") + s;
    else lines.push({ y, h, text: s, eol: it.hasEOL });
  }
  const paras = [];
  let cur = null;
  for (const l of lines) {
    const gap = cur ? cur.y - l.y : 0;
    if (cur && gap > 0 && gap < l.h * 1.9 && !/[.:?!]$/.test(cur.text.trim()) || (cur && gap > 0 && gap < l.h * 1.35)) {
      cur.text += (cur.text.endsWith("-") ? "" : " ") + l.text; cur.y = l.y;
    } else { cur = { y: l.y, text: l.text }; paras.push(cur); }
  }
  return paras.map((p) => p.text.replace(/\\s+/g, " ").trim()).filter((t) => /\\p{L}{2,}/u.test(t)).slice(0, 120);
}

const pages = [];
function build() {
  const doc = $("doc");
  for (let n = 1; n <= pdf.numPages; n++) {
    const el = document.createElement("div");
    el.className = "pg";
    el.innerHTML = '<div class="pn">' + n + "-р хуудас</div><canvas></canvas><div class=\\"tr\\"><div class=\\"wait\\"></div><div class=\\"wait\\" style=\\"width:70%\\"></div></div>";
    el.style.minHeight = "300px";
    doc.appendChild(el);
    pages.push({ n, el, done: false });
  }
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const pg = pages.find((p) => p.el === e.target);
    if (pg && !pg.done) { pg.done = true; io.unobserve(e.target); renderPage(pg); }
  }), { rootMargin: "800px 0px" });
  pages.forEach((p) => io.observe(p.el));
}

async function renderPage(pg) {
  const page = await pdf.getPage(pg.n);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, (window.innerWidth - 20) * (window.devicePixelRatio || 1) / vp1.width);
  const vp = page.getViewport({ scale });
  const cv = pg.el.querySelector("canvas");
  cv.width = vp.width; cv.height = vp.height;
  await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
  pg.el.style.minHeight = "";
  const paras = paragraphs((await page.getTextContent()).items);
  const tr = pg.el.querySelector(".tr");
  if (!paras.length) { tr.innerHTML = '<div class="pn" style="padding:0">Энэ хуудсанд текст алга (скан бол «Зураг» хэсгээр орчуулна).</div>'; return; }
  tr.innerHTML = paras.map((t) => '<div class="p"><div class="src">' + esc(t) + '</div><div class="mn"><div class="wait"></div></div></div>').join("");
  const mnEls = [...tr.querySelectorAll(".mn")];
  const ctx = "Document: " + title + " | page " + pg.n;
  // эхлээд хурдан, дараа нь AI (мэргэжлийн) — алдаа гарвал чимээгүй дахин оролдоно
  for (let tries = 0; tries < 6; tries++) {
    const r = await send({ type: "translate", kind: "text", texts: paras, quality: false, context: ctx });
    if (r.results) {
      r.results.forEach((x, i) => { if (x.mn) mnEls[i].textContent = x.mn; });
      if (!r.ai) {
        const q = await send({ type: "translate", kind: "text", texts: paras, quality: true, context: ctx });
        if (q.results && q.ai) q.results.forEach((x, i) => { if (x.mn) mnEls[i].innerHTML = esc(x.mn) + '<span class="q">✨</span>'; });
      }
      return;
    }
    await new Promise((res) => setTimeout(res, Math.min(30000, 2000 * 2 ** tries)));
  }
}
</script></body></html>`;
