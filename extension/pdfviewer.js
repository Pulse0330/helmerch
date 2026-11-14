// Хэлмэрч — PDF үзүүлэгч: хуудас бүрийн хажууд монгол орчуулга
import * as pdfjsLib from "./pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdfjs/pdf.worker.min.mjs");

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const send = (msg) => new Promise((res) => {
  try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || { error: "Өргөтгөлтэй холбогдсонгүй" }); }); }
  catch (e) { res({ error: String(e) }); }
});

let file = location.href.includes("?file=") ? location.href.slice(location.href.indexOf("?file=") + 6) : "";
if (/^[a-z]+%3A/i.test(file)) file = decodeURIComponent(file);

// Харагдах горим: side = эх хуудас + яг ижил загвартай монгол хуудас, swap = зөвхөн монгол хуудас,
// text = эх хуудас + орчуулгын текст, off = орчуулгагүй
const MODES = ["side", "swap", "text", "off"];
let pdf = null, scale = 0, mode = "side", useQuality = true;
send({ type: "getSettings" }).then((r) => {
  if (r && r.quality === false) useQuality = false;
  // хувилбар: програм (сервер) ба өргөтгөл ижил эсэхийг шалгана
  const ext = chrome.runtime.getManifest().version, srv = r && r._version;
  $("ver").textContent = "v" + ext;
  if (srv && srv !== ext) {
    $("ver").textContent = `v${ext} ⚠`;
    $("ver").title = `Програм v${srv}, өргөтгөл v${ext} — chrome://extensions дээр Хэлмэрч-ийн ↻ товчийг дарна уу`;
    $("ver").style.color = "#ffb74d";
  }
});
const pages = [];  // {num, row, pageEl, mirEl, trEl, rendered, translated, units, blocks, mns}
try {
  const m = localStorage.getItem("mn_pdf_mode");
  mode = MODES.includes(m) ? m : (localStorage.getItem("mn_pdf_tr") === "0" ? "off" : "side");
  scale = parseFloat(localStorage.getItem("mn_pdf_zoom")) || 0;
} catch (e) {}
const showTr = () => mode !== "off";

function setMsg(t) { $("msg").style.display = t ? "block" : "none"; $("msg").textContent = t || ""; }

// ---------------------------------------------------------------- догол мөр болгох
function groupParagraphs(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!("str" in it)) continue;
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (cur && Math.abs(cur.y - y) < h * 0.5) {
      const sep = cur.text && it.str && !/\s$/.test(cur.text) && !/^\s/.test(it.str) ? " " : "";
      cur.text += sep + it.str;
    } else {
      if (cur) lines.push(cur);
      cur = { y, h, text: it.str };
    }
    if (it.hasEOL) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);

  const paras = [];
  let p = null, prev = null;
  for (const l of lines) {
    const t = l.text.replace(/\s+/g, " ").trim();
    if (!t) { if (p) paras.push(p); p = null; prev = null; continue; }
    const gap = prev ? prev.y - l.y : 0;
    if (p !== null && prev && gap > 0 && gap < Math.max(prev.h, l.h) * 1.75) {
      p = /[A-Za-zА-Яа-я]-$/.test(p) ? p.slice(0, -1) + t : p + " " + t;
    } else {
      if (p) paras.push(p);
      p = t;
    }
    prev = l;
  }
  if (p) paras.push(p);
  return paras.filter((x) => /\p{L}/u.test(x));
}

// хуудас бүрт давтагддаг толгой/хөл бичиг, хуудасны дугаарыг хасна
const edgeSeen = new Map();
const isPageNo = (t) => /^(page\s*)?[#\divxlc]{1,6}(\s*(of|\/)\s*\d+)?$/i.test(t.trim());
function cleanParagraphs(paras) {
  return paras.filter((t, i) => keepMask(paras)[i]);
}
// текст горимд харуулах эсэх (хуудасны дугаар, давтагддаг толгой/хөл бичгийг нууна)
function keepMask(paras) {
  const key = (t) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const edges = new Set([0, 1, paras.length - 1, paras.length - 2]);
  return paras.map((t, i) => {
    if (isPageNo(t)) return false;
    if (edges.has(i) && t.length < 90) {
      const k = key(t);
      const n = (edgeSeen.get(k) || 0) + 1;
      edgeSeen.set(k, n);
      if (n >= 2) return false; // өөр хуудсанд аль хэдийн гарсан толгой/хөл бичиг
    }
    return true;
  });
}

// ---------------------------------------------------------------- хуудасны загвар (layout) таних
// Текстийг байрлалаар нь мөр → блок (догол мөр, хүснэгтийн нүд, жагсаалтын мөр) болгоно.
// Блок бүр эх хуудсан дээрх байршил, үсгийн хэмжээ, тод эсэхтэйгээ хадгалагдана.
const BULLET_RE = /^[\s•●○◦■□▪▫‣∙·\-–—➢►▶✓✔❖◆◇*]+$/u;

function buildLayout(textContent, vp, page) {
  const boldCache = {};
  const isBold = (fn) => {
    if (fn in boldCache) return boldCache[fn];
    let b = false;
    try {
      const f = page.commonObjs.has(fn) && page.commonObjs.get(fn);
      b = !!(f && (f.bold || f.black || /bold|black|heavy|semibold|demi/i.test(f.name || "")));
    } catch (e) {}
    return (boldCache[fn] = b);
  };
  const isSerif = (fn) => {
    const ff = (textContent.styles[fn] || {}).fontFamily || "";
    return /serif/i.test(ff) && !/sans/i.test(ff);
  };

  const items = [];
  for (const it of textContent.items) {
    if (!("str" in it) || !it.str || !it.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const h = Math.hypot(tx[2], tx[3]);
    if (h < 3 || Math.abs(tx[1]) > 0.02 * h || Math.abs(tx[2]) > 0.02 * h) continue; // эргэсэн текстэд хүрэхгүй
    const w = it.width * vp.scale;
    if (!(w > 0)) continue;
    items.push({ str: it.str, x0: tx[4], x1: tx[4] + w, base: tx[5], h,
                 bold: isBold(it.fontName), serif: isSerif(it.fontName) });
  }
  if (!items.length) return [];

  // 1) ижил суурь шугамтай текстийг нэг мөр болгоно
  items.sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rows = [];
  for (const it of items) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.base - r.base) < 0.45 * Math.min(r.h, it.h)) r.items.push(it);
    else rows.push({ base: it.base, h: it.h, items: [it] });
  }

  // 2) мөрийг том зайгаар (хүснэгтийн багана) хэсэглэнэ; жагсаалтын тэмдгийг (•) хадгална
  const segs = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x0 - b.x0);
    let cur = null, bullet = false;
    for (const it of r.items) {
      const gap = cur ? it.x0 - cur.x1 : Infinity;
      if (cur && gap > 1.6 * Math.max(cur.h, it.h)) { segs.push(cur); cur = null; }
      if (!cur && BULLET_RE.test(it.str) && it.str.trim().length <= 2) { bullet = true; continue; }
      if (!cur) {
        cur = { x0: it.x0, x1: it.x1, base: it.base, h: it.h, text: it.str, items: [it], bullet };
        bullet = false;
      } else {
        const sep = gap > 0.12 * it.h && !/\s$/.test(cur.text) && !/^\s/.test(it.str) ? " " : "";
        cur.text += sep + it.str;
        cur.x1 = Math.max(cur.x1, it.x1);
        cur.items.push(it);
        if (it.h > cur.h && it.str.trim().length > 2) { cur.h = it.h; cur.base = it.base; }
      }
    }
    if (cur) segs.push(cur);
  }
  for (const s of segs) {
    let bc = 0, sc = 0, n = 0;
    for (const it of s.items) { const l = it.str.length; n += l; if (it.bold) bc += l; if (it.serif) sc += l; }
    s.bold = bc > n / 2;
    s.serif = sc > n / 2;
    s.text = s.text.replace(/\s+/g, " ").trim();
  }

  // 3) дараалсан мөрүүдийг блок (догол мөр / нүд) болгоно
  segs.sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const blocks = [];
  for (const s of segs) {
    let best = null, bestScore = 1e9;
    if (!s.bullet) {
      for (const b of blocks) {
        const l = b.last, hh = Math.max(l.h, s.h);
        const dy = s.base - l.base;
        if (dy < 0.6 * hh || dy > 1.8 * hh) continue;
        if (s.h / l.h > 1.2 || l.h / s.h > 1.2 || s.bold !== l.bold) continue;
        if (s.x0 > l.x1 || s.x1 < l.x0) continue;
        const dx = Math.abs(s.x0 - l.x0);
        const indent = b.lines.length === 1 && s.x0 < l.x0 && l.x0 - s.x0 < 4 * hh;  // эхний мөрийн догол
        if (dx > 0.8 * hh && !indent) continue;
        const score = dx + dy;
        if (score < bestScore) { best = b; bestScore = score; }
      }
    }
    if (best) {
      const t = best.text;
      best.text = /\p{L}-$/u.test(t) && /^\p{Ll}/u.test(s.text) ? t.slice(0, -1) + s.text : t + " " + s.text;
      best.lines.push(s);
      best.last = s;
      best.x0 = Math.min(best.x0, s.x0);
      best.x1 = Math.max(best.x1, s.x1);
    } else {
      blocks.push({ lines: [s], last: s, x0: s.x0, x1: s.x1, text: s.text, bold: s.bold, serif: s.serif });
    }
  }

  const out = blocks.filter((b) => /\p{L}{2,}/u.test(b.text) && !isPageNo(b.text));
  for (const b of out) {
    const f = b.lines[0], l = b.last;
    const hs = b.lines.map((x) => x.h).sort((a, c) => a - c);
    b.h = hs[hs.length >> 1];
    b.top = f.base - 0.92 * f.h;
    b.bottom = l.base + 0.28 * l.h;
    b.lh = b.lines.length > 1 ? Math.min(1.5, Math.max(1.05, (l.base - f.base) / (b.lines.length - 1) / b.h)) : 1.15;
    b.rects = b.lines.map((x) => [x.x0 - 1, x.base - 0.95 * x.h, x.x1 - x.x0 + 2, 1.25 * x.h]);
  }
  placeBlocks(out, vp.width, vp.height);
  return out;
}

// Монгол текст урт тул блок бүрт хэр зай байгааг (баруун/доош) тооцно
function placeBlocks(blocks, W, H) {
  if (!blocks.length) return;
  const minX = Math.min(...blocks.map((b) => b.x0));
  const maxX = Math.max(...blocks.map((b) => b.x1));
  const vOverlap = (a, b) => a.top < b.bottom && b.top < a.bottom;
  for (const b of blocks) {
    let R = null, L = null;
    for (const c of blocks) {
      if (c === b || !vOverlap(b, c)) continue;
      if (c.x0 >= b.x1 - 1 && (R === null || c.x0 < R)) R = c.x0;
      if (c.x1 <= b.x0 + 1 && (L === null || c.x1 > L)) L = c.x1;
    }
    const pad = 0.5 * b.h;
    let left = b.x0, right = Math.max(b.x1, (R !== null ? R - pad : maxX));
    b.align = "left";
    if (b.lines.length === 1) {
      const lb = L !== null ? L : minX, rb = R !== null ? R : W - minX;
      const lg = b.x0 - lb, rg = rb - b.x1;
      if (lg > 2 * b.h && rg > 2 * b.h && Math.abs(lg - rg) < 0.25 * Math.max(lg, rg)) {
        const cx = (b.x0 + b.x1) / 2, half = Math.min(cx - lb, rb - cx) - pad;
        left = cx - half; right = cx + half; b.align = "center";
      }
    }
    b.bx = left;
    b.bw = Math.max(right - left, b.x1 - b.x0);
    let below = H - 4;
    for (const c of blocks) {
      if (c === b || c.top < b.bottom - 0.3 * b.h) continue;
      if (c.x0 < left + b.bw && c.x1 > left && c.top < below) below = c.top;
    }
    b.maxH = Math.max(b.bottom - b.top, below - b.top - 1);
  }
}

// эх хуудасны пикселээс блокийн дэвсгэр болон үсгийн өнгийг олно
function blockColors(ctx, b, dpr) {
  const hist = new Map();
  let total = 0;
  const pix = [];
  for (const [x, y, w, h] of b.rects) {
    const X = Math.max(0, Math.floor(x * dpr)), Y = Math.max(0, Math.floor(y * dpr));
    const Wd = Math.max(1, Math.min(ctx.canvas.width - X, Math.ceil(w * dpr)));
    const Hd = Math.max(1, Math.min(ctx.canvas.height - Y, Math.ceil(h * dpr)));
    let d;
    try { d = ctx.getImageData(X, Y, Wd, Hd).data; } catch (e) { continue; }
    const step = Math.max(1, Math.floor(d.length / 4 / 4000)) * 4;
    for (let i = 0; i < d.length; i += step) {
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      hist.set(k, (hist.get(k) || 0) + 1);
      pix.push(d[i], d[i + 1], d[i + 2]);
      total++;
    }
  }
  if (!total) return { bg: "#ffffff", fg: "#111111" };
  let bgK = 0, bgN = -1;
  for (const [k, n] of hist) if (n > bgN) { bgK = k; bgN = n; }
  // дэвсгэр: тухайн бүлгийн дундаж өнгө
  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < pix.length; i += 3) {
    const k = ((pix[i] >> 4) << 8) | ((pix[i + 1] >> 4) << 4) | (pix[i + 2] >> 4);
    if (k === bgK) { r += pix[i]; g += pix[i + 1]; bl += pix[i + 2]; n++; }
  }
  r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n);
  // үсгийн өнгө: дэвсгэрээс хамгийн их ялгаатай (захын бүдэг пикселийг тооцохгүй) пикселүүдийн дундаж
  let maxD = 0;
  for (let i = 0; i < pix.length; i += 3) {
    const dd = Math.abs(pix[i] - r) + Math.abs(pix[i + 1] - g) + Math.abs(pix[i + 2] - bl);
    if (dd > maxD) maxD = dd;
  }
  let fg = null, best = 0;
  if (maxD > 160) {
    fg = [0, 0, 0, 0];
    for (let i = 0; i < pix.length; i += 3) {
      const dd = Math.abs(pix[i] - r) + Math.abs(pix[i + 1] - g) + Math.abs(pix[i + 2] - bl);
      if (dd >= maxD * 0.85) { fg[0]++; fg[1] += pix[i]; fg[2] += pix[i + 1]; fg[3] += pix[i + 2]; }
    }
    best = fg[0];
  }
  const luma = 0.299 * r + 0.587 * g + 0.114 * bl;
  const fgc = fg && best > 3 ? `rgb(${Math.round(fg[1] / fg[0])},${Math.round(fg[2] / fg[0])},${Math.round(fg[3] / fg[0])})`
    : (luma > 140 ? "#111" : "#fff");
  return { bg: `rgb(${r},${g},${bl})`, fg: fgc, rgb: [r, g, bl] };
}

// ---------------------------------------------------------------- хуудас зурах
async function renderPage(pg) {
  if (pg.rendered) return;
  pg.rendered = true;
  const page = await pdf.getPage(pg.num);
  const vp = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  pg.dpr = dpr;
  pg.vp = vp;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = vp.width + "px";
  canvas.style.height = vp.height + "px";
  for (const el of [pg.pageEl, pg.mirEl]) {
    el.style.width = vp.width + "px";
    el.style.height = vp.height + "px";
  }
  pg.pageEl.innerHTML = "";
  pg.pageEl.appendChild(canvas);
  pg.canvas = canvas;
  await page.render({
    canvasContext: canvas.getContext("2d"), viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  }).promise;

  const textContent = await page.getTextContent();
  const tl = document.createElement("div");
  tl.className = "textLayer";
  tl.style.setProperty("--scale-factor", vp.scale);
  tl.style.setProperty("--total-scale-factor", vp.scale);
  pg.pageEl.appendChild(tl);
  try {
    await new pdfjsLib.TextLayer({ textContentSource: textContent, container: tl, viewport: vp }).render();
  } catch (e) { console.warn("textLayer", e); }
  const back = document.createElement("button");
  back.className = "en"; back.textContent = "МН"; back.title = "Монгол руу буцах";
  back.onclick = () => pg.row.classList.remove("orig");
  pg.pageEl.appendChild(back);
  try { pg.blocks = buildLayout(textContent, vp, page); } catch (e) { console.warn("layout", e); pg.blocks = []; }
  // орчуулах нэгж: загвар танигдсан бол блокууд, үгүй бол догол мөрүүд
  pg.units = pg.blocks.length ? pg.blocks.map((b) => b.text) : groupParagraphs(textContent.items);
  pg.keep = keepMask(pg.units);
  pg.row.classList.toggle("nolayout", !pg.blocks.length);
  // томруулж/жижигрүүлсний дараа орчуулгыг дахин ашиглана
  if (pg.prev && JSON.stringify(pg.prev.units) === JSON.stringify(pg.units)) {
    Object.assign(pg, { mns: pg.prev.mns, better: pg.prev.better, translated: !!pg.prev.mns });
  }
  pg.prev = null;
  drawMirror(pg);
  if (showTr()) translatePage(pg);
}

// ---------------------------------------------------------------- монгол хуудас (эх загвараар)
function drawMirror(pg) {
  if (!pg.canvas || !pg.blocks || !pg.blocks.length) return;
  if (!pg.mirEl.offsetParent) { pg.mirDirty = true; return; }   // харагдаагүй үед дараа зурна
  pg.mirDirty = false;
  const { vp, dpr } = pg;
  const src = pg.canvas;
  let c = pg.mirEl.querySelector("canvas");
  if (!c) {
    pg.mirEl.innerHTML = "";
    c = document.createElement("canvas");
    pg.mirEl.appendChild(c);
    const layer = document.createElement("div"); layer.className = "ml"; pg.mirEl.appendChild(layer);
    const b = document.createElement("button"); b.className = "en"; b.textContent = "EN";
    b.title = "Энэ хуудсыг англиар харах / буцаах";
    b.onclick = () => { pg.row.classList.toggle("orig"); };
    pg.mirEl.appendChild(b);
  }
  c.width = src.width; c.height = src.height;
  c.style.width = src.style.width; c.style.height = src.style.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const layer = pg.mirEl.querySelector(".ml");
  layer.innerHTML = "";
  pg.mirEl.classList.toggle("wait", !pg.mns);
  if (!pg.mns) return;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  pg.blocks.forEach((b, i) => {
    const mn = (pg.mns[i] || "").trim();
    if (!mn) return;  // орчуулга алга — эх текст хэвээр үлдэнэ
    if (!b.colors) b.colors = blockColors(sctx, b, dpr);
    ctx.fillStyle = b.colors.bg;
    if (!b.erase) b.erase = b.rects.map((rc) => trimRect(sctx, rc, b.colors.rgb, dpr));
    for (const [X, Y, Wd, Hd] of b.erase) if (Hd > 0) ctx.fillRect(X, Y, Wd, Hd);
    const d = document.createElement("div");
    d.className = "mb";
    d.textContent = mn;
    d.title = b.text;
    Object.assign(d.style, {
      left: b.bx + "px", top: b.top + "px", width: b.bw + "px", color: b.colors.fg,
      fontWeight: b.bold ? "700" : "400", textAlign: b.align, lineHeight: String(b.lh),
      fontFamily: b.serif ? "'Times New Roman', Georgia, serif" : "Arial, 'Segoe UI', sans-serif",
    });
    layer.appendChild(d);
    fitBlock(d, b);
  });
}

// арилгах тэгш өнцөгтийн дээд/доод захаас өөр дэвсгэртэй мөрүүдийг (хүснэгтийн хүрээ, өөр өнгийн мөр) хасна
function trimRect(sctx, [x, y, w, h], bg, dpr) {
  const X = Math.max(0, Math.floor(x * dpr)), Y = Math.max(0, Math.floor(y * dpr));
  const Wd = Math.min(sctx.canvas.width - X, Math.ceil(w * dpr)), Hd = Math.min(sctx.canvas.height - Y, Math.ceil(h * dpr));
  if (Wd <= 0 || Hd <= 0) return [X, Y, 0, 0];
  let d;
  try { d = sctx.getImageData(X, Y, Wd, Hd).data; } catch (e) { return [X, Y, Wd, Hd]; }
  const rowOk = (row) => {
    let ok = 0;
    for (let c = 0, i = row * Wd * 4; c < Wd; c++, i += 4) {
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 60) ok++;
    }
    return ok >= Wd * 0.35;
  };
  let top = 0, bot = Hd - 1;
  while (top <= bot && !rowOk(top)) top++;
  while (bot >= top && !rowOk(bot)) bot--;
  return [X, Y + top, Wd, Math.max(0, bot - top + 1)];
}

// үсгийн хэмжээг блокт багтахаар (хамгийн томоор) сонгоно
function fitBlock(d, b) {
  const H0 = (b.bottom - b.top) * 1.12, maxFs = b.h * 0.95, minFs = Math.max(5, b.h * 0.58);
  const fits = (fs, lim) => {
    d.style.fontSize = fs + "px";
    return d.scrollHeight <= Math.max(lim, fs * b.lh * 1.05) + 1 && d.scrollWidth <= d.clientWidth + 1;
  };
  const search = (lim) => {
    if (fits(maxFs, lim)) return maxFs;
    if (!fits(minFs, lim)) return 0;
    let lo = minFs, hi = maxFs;
    for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (fits(m, lim)) lo = m; else hi = m; }
    return lo;
  };
  let fs = search(H0);
  if (fs < b.h * 0.75) fs = Math.max(fs, search(b.maxH));
  if (fs < b.h * 0.8) {
    // үсгийг жижигрүүлэхийн оронд бага зэрэг шахаж (scaleX) багтаана — уншихад илүү амар
    const k = 0.86;
    d.style.width = b.bw / k + "px";
    let fs2 = search(H0);
    if (fs2 < b.h * 0.75) fs2 = Math.max(fs2, search(b.maxH));
    if (fs2 > (fs || minFs) * 1.08) {
      fs = fs2;
      d.style.transform = `scaleX(${k})`;
      d.style.transformOrigin = "0 0";
    } else d.style.width = b.bw + "px";
  }
  d.style.fontSize = (fs || minFs) + "px";
}

// ---------------------------------------------------------------- орчуулга
function drawTr(pg) {
  const head = `<div class="pn"><span>${pg.num}-р хуудас</span></div>`;
  if (pg.ocr) {
    pg.trEl.innerHTML = head + pg.ocr;
    return;
  }
  if (!pg.units) { pg.trEl.innerHTML = head + '<div class="hint">…</div>'; return; }
  if (!pg.units.length) {
    pg.trEl.innerHTML = head + '<div class="hint">Энэ хуудас зураг (скан) байна.</div>' +
      '<button class="ocr">📷 Зургаас орчуулах</button>';
    pg.trEl.querySelector(".ocr").onclick = () => ocrPage(pg);
    return;
  }
  pg.trEl.innerHTML = head + pg.units.map((t, i) => {
    if (pg.keep && !pg.keep[i]) return "";
    const mn = pg.mns ? pg.mns[i] : "…";
    return `<p title="${esc(t)}">${esc(mn)}${pg.better ? ' <span class="q">✨</span>' : ""}</p>`;
  }).join("");
}

async function translatePage(pg, quality = false) {
  if (!pg.units) return;
  if (pg.translated && !quality) { drawTr(pg); drawMirror(pg); return; }
  if (!quality && pg.better) { drawTr(pg); drawMirror(pg); return; }
  if (!pg.units.length) { drawTr(pg); return; }
  pg.translated = true;
  drawTr(pg);
  const out = [];
  let gotAi = false;
  const N = quality ? 25 : 50;
  for (let i = 0; i < pg.units.length; i += N) {
    const prev = pages[pg.num - 2] && pages[pg.num - 2].units;
    const ctx = "Document: " + document.title.replace(/ — Хэлмэрч$/, "") +
      (pg.blocks && pg.blocks.length ? " | Text blocks from one page (table cells, headings, list items) — translate each separately, keep them short" : "") +
      (i > 0 ? " | Previous: " + pg.units[i - 1] : prev && prev.length ? " | Previous: " + prev[prev.length - 1] : "");
    const msg = { type: "translate", kind: "text", quality, texts: pg.units.slice(i, i + N), context: ctx };
    const r = quality ? await send(msg) : await fastSend(msg);
    if (r.ai) gotAi = true;
    if ((r.error || !r.results) && quality && pg.mns) {
      // хурдан орчуулга аль хэдийн харагдаж байгаа — чимээгүй үлдээгээд дараа нэг удаа дахин оролдоно
      if (!pg.qRetry) { pg.qRetry = true; setTimeout(() => queueQuality(pg), 30000); }
      return;
    }
    if (r.error || !r.results) {
      // алдааг хэрэглэгчид харуулахгүй — "орчуулж байна" хэвээр, ар талд нь дахин оролдоно
      pg.trEl.innerHTML = `<div class="pn"><span>${pg.num}-р хуудас</span></div><div class="hint">Орчуулж байна…</div>`;
      pg.mirEl.dataset.msg = "Орчуулж байна…";
      pg.translated = false;
      pg.retries = (pg.retries || 0) + 1;
      // харагдаж буй хуудсыг үргэлжлүүлэн (эхэндээ хурдан, дараа нь аажмаар) дахин оролдоно; бусдыг харагдах үед нь
      setTimeout(() => {
        if (pg.mns || pg.translated) return;
        if (nearView(pg)) translatePage(pg, quality); else pg.needFast = true;
      }, Math.min(30000, 2000 * 2 ** (pg.retries - 1)));
      return;
    }
    out.push(...r.results.map((x) => x.mn || ""));
  }
  pg.mns = out;
  pg.better = quality || gotAi;   // AI-аар орчуулагдсан бол дахин AI-аар орчуулах хэрэггүй
  pg.retries = 0;
  delete pg.mirEl.dataset.msg;
  drawTr(pg);
  drawMirror(pg);
  // эхлээд хурдан орчуулга харуулаад, дараа нь мэргэжлийн (AI) орчуулгаар солино
  if (!quality && useQuality) queueQuality(pg);
}

// хурдан орчуулгыг нэг дор 2-оос олныг илгээхгүй (Google-ийг хаалгахгүй, Chrome-ийн холболтыг дүүргэхгүй)
let fastActive = 0;
const fastWait = [];
async function fastSend(msg) {
  while (fastActive >= 2) await new Promise((res) => fastWait.push(res));
  fastActive++;
  try { return await send(msg); }
  finally { fastActive--; const n = fastWait.shift(); if (n) n(); }
}

// AI орчуулгыг нэг нэгээр нь (харагдаж буй хуудсуудад) хийнэ — хурдан орчуулгыг хэзээ ч хүлээлгэхгүй
let qChain = Promise.resolve();
function nearView(pg) {
  const r = pg.row.getBoundingClientRect();
  return r.bottom > -innerHeight && r.top < 2 * innerHeight;
}
function queueQuality(pg) {
  if (pg.qQueued || pg.better) return;
  pg.qQueued = true;
  qChain = qChain.then(async () => {
    pg.qQueued = false;
    if (pg.better || !showTr()) return;
    if (!nearView(pg)) { pg.needQ = true; return; }
    pg.needQ = false;
    await translatePage(pg, true);
  }).catch(() => {});
}

async function ocrPage(pg) {
  if (!pg.canvas) return;
  pg.trEl.innerHTML = `<div class="pn"><span>${pg.num}-р хуудас</span></div><div class="hint">Зургаас уншиж орчуулж байна… (10–30 сек)</div>`;
  // хэт том зургийг жижигрүүлнэ
  const maxW = 1600, c = pg.canvas;
  let img = c;
  if (c.width > maxW) {
    img = document.createElement("canvas");
    img.width = maxW; img.height = Math.round(c.height * maxW / c.width);
    img.getContext("2d").drawImage(c, 0, 0, img.width, img.height);
  }
  const r = await send({ type: "ocr", image: img.toDataURL("image/jpeg", 0.85) });
  if (r.error) {
    // нэг удаа чимээгүй дахин оролдоно; дахиад бүтэхгүй бол алдааны текстгүйгээр зөвхөн товч үлдээнэ
    if (!pg.ocrRetried) { pg.ocrRetried = true; setTimeout(() => ocrPage(pg), 3000); return; }
    pg.ocr = `<button class="ocr">Зургаас дахин унших</button>`;
  }
  else pg.ocr = (r.mongolian || "Текст олдсонгүй").split(/\n{2,}/).map((t) => `<p>${esc(t)}</p>`).join("");
  drawTr(pg);
  const b = pg.trEl.querySelector(".ocr");
  if (b) b.onclick = () => { pg.ocr = null; ocrPage(pg); };
}

// ---------------------------------------------------------------- баримт ачаалах
async function build() {
  const doc = $("doc");
  doc.innerHTML = "";
  pages.length = 0;
  const first = await pdf.getPage(1);
  if (!scale) {
    // анх нээхэд: хоёр хуудас дэлгэцэнд зэрэгцэж багтах хэмжээ
    const w1 = first.getViewport({ scale: 1 }).width;
    scale = Math.min(1.5, Math.max(0.6, Math.floor((innerWidth - 70) / (2 * w1) * 20) / 20));
  }
  const vp1 = first.getViewport({ scale });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const pg = e.target.__pg;
      renderPage(pg);
      if (pg.needQ) queueQuality(pg);
      if (pg.needFast) { pg.needFast = false; translatePage(pg); }
    }
  }, { rootMargin: "1200px 0px" });
  for (let n = 1; n <= pdf.numPages; n++) {
    const row = document.createElement("div"); row.className = "row";
    const pageEl = document.createElement("div"); pageEl.className = "page orig";
    const mirEl = document.createElement("div"); mirEl.className = "page mir wait";
    for (const el of [pageEl, mirEl]) { el.style.width = vp1.width + "px"; el.style.height = vp1.height + "px"; }
    const trEl = document.createElement("div"); trEl.className = "tr";
    trEl.style.maxHeight = `min(calc(100vh - 72px), ${Math.round(vp1.height)}px)`;
    row.append(pageEl, mirEl, trEl);
    doc.appendChild(row);
    const pg = { num: n, row, pageEl, mirEl, trEl, rendered: false, translated: false };
    trEl.innerHTML = `<div class="pn"><span>${n}-р хуудас</span></div>`;
    row.__pg = pg;
    pages.push(pg);
    io.observe(row);
  }
  $("zoom").textContent = Math.round(scale * 100) + "%";
}

function loadLocal(url) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("GET", url);
    x.responseType = "arraybuffer";
    x.onload = () => (x.response && (x.status === 0 || x.status === 200))
      ? res(new Uint8Array(x.response)) : rej(new Error("файлыг уншиж чадсангүй"));
    x.onerror = () => rej(new Error("файлыг уншиж чадсангүй"));
    x.send();
  });
}

async function main() {
  applyMode();
  if (!file) { setMsg("PDF файлын хаяг олдсонгүй."); return; }
  const name = decodeURIComponent(file.split(/[?#]/)[0].split("/").pop() || "PDF");
  $("name").textContent = name;
  document.title = name + " — Хэлмэрч";
  $("download").href = file;
  $("download").setAttribute("download", name);
  setMsg("PDF ачаалж байна…");
  try {
    let src = { url: file };
    if (file.startsWith("file:")) src = { data: await loadLocal(file) };
    pdf = await pdfjsLib.getDocument({
      ...src,
      cMapUrl: chrome.runtime.getURL("pdfjs/cmaps/"), cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("pdfjs/standard_fonts/"),
      wasmUrl: chrome.runtime.getURL("pdfjs/wasm/"),
    }).promise;
  } catch (e) {
    let hint = "";
    if (file.startsWith("file:")) hint = " Компьютер дээрх PDF-д: chrome://extensions → Хэлмэрч → Details → “Allow access to file URLs”-ийг асаана уу.";
    setMsg("PDF нээж чадсангүй: " + (e.message || e) + "." + hint);
    return;
  }
  setMsg("");
  $("pages").textContent = pdf.numPages + " хуудас";
  await build();
}

// ---------------------------------------------------------------- товчнууд
function applyMode() {
  for (const m of MODES) document.body.classList.toggle("m-" + m, m === mode);
  $("mode").value = mode;
  pages.forEach((p) => p.row.classList.remove("orig"));
  if (showTr()) pages.filter((p) => p.rendered).forEach((p) => {
    translatePage(p);
    if (p.mirDirty) drawMirror(p);
  });
}
$("mode").onchange = () => {
  mode = $("mode").value;
  try { localStorage.setItem("mn_pdf_mode", mode); } catch (e) {}
  applyMode();
};
function zoom(f) {
  scale = Math.min(3, Math.max(0.4, Math.round(scale * f * 100) / 100));
  try { localStorage.setItem("mn_pdf_zoom", String(scale)); } catch (e) {}
  const keep = pages.map((p) => ({ units: p.units, mns: p.mns, better: p.better, ocr: p.ocr }));
  build().then(() => pages.forEach((p, i) => { p.prev = keep[i]; p.ocr = keep[i].ocr; }));
}
$("zin").onclick = () => zoom(1.15);
$("zout").onclick = () => zoom(1 / 1.15);
$("original").onclick = () => send({ type: "openOriginal", url: file });
$("better").onclick = async () => {
  const visible = pages.filter((p) => {
    const r = p.row.getBoundingClientRect();
    return p.rendered && r.bottom > 0 && r.top < innerHeight;
  });
  for (const p of visible) await translatePage(p, true);
};

main();
