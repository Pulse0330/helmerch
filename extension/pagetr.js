// Хэлмэрч — вэб хуудсыг өөр дээр нь орчуулах: "Эх" / "2 хэл" / "Монгол"
// Горим нь chrome.storage.local.pageMode-д хадгалагдана (бүх хуудсанд нэг). Анхдагч "off" = эх хуудас огт өөрчлөгдөхгүй.
(() => {
  if (window.__hmPageTr) return;
  window.__hmPageTr = true;
  if (location.protocol === "chrome-extension:" || /\.pdf(\?|#|$)/i.test(location.pathname)) return;
  // Шигтгэсэн цонх (iframe) — шалгалт/сургалтын олон сайт (LMS, SCORM) агуулгаа iframe-д харуулдаг.
  // Тэнд ч орчуулна, гэхдээ булангийн товч зөвхөн үндсэн хуудсанд. Сурталчилгаа мэт жижиг цонхыг алгасна.
  const IN_FRAME = window !== window.top;
  if (IN_FRAME && (innerWidth < 300 || innerHeight < 150)) return;

  const SKIP = "script,style,noscript,template,code,pre,kbd,samp,textarea,input,select,button,svg,math,canvas,video,audio,iframe," +
               "[contenteditable=''],[contenteditable='true'],[translate='no'],.notranslate,hm-tr,hm-pill," +
               "#movie_player,.html5-video-player,ytd-player,[role=application],[role=slider],[role=progressbar],[role=textbox]";
  const BLOCK_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "TH", "DD", "DT", "BLOCKQUOTE",
    "FIGCAPTION", "CAPTION", "SUMMARY", "LABEL", "LEGEND", "DIV", "SECTION", "ARTICLE", "SPAN", "A"]);
  const send = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || { error: "x" }); }); }
    catch (e) { res({ error: String(e) }); }
  });

  let mode = "off", want = "off", quality = true, started = false, hidden = false, siteOff = false;
  let uiTr = true;   // "2 хэл" горимд цэс, товчийг ч жижиг үсгээр орчуулах (анхдагчаар асаалттай)
  let exam = false;  // шалгалтын горим: хариултын сонголт (товч хэлбэртэй ч), богино сонголтыг бүрэн орчуулна
  const EXAM_ZONE = "label,fieldset,form,li,[role=radiogroup],[role=radio],[role=option],[role=listbox],[role=checkbox]";
  // товч хэлбэртэй хариултын сонголт: 4+ үгтэй (Next/Submit зэрэг богино товчийг хөндөхгүй)
  const answerButton = (n) => exam && n.tagName === "BUTTON" &&
    ((n.innerText || "").trim().split(/\s+/).length >= 4) && !n.querySelector("button,input,select,textarea");
  // «энэ сайтыг бүү орчуул» нь үндсэн сайтын нэрээр (iframe өөр домэйнээс ачаалагдсан ч)
  const topHost = () => {
    try { if (IN_FRAME && location.ancestorOrigins && location.ancestorOrigins.length)
      return new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname; } catch (e) {}
    return location.hostname;
  };
  const HOST = topHost().replace(/^www\./, "");
  // цэс, толгой/хөлийн хэсэг, товч — "2 хэл" горимд эх хэлээр нь үлдээнэ (зөвхөн үндсэн агуулга)
  const CHROME_SEL = "nav,aside,[role=navigation],[role=banner],[role=contentinfo],[role=menu],[role=menubar]," +
                     "[role=toolbar],[role=tablist],[role=search],[role=dialog][aria-modal=true]";
  const items = new Map();     // element → {text, mn, better, node}
  const queue = new Set();     // орчуулах дараалал (харагдаж буй)
  let io = null, mo = null, active = 0, timer = 0;
  let resync = null;           // "Эх" горимоос буцаж асаахад хуудсыг дахин тулгах (start() дотор тодорхойлогдоно)

  // ---------------------------------------------------------------- хэв маяг
  const css = document.createElement("style");
  // Орчуулгыг хуудасны DOM-д ШИНЭ ЭЛЕМЕНТ НЭМЭЛГҮЙ, ::after-аар (data-hm-tr атрибутаас) харуулна.
  // Ингэснээр YouTube, React/Vue зэрэг вэб апп-уудын бүтэц эвдрэхгүй (сонголт, товч хэвээр ажиллана).
  const T = "[data-hm-has]::after";
  // "Монгол" горимд орчуулсан блок доторх дарагддаг элементийг (сайтын өөрийн товч) нуухгүй
  const KEEP = "[role=button],[role=radio],[role=checkbox],[role=switch],[onclick]";
  css.textContent = `
    ${T}{content:attr(data-hm-tr);display:block!important;pointer-events:none!important;margin:.25em 0 .5em!important;padding:.15em 0 .15em .6em!important;
      border-left:3px solid rgba(66,133,244,.75)!important;color:inherit!important;opacity:.82;
      font-family:"Segoe UI",system-ui,sans-serif!important;font-size:min(.92em,1.15rem)!important;line-height:1.45!important;
      font-weight:inherit;font-style:normal;letter-spacing:normal!important;text-transform:none!important;text-align:inherit!important;
      white-space:normal!important;text-decoration:none!important;position:static!important;width:auto!important;height:auto!important;
      background:none;transform:none!important;float:none!important;clear:both;box-sizing:border-box}
    [data-hm-end]::after{border-left:0!important;border-right:3px solid rgba(66,133,244,.75)!important;padding:.15em .6em .15em 0!important}
    [data-hm-center]::after{border-left:0!important;padding-left:0!important}
    /* ачааллаж байх үеийн анивчих зураас ("2 хэл") */
    html[data-hm-mode="bi"] [data-hm-has][data-hm-wait]::after{content:"\\00a0";opacity:1;min-height:.9em;max-width:min(70%,420px);
      border-radius:0 6px 6px 0;background:linear-gradient(90deg,rgba(127,140,160,.14) 25%,rgba(127,140,160,.30) 37%,rgba(127,140,160,.14) 63%)!important;
      background-size:400% 100%!important;animation:hm-sh 1.3s ease infinite}
    @keyframes hm-sh{0%{background-position:100% 50%}100%{background-position:0 50%}}
    /* харагдах хэлбэрүүд */
    html[data-hm-style="bg"][data-hm-mode="bi"] [data-hm-has]:not([data-hm-wait])::after{border-left:0!important;border-right:0!important;
      background:rgba(66,133,244,.10)!important;border-radius:6px;padding:.2em .55em!important;opacity:.95}
    html[data-hm-style="learn"][data-hm-mode="bi"] [data-hm-has]:not([data-hm-wait]):not([data-hm-ui])::after{filter:blur(5px);transition:filter .2s}
    html[data-hm-style="learn"][data-hm-mode="bi"] [data-hm-has]:hover::after{filter:none}
    html[data-hm-mode="bi"]:not([data-hm-ui-on]) [data-hm-ui]::after{content:none!important;display:none!important}
    html:not([data-hm-mode="off"]) [data-hm-inline][data-hm-has]{display:inline-block!important;vertical-align:top}
    html[data-hm-mode="bi"][data-hm-ui-on] [data-hm-ui]:not([data-hm-wait])::after{font-size:.74em!important;line-height:1.25!important;
      border:0!important;padding:0!important;margin:.15em 0 0!important;opacity:.78;background:none!important;filter:none!important;font-weight:400}
    html[data-hm-mode="bi"][data-hm-ui-on] [data-hm-ui][data-hm-wait]::after{min-height:.7em;max-width:5em;margin:.15em 0 0!important;border:0!important}
    html:not([data-hm-mode="off"]) [data-hm-flex][data-hm-has]{flex-wrap:wrap!important}
    [data-hm-flex]::after{flex-basis:100%!important;width:100%!important}
    [data-hm-grid]::after{grid-column:1 / -1!important}
    html[data-hm-mode="off"] ${T}{content:none!important;display:none!important}
    /* "Монгол" горим: эх текстийг нууж (хэмжээ, зай хэвээр), орчуулгыг оронд нь. Оролтын талбар, товч, зураг харагдсаар */
    html[data-hm-mode="mo"] [data-hm-has]:not([data-hm-wait]){font-size:0!important;margin-top:var(--hm-mt)!important;margin-bottom:var(--hm-mb)!important;
      padding-top:var(--hm-pt)!important;padding-bottom:var(--hm-pb)!important}
    html[data-hm-mode="mo"] [data-hm-has]:not([data-hm-wait]) > :not(input,select,textarea,button,img,svg,picture,video,canvas,iframe,${KEEP}){display:none!important}
    html[data-hm-mode="mo"] [data-hm-has]:not([data-hm-wait]) > :is(input,select,textarea,button,${KEEP}){font-size:var(--hm-fs)!important}
    html[data-hm-mode="mo"] [data-hm-has]::marker{font-size:var(--hm-fs)}
    html[data-hm-mode="mo"] [data-hm-has]:not([data-hm-wait])::after{display:inline!important;border:0!important;padding:0!important;margin:0!important;
      color:inherit!important;opacity:1;font-size:var(--hm-fs)!important;line-height:var(--hm-lh)!important;font-family:inherit!important}
    html[data-hm-mode="mo"] [data-hm-has][data-hm-wait]::after{content:none!important;display:none!important}
    html[data-hm-mode="mo"] [data-hm-has]:not([data-hm-wait]):hover{outline:1px dashed rgba(66,133,244,.45);outline-offset:2px;cursor:help}`;

  // ---------------------------------------------------------------- орчуулах блокуудыг олох
  // энгийн текстэн холбоосоор хийсэн цэс: <div><a>Plans</a><a>Blog</a></div> — холбоос бүрийг тусад нь орчуулна
  function isMenuContainer(c) {
    if (!c || c === document.body) return false;
    const links = c.querySelectorAll(":scope > a, :scope > li > a, :scope > span > a, :scope > div > a");
    if (links.length < 2) return false;
    const total = (c.textContent || "").replace(/\s+/g, "").length;
    let inLinks = 0;
    for (const a of links) inLinks += (a.textContent || "").replace(/\s+/g, "").length;
    return total > 0 && inLinks / total >= 0.8;
  }
  function isMenuLink(el) {
    if (el.tagName !== "A") return false;
    const p = el.parentElement;
    return isMenuContainer(p) || (p && p.tagName === "LI" && isMenuContainer(p.parentElement)) ||
           (p && /^(SPAN|DIV)$/.test(p.tagName) && isMenuContainer(p.parentElement));
  }

  function isLeafBlock(el) {
    if (el.tagName === "BUTTON") return answerButton(el);
    if (isMenuLink(el)) return !el.querySelector("div,p,ul,ol,h1,h2,h3,h4,h5,h6");
    if (!BLOCK_TAGS.has(el.tagName)) return false;
    if (isMenuContainer(el)) return false;
    const disp = getComputedStyle(el).display;
    if (el.tagName === "SPAN" || el.tagName === "A") { if (!/block|list-item|flex|grid|table-cell/.test(disp)) return false; }
    else if (disp === "none" || disp === "contents") return false;
    // дотор нь өөр текстэн блок байвал доторхыг нь авна
    for (const c of el.children) {
      if (c.matches(SKIP)) continue;
      const d = getComputedStyle(c).display;
      if (/^(block|list-item|flex|grid|table)$/.test(d) && /\p{L}{2,}/u.test(c.textContent || "")) return false;
    }
    return true;
  }

  function isChrome(el, text) {
    if (isMenuLink(el)) return true;
    const words = text.split(/\s+/).length;
    const c = el.closest(CHROME_SEL);
    // цонх (modal) доторх урт текст — шалгалтын асуулт, хариултын тайлбар — жинхэнэ агуулга, цэс биш
    if (c && !(c.matches("[role=dialog]") && words > 6)) return true;
    const hf = el.closest("header,footer");
    if (hf && !hf.closest("article,main,[role=main]")) return true;
    // шалгалтын горим: хариултын сонголт, товч хэлбэртэй хариулт — богино ч гэсэн жинхэнэ агуулга
    if (exam && (answerButton(el) || el.closest(EXAM_ZONE))) return false;
    // богино товч, холбоос (3 хүртэл үг)
    if (words <= 3 && el.closest("a,button,[role=button],[role=tab],[role=menuitem]")) return true;
    return false;
  }

  function wanted(text) {
    if (text.length < 2 || text.length > 4000 || !/\p{L}{2,}/u.test(text)) return false;
    const cyr = (text.match(/[Ѐ-ӿ]/g) || []).length;
    const lat = (text.match(/[A-Za-zÀ-ɏ]/g) || []).length;
    if (cyr > lat) return false;                       // аль хэдийн кирилл (монгол/орос) — орчуулахгүй
    if (/^[\d\s.,:;%$€£¥+\-–—/()#@&*!?'"|]+$/.test(text)) return false;
    return true;
  }

  function scan(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if ((n.matches(SKIP) && !answerButton(n)) || n.hidden || n.getAttribute("aria-hidden") === "true") return NodeFilter.FILTER_REJECT;
        if (n.hasAttribute("data-hm-done")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const found = [];
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (el === root && root === document.body) continue;
      if (items.has(el) || !isLeafBlock(el)) continue;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!wanted(text)) continue;
      if (el.parentElement && el.parentElement.closest("[data-hm-done]")) continue;
      found.push([el, text]);
      if (found.length > 1500) break;
    }
    // давхардал арилгах: нэг текст гадна, дотор хоёр элементэд сонгогдвол хамгийн доторхыг нь л авна
    const picked = new Set(found.map((f) => f[0])), outer = new Set();
    for (const [el] of found) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (picked.has(a)) outer.add(a);
    }
    for (const [el, text] of found) {
      if (outer.has(el)) continue;
      el.setAttribute("data-hm-done", "");
      const ui = isChrome(el, text) || ownAfter(el);
      if (ui) el.setAttribute("data-hm-ui", "");
      items.set(el, { text, mn: null, better: false, node: null, ui });
      enqueue(el);
    }
    if (queue.size) pump();
  }

  // Дэлгэц дээр (эсвэл ойрхон) харагдаж буй бол шууд дараалалд — жишээ нь хариулт өгөхөд гарч ирсэн тайлбар
  // хүлээлгүй орчуулагдана. Бусдыг харагдах үед нь (IntersectionObserver).
  function enqueue(el) {
    const r = el.getBoundingClientRect();
    if ((r.width || r.height) && r.bottom > -600 && r.top < innerHeight + 600) queue.add(el);
    else { io.unobserve(el); io.observe(el); }
  }

  // ---------------------------------------------------------------- орчуулга (харагдаж буй хэсгийг л)
  function attach(el, it, mn, wait) {
    if (!it.prepared) {
      it.prepared = true;
      // Анхаар: data-hm-has тавихаас ӨМНӨ хэмжинэ ("Монгол" горимд font-size 0 болно)
      const cs = getComputedStyle(el);
      if (/flex/.test(cs.display) && !/column/.test(cs.flexDirection)) el.setAttribute("data-hm-flex", "");
      if (/grid/.test(cs.display)) el.setAttribute("data-hm-grid", "");
      if (cs.display === "inline") el.setAttribute("data-hm-inline", "");   // мөрөн доторх холбоос → inline-block
      el.style.setProperty("--hm-fs", cs.fontSize);
      el.style.setProperty("--hm-lh", cs.lineHeight === "normal" ? "1.5" : cs.lineHeight);
      el.style.setProperty("--hm-mt", cs.marginTop);
      el.style.setProperty("--hm-mb", cs.marginBottom);
      el.style.setProperty("--hm-pt", cs.paddingTop);
      el.style.setProperty("--hm-pb", cs.paddingBottom);
      // баруун/голд тэгшилсэн текстэд орчуулга ч мөн адил (зураас нь тохирох талдаа)
      const ta = cs.textAlign, rtl = cs.direction === "rtl";
      if (ta === "right" || (ta === "end" && !rtl)) el.setAttribute("data-hm-end", "");
      else if (ta === "center") el.setAttribute("data-hm-center", "");
    }
    el.setAttribute("data-hm-tr", wait ? "" : cleanMn(mn, it.text));
    el.toggleAttribute("data-hm-wait", !!wait);
    el.setAttribute("data-hm-has", "");
    it.node = el;
  }

  // элемент өөрөө ::after ашигладаг бол (дүрс, сум гэх мэт) дээр нь бичихгүй — хулгана аваачихад л
  function ownAfter(el) {
    const c = getComputedStyle(el, "::after").content;
    return c && c !== "none" && c !== "normal";
  }

  // AI заримдаа эх бичвэрийг бүтнээр нь хаалтанд давтдаг — "Апп татах (Get the app)" → "Апп татах"
  function cleanMn(mn, src) {
    const s = src.trim().replace(/[.!?:]+$/, "");
    if (s.length > 2) {
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      mn = mn.replace(new RegExp("\\s*\\(\\s*" + esc + "[.!?:]*\\s*\\)", "i"), "");
    }
    return mn.trim();
  }

  function pump() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (mode === "off" || active >= 2 || !queue.size) return;
      const batch = [];
      let chars = 0;
      for (const el of queue) {
        const it = items.get(el);
        queue.delete(el);
        if (!it || it.mn || !el.isConnected) continue;
        if (it.ui && mode === "bi" && !uiTr) continue;   // "Цэс, товч" унтраалттай бол орчуулахгүй (хулгана аваачихад л)
        batch.push(el);
        chars += it.text.length;
        if (batch.length >= 25 || chars > 3500) break;
      }
      if (!batch.length) return;
      active++;
      const texts = batch.map((el) => items.get(el).text);
      for (const el of batch) { const it = items.get(el); attach(el, it, mode === "mo" ? it.text : "\u00a0", true); }
      const ctx = "Web page: " + document.title.slice(0, 120);
      const r = await send({ type: "translate", kind: "text", texts, quality: false, context: ctx });
      active--;
      const failed = [];
      if (r && r.results) {
        batch.forEach((el, i) => {
          const it = items.get(el), mn = (r.results[i] || {}).mn;
          if (!it) return;
          if (!mn) { failed.push(el); return; }     // энэ хэсэг л бүтсэнгүй → дахин оролдоно
          it.mn = mn;
          it.better = !!r.ai;
          it.fails = 0;
          attach(el, it, mn, false);
        });
        if (quality && !r.ai) refine(batch.filter((el) => !failed.includes(el)),
                                     texts.filter((_, i) => !failed.includes(batch[i])), ctx);
      } else failed.push(...batch);
      for (const el of failed) retryLater(el);
      pump();
    }, 120);
  }

  // Бүтэлгүйтсэн хэсэг: алдаа харуулахгүй. Анивчих зураасыг арилгаж эх текстийг нь хэвээр үлдээгээд,
  // эхэндээ хурдан, дараа нь аажмаар (2с → 4с → … → 60с) чимээгүй дахин оролдоно.
  function retryLater(el) {
    const it = items.get(el);
    if (!it || !el.isConnected) return;
    it.fails = (it.fails || 0) + 1;
    el.removeAttribute("data-hm-wait");
    el.removeAttribute("data-hm-has");
    el.removeAttribute("data-hm-tr");
    setTimeout(() => {
      if (mode === "off" || it.mn || !el.isConnected || items.get(el) !== it) return;
      enqueue(el);
      pump();
    }, Math.min(60000, 2000 * 2 ** (it.fails - 1)));
  }

  // хурдан орчуулгыг дараа нь AI-ийн мэргэжлийн орчуулгаар солино (нэг нэгээр)
  let refineChain = Promise.resolve();
  function refine(batch, texts, ctx) {
    refineChain = refineChain.then(async () => {
      if (mode === "off") return;
      const r = await send({ type: "translate", kind: "text", texts, quality: true, context: ctx });
      if (!r || !r.results) return;
      batch.forEach((el, i) => {
        const it = items.get(el), mn = (r.results[i] || {}).mn;
        if (it && mn && el.isConnected) { it.mn = mn; it.better = true; attach(el, it, mn, false); }
      });
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- "Монгол" горимд эх текстийг харах
  let tip = null, tipTimer = 0;
  function showTip(node, label = "Эх текст", text = null) {
    const el = items.has(node) ? node : node.parentElement, it = el && items.get(el);
    if (!it && text == null) return;
    if (!tip) {
      tip = document.createElement("hm-pill");
      tip.style.cssText = "position:fixed;z-index:2147483646;max-width:440px;pointer-events:none;";
      const sh = tip.attachShadow({ mode: "closed" });
      sh.innerHTML = `<style>.t{background:#1b1f2a;color:#fff;font:13px/1.45 "Segoe UI",system-ui,sans-serif;padding:8px 11px;
        border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.3)}.h{font-size:11px;opacity:.6;margin-bottom:3px}</style>
        <div class="t"><div class="h"></div><div class="b"></div></div>`;
      tip.__b = sh.querySelector(".b");
      tip.__h = sh.querySelector(".h");
    }
    tip.__h.textContent = label;
    tip.__b.textContent = (text != null ? text : it.text).slice(0, 600);
    const r = node.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - 460)) + "px";
    tip.style.top = (r.bottom + 6 + 120 > innerHeight ? Math.max(8, r.top - 6 - 100) : r.bottom + 6) + "px";
    document.documentElement.appendChild(tip);
  }
  // "2 хэл" горимд цэс, товч дээр хулгана аваачихад монгол орчуулга нь гарна (хуудас бөөгнөрөхгүй)
  document.addEventListener("mouseover", (e) => {
    if (mode !== "bi" || uiTr || !e.target.closest) return;
    const el = e.target.closest("[data-hm-ui]");
    clearTimeout(tipTimer);
    if (!el) { if (tip && tip.isConnected && tip.__ui) { tip.remove(); tip.__ui = false; } return; }
    const it = items.get(el);
    if (!it) return;
    tipTimer = setTimeout(async () => {
      if (!it.mn) {
        const r = await send({ type: "translate", kind: "text", texts: [it.text], quality: false });
        const mn = r && r.results && r.results[0] && r.results[0].mn;
        if (!mn) return;
        it.mn = mn;
      }
      if (!el.matches(":hover")) return;
      showTip(el, "Монгол", cleanMn(it.mn, it.text));
      tip.__ui = true;
      const r = el.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(r.left, innerWidth - 460)) + "px";
      tip.style.top = (r.bottom + 6 + 80 > innerHeight ? Math.max(8, r.top - 60) : r.bottom + 6) + "px";
    }, 350);
  }, true);

  document.addEventListener("mouseover", (e) => {
    if (mode !== "mo") return;
    const n = e.target.closest && e.target.closest("[data-hm-has]:not([data-hm-wait])");
    clearTimeout(tipTimer);
    if (!n) { if (tip) tip.remove(); return; }
    tipTimer = setTimeout(() => showTip(n), 450);
  }, true);

  // ---------------------------------------------------------------- хуудасны буланд гарах товч
  let pill = null;
  function makePill() {
    const host = document.createElement("hm-pill");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
    host.setAttribute("translate", "no");
    host.addEventListener("mouseenter", () => { host.__op = host.style.opacity; host.style.opacity = "1"; });
    host.addEventListener("mouseleave", () => { if (host.__op) host.style.opacity = host.__op; });
    const sh = host.attachShadow({ mode: "closed" });
    sh.innerHTML = `<style>
      .p{display:flex;align-items:center;gap:6px;background:#fff;border-radius:999px;padding:4px 5px 4px 7px;
         box-shadow:0 6px 24px rgba(13,44,107,.25);font:13px "Segoe UI",system-ui,sans-serif;color:#1b1f2a}
      img{width:22px;height:22px;display:block}
      .s{display:inline-flex;background:#f1f3f8;border-radius:999px;padding:2px;gap:1px}
      button{border:0;background:none;font:inherit;font-size:12.5px;color:#5b6375;padding:5px 11px;border-radius:999px;cursor:pointer}
      button.on{background:#1565c0;color:#fff;font-weight:600}
      .x{padding:3px 7px;font-size:15px;color:#8a92a3}
      .m{position:absolute;right:0;bottom:46px;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(13,44,107,.25);
         padding:5px;display:flex;flex-direction:column;min-width:230px}
      .m[hidden]{display:none}
      .m button{text-align:left;color:#1b1f2a;border-radius:7px;padding:7px 10px}
      .m button:hover{background:#f1f3f8}
      @media (prefers-color-scheme: dark){.p,.m{background:#23262d;color:#eee}.s{background:#30343d}button{color:#b5bccb}
        .m button{color:#eee}.m button:hover{background:#30343d}}
    </style><div class="p" title="Хэлмэрч"><img src="${chrome.runtime.getURL("icons/32.png")}" alt="">
      <div class="s"><button data-m="off">Эх</button><button data-m="bi">2 хэл</button><button data-m="mo">Монгол</button></div>
      <button class="x" title="Хаах">×</button></div>
      <div class="m" hidden><button data-a="hide">Энэ хуудсанд товчийг нуух</button><button data-a="site">«${HOST}»-ийг хэзээ ч бүү орчуул</button></div>`;
    sh.querySelectorAll("button[data-m]").forEach((b) => b.onclick = () => chrome.storage.local.set({ pageMode: b.dataset.m }));
    const menu = sh.querySelector(".m");
    sh.querySelector(".x").onclick = () => { menu.hidden = !menu.hidden; };
    sh.querySelector('[data-a="hide"]').onclick = () => { hidden = true; host.remove(); };
    sh.querySelector('[data-a="site"]').onclick = async () => {
      const o = await chrome.storage.local.get("neverSites");
      const list = new Set(o.neverSites || []); list.add(HOST);
      chrome.storage.local.set({ neverSites: [...list] });
    };
    host.__sh = sh;
    return host;
  }
  function showPill() {
    if (IN_FRAME) return;                       // товч зөвхөн үндсэн хуудсанд
    if (hidden || mode === "off") { if (pill) pill.remove(); clearInterval(pillT); return; }
    if (!pill) pill = makePill();
    if (!pill.isConnected) document.documentElement.appendChild(pill);
    pill.__sh.querySelectorAll("button[data-m]").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
    placePill();
    clearInterval(pillT);
    pillT = setInterval(placePill, 2000);      // сайт шинэ товч гаргаж болно (шалгалтын Next/Submit г.м.)
  }

  // Булангийн товч сайтын товч, холбоосыг ХАЛХЛАХГҮЙ: доор нь дарагдах зүйл байвал өөр булан руу шилжинэ
  const PILL_POS = [{ right: "16px", bottom: "16px" }, { left: "16px", bottom: "16px" },
                    { right: "16px", top: "50%" }, { left: "16px", top: "50%" }];
  const CLICKABLE = "a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=radio]," +
                    "[role=checkbox],[role=tab],[role=menuitem],[onclick],[tabindex]:not([tabindex='-1'])";
  let pillT = 0, pillPos = 0;
  function pillCovers() {
    const r = pill.getBoundingClientRect();
    if (!r.width) return false;
    // товчны талбайг ~14px тутамд сүлжээгээр шалгана (жижиг товч ч алгасагдахгүй)
    const pts = [];
    for (let y = r.top + 3; y <= r.bottom - 2; y += Math.max(6, (r.height - 6) / 2))
      for (let x = r.left + 3; x <= r.right - 2; x += 14) pts.push([x, y]);
    const prev = pill.style.pointerEvents;
    pill.style.pointerEvents = "none";        // өөрийгөө алгасаж доор нь юу байгааг харна
    try {
      for (const [x, y] of pts) {
        const el = document.elementFromPoint(x, y);
        if (el && el !== document.body && el !== document.documentElement && el.closest(CLICKABLE)) return true;
      }
      return false;
    } finally { pill.style.pointerEvents = prev; }
  }
  function setPillPos(i) {
    pillPos = i;
    const p = PILL_POS[i];
    pill.style.left = p.left || "auto"; pill.style.right = p.right || "auto";
    pill.style.top = p.top || "auto"; pill.style.bottom = p.bottom || "auto";
    pill.style.transform = p.top ? "translateY(-50%)" : "none";
  }
  function placePill() {
    if (!pill || !pill.isConnected) return;
    if (!pillCovers()) { pill.style.opacity = ""; return; }   // одоогийн байрлал саадгүй
    for (let k = 1; k <= PILL_POS.length; k++) {
      setPillPos((pillPos + k) % PILL_POS.length);
      if (!pillCovers()) { pill.style.opacity = ""; return; }
    }
    setPillPos(0);                             // хаана ч саадтай бол: хагас тунгалаг, хулгана аваачихад тод
    pill.style.opacity = ".35";
  }

  // ---------------------------------------------------------------- горим солих
  function start() {
    if (started) return;
    started = true;
    (document.head || document.documentElement).appendChild(css);
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        queue.add(e.target);
      }
      pump();
    }, { rootMargin: "600px 0px" });
    scan(document.body);
    // шинээр нэмэгдэх контент (scroll, SPA)
    let pending = null, changed = null, flushT = 0;
    const HM_ATTRS = ["data-hm-done", "data-hm-has", "data-hm-tr", "data-hm-wait", "data-hm-ui", "data-hm-flex",
                      "data-hm-grid", "data-hm-inline", "data-hm-end", "data-hm-center"];
    // хуудас текстээ өөрчилбөл (шалгалтын асуулт солигдох, сонголт шинэчлэгдэх) тэр хэсгийг шинээр орчуулна
    // "Монгол" горимд эх текст нуугдсан байдаг тул түр сэргээж байж жинхэнэ текстийг уншина
    function curText(el) {
      const hid = mode === "mo" && el.hasAttribute("data-hm-has");
      if (hid) el.removeAttribute("data-hm-has");
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (hid) el.setAttribute("data-hm-has", "");
      return t;
    }
    function refresh(el) {
      const it = items.get(el);
      if (!it) return;
      const text = curText(el);
      if (text === it.text) return;
      items.delete(el);
      queue.delete(el);
      io.unobserve(el);
      for (const a of HM_ATTRS) el.removeAttribute(a);
      scan(el.parentElement || el);
    }
    // "Эх" горимд байх хооронд хуудас өөрчлөгдсөн байж болно (шинэ асуулт, SPA дахин зурсан):
    // алга болсон элементийг хасаж, текст нь өөрчлөгдсөнийг шинэчилж, шинэ хэсгийг хайна
    resync = () => {
      for (const [el, it] of items) {
        if (!el.isConnected) { items.delete(el); queue.delete(el); io.unobserve(el); }
        else if (curText(el) !== it.text) refresh(el);
      }
      scan(document.body);
    };
    const flush = () => {
      flushT = 0;
      const nodes = pending, ch = changed;
      pending = changed = null;
      if (ch) for (const el of ch) if (el.isConnected) refresh(el);
      if (nodes) for (const n of nodes) if (n.isConnected) scan(n);
    };
    mo = new MutationObserver((muts) => {
      if (mode === "off") return;
      for (const m of muts) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!t || !t.closest || t.closest("hm-pill")) continue;
        const done = t.closest("[data-hm-done]");
        // орчуулсан элементийн өөрийнх нь style-ийг бид (attach) өөрчилдөг — үүнийг тоохгүй
        if (done && m.type === "attributes" && t === done) continue;
        if (done) { changed = changed || new Set(); changed.add(done); continue; }
        if (m.type === "attributes") {
          // Нуугдаж байсан хэсэг харагдсан (шалгалтын хариултын тайлбар, нээгдэх цонх, accordion):
          // class/style/hidden солигдоход тэр хэсгийг шинээр хайна. body/html-ийн class (scroll гэх мэт) тоохгүй.
          if (t !== document.body && t !== document.documentElement) { pending = pending || new Set(); pending.add(t); }
          continue;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && !n.closest("hm-pill")) { pending = pending || new Set(); pending.add(n); }
        }
      }
      if ((pending || changed) && !flushT) flushT = setTimeout(flush, 300);
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
                                attributeFilter: ["class", "style", "hidden", "aria-hidden", "open", "aria-expanded"] });
  }

  function apply() {
    const m = siteOff ? "off" : want;
    mode = ["bi", "mo"].includes(m) ? m : "off";
    if (!started && mode === "off") return;           // "Эх": хуудсанд огт хүрэхгүй
    document.documentElement.setAttribute("data-hm-mode", mode);
    document.documentElement.setAttribute("data-hm-style", style);
    document.documentElement.toggleAttribute("data-hm-ui-on", uiTr);
    if (mode !== "off") {
      if ((document.documentElement.lang || "").toLowerCase().startsWith("mn")) { showPill(); return; }
      const fresh = !started;
      start();
      if (!fresh && resync) resync();
      // орчуулагдаагүй хэсгүүдийг дахин дараалалд — харагдаж буйг нь л шууд орчуулна
      for (const [el, it] of items) if (!it.mn && el.isConnected) enqueue(el);
      if (mode === "mo") for (const [el, it] of items) if (it.mn && !it.node && el.isConnected) attach(el, it, it.mn, false);
      pump();
    }
    if (tip) tip.remove();
    showPill();
  }
  let style = "line";
  const setStyle = (st) => {
    style = ["bg", "learn"].includes(st) ? st : "line";
    if (started) document.documentElement.setAttribute("data-hm-style", style);
  };

  chrome.storage.local.get(["pageMode", "settings", "trStyle", "neverSites", "uiTr", "examMode"]).then((o) => {
    uiTr = o.uiTr !== false;
    exam = !!o.examMode;
    quality = !(o.settings && o.settings.quality === false);
    want = o.pageMode || "off";
    siteOff = (o.neverSites || []).includes(HOST);
    setStyle(o.trStyle);
    if (document.body) apply();
    else addEventListener("DOMContentLoaded", apply, { once: true });
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.settings) quality = c.settings.newValue?.quality !== false;
    if (c.trStyle) setStyle(c.trStyle.newValue);
    if (c.uiTr) {
      uiTr = c.uiTr.newValue !== false;
      if (started) document.documentElement.toggleAttribute("data-hm-ui-on", uiTr);
      if (uiTr && mode === "bi") { for (const [el, it] of items) if (it.ui && !it.mn && el.isConnected) io.observe(el); pump(); }
    }
    if (c.examMode) {
      exam = !!c.examMode.newValue;
      if (started && mode !== "off") {
        // аль хэдийн олдсон хэсгүүдийн «цэс/агуулга» ангиллыг шинэчлээд, товч хэлбэртэй хариултыг шинээр хайна
        for (const [el, it] of items) {
          it.ui = isChrome(el, it.text) || ownAfter(el);
          el.toggleAttribute("data-hm-ui", it.ui);
          if (!it.mn && el.isConnected) enqueue(el);
        }
        scan(document.body);
        pump();
      }
    }
    if (c.neverSites) siteOff = (c.neverSites.newValue || []).includes(HOST);
    if (c.pageMode) { hidden = false; want = c.pageMode.newValue || "off"; }
    if (c.pageMode || c.neverSites) apply();
  });
})();
