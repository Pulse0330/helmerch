// Хэлмэрч — үг дээр очиход / текст сонгоход монгол орчуулга харуулна.
// Мөн хажуу самбарт хуудасны текстийг өгнө.
(() => {
  if (window.__mnTr) return;
  window.__mnTr = true;

  let S = { hover: true, hover_mode: "ctrl", select: true, quality: true };

  function send(msg) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError;
          res(r || { error: "Өргөтгөл холбогдсонгүй — хуудсыг refresh хийнэ үү" });
        });
      } catch (e) {
        res({ error: "Өргөтгөл шинэчлэгдсэн — хуудсыг refresh хийнэ үү" });
      }
    });
  }

  send({ type: "getSettings" }).then((r) => { if (r && !r.error) S = { ...S, ...r }; });
  try {
    chrome.storage.local.get("settings").then((o) => { if (o.settings) S = { ...S, ...o.settings }; });
    chrome.storage.onChanged.addListener((c) => { if (c.settings && c.settings.newValue) S = { ...S, ...c.settings.newValue }; });
  } catch (e) {}

  // ---------------------------------------------------------------- PDF → орчуулагч үзүүлэгч
  const IS_PDF = window === window.top && document.contentType === "application/pdf" &&
                 location.protocol !== "chrome-extension:";
  if (IS_PDF) {
    send({ type: "getSettings" }).then((r) => {
      if (!r || r.pdf !== false) send({ type: "openPdf", url: location.href });
    });
  }

  // ---------------------------------------------------------------- tooltip (shadow DOM)
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    .tip{position:fixed;max-width:440px;min-width:120px;background:#1f2430;color:#f2f4f8;
      font:14px/1.5 'Segoe UI',Arial,sans-serif;padding:9px 12px;border-radius:9px;
      box-shadow:0 8px 28px rgba(0,0,0,.35);display:none;white-space:pre-wrap;word-wrap:break-word;}
    .src{color:#98a2b6;font-size:12px;margin-bottom:4px;max-height:4.6em;overflow:hidden}
    .w{font-weight:700;color:#fff}
    .mn{font-size:15px}
    .alts{margin-top:6px;color:#c9d1e0;font-size:12.5px;line-height:1.55}
    .pos{color:#7fb3ff;margin-right:5px}
    .bar{margin-top:7px;display:flex;gap:12px;font-size:12px}
    .bar span{cursor:pointer;color:#8fbcff}
    .bar span:hover{text-decoration:underline}
    .muted{color:#98a2b6}
    .err{color:#ff9d9d}
  </style><div class="tip" id="tip"></div>`;
  const tip = root.getElementById("tip");
  let tipKind = null;

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function mount() {
    const p = document.fullscreenElement && document.fullscreenElement.tagName !== "VIDEO"
      ? document.fullscreenElement : document.documentElement;
    if (host.parentNode !== p) p.appendChild(host);
  }

  function show(rect, html, kind) {
    mount();
    tipKind = kind;
    tip.innerHTML = html;
    tip.style.display = "block";
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
    let top = rect.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function hide() {
    tip.style.display = "none";
    tipKind = null;
    lastWord = "";
  }

  function altsHtml(alts) {
    if (!alts || !alts.length) return "";
    return '<div class="alts">' + alts.slice(0, 4).map((a) =>
      `<div><span class="pos">${esc(a.pos)}</span>${esc(a.terms.join(", "))}</div>`).join("") + "</div>";
  }

  // ---------------------------------------------------------------- үг дээр очиход
  let hoverTimer = null, lastWord = "", lastXY = null, hoverSeq = 0;
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

  function wordAt(x, y) {
    let node, off;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode; off = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; off = r.startOffset;
    }
    if (!node || node.nodeType !== 3 || !segmenter) return null;
    const text = node.data;
    for (const s of segmenter.segment(text)) {
      if (off < s.index || off > s.index + s.segment.length) continue;
      if (!s.isWordLike || /^\d+$/.test(s.segment)) continue;
      const range = document.createRange();
      range.setStart(node, s.index);
      range.setEnd(node, s.index + s.segment.length);
      const ok = [...range.getClientRects()].some((r) =>
        x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
      if (!ok) continue;
      return { word: s.segment, rect: range.getBoundingClientRect() };
    }
    return null;
  }

  async function hoverAt(x, y) {
    const hit = wordAt(x, y);
    if (!hit) { if (tipKind === "hover") hide(); return; }
    if (hit.word === lastWord && tipKind === "hover") return;
    lastWord = hit.word;
    const seq = ++hoverSeq;
    show(hit.rect, `<span class="w">${esc(hit.word)}</span> <span class="muted">…</span>`, "hover");
    // Ctrl дарж санаатайгаар хайсан үгийг «Миний үгс»-д хадгална ("Шууд" горимд санамсаргүй хулгана өнгөрөх тул үгүй)
    const r = await send({ type: "translate", kind: "word", texts: [hit.word], remember: S.hover_mode !== "always" });
    if (seq !== hoverSeq || tipKind !== "hover") return;
    if (r.error || !r.results || !(r.results[0] || {}).mn) {
      hide();          // алдааг хэрэглэгчид харуулахгүй (дахин оролдлогыг background аль хэдийн хийсэн)
      return;
    }
    const res = r.results[0] || {};
    show(hit.rect, `<div class="mn"><span class="w">${esc(hit.word)}</span> — ${esc(res.mn || "")}</div>` +
      altsHtml(res.alts), "hover");
  }

  function scheduleHover(x, y, delay) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => hoverAt(x, y), delay);
  }

  document.addEventListener("mousemove", (e) => {
    lastXY = { x: e.clientX, y: e.clientY };
    if (!S.hover || tipKind === "select") return;
    if (e.composedPath().includes(host)) return;
    const always = S.hover_mode === "always";
    if (!always && !e.ctrlKey) {
      if (tipKind === "hover") { clearTimeout(hoverTimer); hide(); }
      return;
    }
    scheduleHover(e.clientX, e.clientY, always ? 450 : 120);
  }, { passive: true, capture: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
    if (e.key === "Control" && S.hover && S.hover_mode !== "always" && lastXY && tipKind !== "select")
      scheduleHover(lastXY.x, lastXY.y, 60);
  }, true);

  // ---------------------------------------------------------------- текст сонгоход
  function isEditable(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  async function translateSelection(text, rect) {
    const single = !/\s/.test(text) && text.length < 40;
    const seq = ++hoverSeq;
    show(rect, `<div class="src">${esc(text.slice(0, 300))}</div><div class="muted">Орчуулж байна…</div>`, "select");
    const r = await send({ type: "translate", kind: single ? "word" : "text", texts: [text], quality: !single && S.quality,
                           remember: single });
    if (seq !== hoverSeq || tipKind !== "select") return;
    if (r.error || !r.results || !(r.results[0] || {}).mn) {
      hide();          // алдааг хэрэглэгчид харуулахгүй
      return;
    }
    const res = r.results[0] || {};
    show(rect,
      `<div class="src">${esc(text.slice(0, 300))}${text.length > 300 ? "…" : ""}</div>` +
      `<div class="mn">${esc(res.mn || "")}</div>` + altsHtml(res.alts) +
      `<div class="bar"><span id="copy">Хуулах</span><span id="close">Хаах</span></div>`, "select");
    const copy = root.getElementById("copy");
    if (copy) copy.onclick = () => { navigator.clipboard.writeText(res.mn || ""); copy.textContent = "Хууллаа ✓"; };
    const close = root.getElementById("close");
    if (close) close.onclick = hide;
  }

  document.addEventListener("mousedown", (e) => {
    if (e.composedPath().includes(host)) return;
    if (tipKind === "select") hide();
  }, true);

  document.addEventListener("mouseup", (e) => {
    if (!S.select || e.button !== 0 || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2 || text.length > 4000 || !/\p{L}/u.test(text)) return;
      if (isEditable(document.activeElement)) return;
      const rects = [...sel.getRangeAt(0).getClientRects()];
      const last = rects[rects.length - 1] || sel.getRangeAt(0).getBoundingClientRect();
      translateSelection(text, last);
    }, 10);
  }, true);

  // баруун товчны цэс: "Хэлмэрч: сонгосон текстийг орчуулах"
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "ctxSel") return;
    const sel = getSelection();
    const text = (msg.text || (sel ? sel.toString() : "")).replace(/\s+/g, " ").trim();
    if (!text) return;
    let rect = { left: innerWidth / 2 - 150, right: innerWidth / 2 + 150, top: 80, bottom: 100, width: 300, height: 20 };
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const rects = [...sel.getRangeAt(0).getClientRects()];
      rect = rects[rects.length - 1] || sel.getRangeAt(0).getBoundingClientRect();
    }
    translateSelection(text.slice(0, 4000), rect);
  });

  // ---------------------------------------------------------------- хажуу самбарт хуудасны текст өгөх
  if (window !== window.top) return;
  const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th,dd,dt,pre,summary,caption";
  let nextId = 1;

  function extractBlocks() {
    const out = [];
    for (const el of document.querySelectorAll(BLOCKS)) {
      if (el.closest("script,style,noscript,[aria-hidden='true'],[hidden]")) continue;
      if (el.querySelector(BLOCKS)) continue; // дотроо өөр блок агуулсан бол доторхыг нь авна
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length < 2 || !/\p{L}/u.test(t)) continue;
      let id = el.getAttribute("data-mnid");
      if (!id) { id = "b" + nextId++; el.setAttribute("data-mnid", id); }
      out.push({ id, text: t.slice(0, 3000), tag: el.tagName.toLowerCase() });
      if (out.length >= 600) break;
    }
    if (IS_PDF) return { title: document.title, isPdf: true, blocks: [] };
    if (out.length < 3) { // div дотор бичсэн хуудсууд
      const lines = (document.body.innerText || "").split(/\n+/).map((s) => s.trim())
        .filter((s) => s.length > 1 && /\p{L}/u.test(s));
      return { title: document.title, blocks: lines.slice(0, 600).map((t) => ({ id: "", text: t.slice(0, 3000), tag: "p" })) };
    }
    return { title: document.title, blocks: out };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "extract") {
      sendResponse(extractBlocks());
    } else if (msg.type === "scrollTo") {
      const el = msg.id && document.querySelector(`[data-mnid="${msg.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const old = el.style.backgroundColor;
        el.style.transition = "background-color .4s";
        el.style.backgroundColor = "rgba(255,220,80,.45)";
        setTimeout(() => { el.style.backgroundColor = old; }, 1400);
      }
      sendResponse({ ok: !!el });
    }
  });
})();
