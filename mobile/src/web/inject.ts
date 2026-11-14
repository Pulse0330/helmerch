// WebView-д оруулах скриптүүд.
// pagetr.js (компьютерын өргөтгөлийнх, өөрчлөлтгүй) нь chrome.runtime / chrome.storage дууддаг —
// BRIDGE нь эдгээрийг апп руу (window.ReactNativeWebView.postMessage) дамжуулж, хариуг __hmFromApp-аар хүлээж авна.
import { PAGETR_JS } from "./extension.generated";

// апп → хуудас руу илгээх JS (WebView.injectJavaScript-д)
export const toPage = (msg: unknown) => `window.__hmFromApp && window.__hmFromApp(${JSON.stringify(msg)});true;`;

// хуудас ачаалагдахаас өмнө: chrome.* дуураймал + тохиргоо
export function bridgeJs(store: Record<string, unknown>) {
  return `(function(){
  if (window.__hmBridge) return; window.__hmBridge = true;
  window.__hmNoPill = true;
  var store = ${JSON.stringify(store)}, cbs = {}, seq = 0, listeners = [];
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }
  window.__hmPost = post;
  window.__hmStoreGet = function(k){ return store[k]; };
  window.__hmFromApp = function(m){
    if (m.kind === "resp") { var cb = cbs[m.id]; delete cbs[m.id]; if (cb) cb(m.data); }
    else if (m.kind === "store") {
      var c = {};
      for (var k in m.data) { c[k] = { oldValue: store[k], newValue: m.data[k] }; store[k] = m.data[k]; }
      listeners.forEach(function(f){ try { f(c); } catch (e) {} });
    }
  };
  var ch = window.chrome = window.chrome || {};
  ch.runtime = { lastError: null, getURL: function(){ return ""; },
    sendMessage: function(msg, cb){ var id = ++seq; cbs[id] = cb || function(){}; post({ kind: "req", id: id, msg: msg }); } };
  ch.storage = { local: {
      get: function(){ return Promise.resolve(Object.assign({}, store)); },
      set: function(o){ post({ kind: "set", data: o }); window.__hmFromApp({ kind: "store", data: o }); return Promise.resolve(); } },
    onChanged: { addListener: function(f){ listeners.push(f); } } };
})();true;`;
}

// утсанд зориулсан нэмэлтүүд: текст сонгох, үг дээр дарах, видеоны хадмал
const TOOLS_JS = `(function(){
  if (window.__hmTools) return; window.__hmTools = true;
  var post = window.__hmPost, get = window.__hmStoreGet;

  // --- текст сонгоход (удаан дарж сонгох) → апп доод хэсэгт орчуулга харуулна
  var selT = 0, lastSel = "";
  document.addEventListener("selectionchange", function(){
    clearTimeout(selT);
    selT = setTimeout(function(){
      var s = window.getSelection(), t = s ? String(s).replace(/\\s+/g, " ").trim() : "";
      if (t === lastSel) return;
      lastSel = t;
      if (t.length >= 2 && t.length <= 3000 && /\\p{L}/u.test(t)) post({ kind: "sel", text: t });
    }, 700);
  });

  // хуруу байгаа цэг дээрх англи үг
  function wordAt(x, y){
    if (!document.caretRangeFromPoint) return "";
    var r = document.caretRangeFromPoint(x, y);
    if (!r || !r.startContainer || r.startContainer.nodeType !== 3) return "";
    var txt = r.startContainer.data, a = r.startOffset, b = r.startOffset, W = /[A-Za-z'\\-]/;
    while (a > 0 && W.test(txt[a - 1])) a--;
    while (b < txt.length && W.test(txt[b])) b++;
    var w = txt.slice(a, b).replace(/^['\\-]+|['\\-]+$/g, "");
    return w.length >= 2 ? w : "";
  }

  // --- «Үг» горим: үг дээр дарахад орчуулна (холбоос руу шилжихгүй)
  document.addEventListener("click", function(e){
    if (!get("wordTap")) return;
    var w = wordAt(e.clientX, e.clientY);
    if (!w) return;
    e.preventDefault(); e.stopPropagation();
    post({ kind: "word", word: w });
  }, true);

  // --- удаан дарах (~0.45 сек): тэр үгийн орчуулга шууд гарна (холбоос, товч дээр ч)
  var lp = 0, sx = 0, sy = 0;
  document.addEventListener("touchstart", function(e){
    clearTimeout(lp);
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    lp = setTimeout(function(){
      var w = wordAt(sx, sy);
      if (w) { lastSel = w; post({ kind: "word", word: w }); }    // дараа нь iPhone тэр үгийг сонгоход давхар гаргахгүй
    }, 450);
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", function(e){
    var t = e.touches[0];
    if (t && (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10)) clearTimeout(lp);   // гүйлгэж байна
  }, { passive: true, capture: true });
  document.addEventListener("touchend", function(){ clearTimeout(lp); }, { passive: true, capture: true });
  document.addEventListener("touchcancel", function(){ clearTimeout(lp); }, { passive: true, capture: true });

  // --- видео хадмал: сайтын өөрийнх нь хадмалыг (англи) уншиж монголоор видеон дээр харуулна
  var CAP = ".ytp-caption-segment, .captions-text, .player-timedtext, .vjs-text-track-display, .plyr__captions, " +
            ".jw-captions, .shaka-text-container, [class*='caption' i], [class*='subtitle' i]";
  var box = null, cur = "", cache = {}, pending = "";
  function bestVideo(){
    var best = null, area = 0;
    document.querySelectorAll("video").forEach(function(v){
      var r = v.getBoundingClientRect();
      if (r.width > 150 && r.width * r.height > area) { best = v; area = r.width * r.height; }
    });
    return best;
  }
  function capText(v){
    var tt = v.textTracks || [];
    for (var i = 0; i < tt.length; i++) {
      if (tt[i].mode !== "showing" || !tt[i].activeCues) continue;
      var t = [].map.call(tt[i].activeCues, function(c){ return (c.text || "").replace(/<[^>]+>/g, ""); }).join(" ").trim();
      if (t) return t;
    }
    var vr = v.getBoundingClientRect(), els = document.querySelectorAll(CAP);
    for (var j = 0; j < els.length; j++) {
      if (box && (els[j] === box || box.contains(els[j]))) continue;
      var r = els[j].getBoundingClientRect(), s = (els[j].innerText || "").trim();
      if (!s || s.length > 400 || r.width < 20 || r.bottom < vr.top || r.top > vr.bottom) continue;
      return s.replace(/\\s+/g, " ");
    }
    return "";
  }
  function show(v, mn){
    if (!box) {
      box = document.createElement("hm-sub");
      box.style.cssText = "position:fixed;z-index:2147483646;left:0;right:0;pointer-events:none;text-align:center;" +
        "font:600 16px/1.35 -apple-system,system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000,0 0 2px #000;padding:0 12px";
      document.documentElement.appendChild(box);
    }
    var r = v.getBoundingClientRect();
    box.style.top = Math.max(0, r.bottom - 64) + "px";
    box.textContent = mn;
    box.style.display = mn ? "block" : "none";
  }
  setInterval(function(){
    if (!get("subs")) { if (box) box.style.display = "none"; return; }
    var v = bestVideo();
    if (!v) { if (box) box.style.display = "none"; return; }
    var t = capText(v);
    if (!t) { show(v, ""); cur = ""; return; }
    if (t === cur) { show(v, cache[t] || ""); return; }
    cur = t;
    if (cache[t]) return show(v, cache[t]);
    if (pending === t) return;
    pending = t;
    chrome.runtime.sendMessage({ type: "translate", kind: "text", texts: [t], quality: false }, function(r){
      pending = "";
      var mn = r && r.results && r.results[0] && r.results[0].mn;
      if (mn) { cache[t] = mn; if (cur === t) show(v, mn); }
    });
  }, 400);
})();true;`;

// Нэвтрэх маягт: хэрэглэгч нэвтрэхэд нэр/нууц үгийг апп руу (зөвхөн утасны Keychain-д хадгалахыг асуухад) өгнө,
// хуудсанд нууц үгийн талбар байгааг мэдэгдэнэ (апп «🔑 Нэвтрэх» товч гаргана). Үндсэн хуудсанд л.
const CRED_JS = `(function(){
  if (window.__hmCred || window !== window.top) return; window.__hmCred = true;
  var post = window.__hmPost;
  var vis = function(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var textish = function(i){ return /^(text|email|tel|)$/.test((i.getAttribute("type") || "").toLowerCase()); };
  var lastUser = "";
  // хоёр шаттай нэвтрэлт (эхлээд имэйл, дараа нь нууц үг): сүүлд бичсэн нэрийг санана
  document.addEventListener("change", function(e){
    var i = e.target;
    if (i && i.tagName === "INPUT" && textish(i) && /user|mail|login|name|phone|id/i.test((i.name || "") + (i.id || "") + (i.autocomplete || "") + (i.type || ""))) lastUser = i.value;
  }, true);
  var sent = "";
  function grab(root){
    var pw = [].filter.call((root || document).querySelectorAll("input[type=password]"), function(i){ return i.value; })[0];
    if (!pw) return;
    var ins = [].filter.call((pw.form || root || document).querySelectorAll("input"), function(i){ return textish(i) && i.value && vis(i); });
    var before = ins.filter(function(i){ return i.compareDocumentPosition(pw) & 4; });
    var user = (before[before.length - 1] || ins[0] || {}).value || lastUser;
    var key = location.hostname + "|" + user + "|" + pw.value;
    if (key === sent) return;
    sent = key;
    post({ kind: "cred", host: location.hostname.replace(/^www\\./, ""), user: user, pass: pw.value });
  }
  document.addEventListener("submit", function(e){ grab(e.target); }, true);
  document.addEventListener("click", function(e){
    var b = e.target && e.target.closest && e.target.closest("button,input[type=submit],[role=button],a");
    if (b) setTimeout(function(){ grab(b.form || b.closest("form") || document); }, 0);
  }, true);
  document.addEventListener("keydown", function(e){
    if (e.key === "Enter" && e.target && e.target.type === "password") setTimeout(function(){ grab(e.target.form || document); }, 0);
  }, true);
  // нууц үгийн талбар гарч ирвэл апп-д мэдэгдэнэ (SPA-д хожуу гарч ирж болно)
  var told = false, n = 0;
  var t = setInterval(function(){
    var has = [].some.call(document.querySelectorAll("input[type=password]"), vis);
    if (has !== told) { told = has; post({ kind: "haspw", host: location.hostname.replace(/^www\\./, ""), has: has }); }
    if (++n > 120) clearInterval(t);
  }, 1000);
})();true;`;

// хадгалсан нэвтрэх мэдээллийг талбарт бөглөнө (React/Vue-д ч ажиллахаар input/change үйл явдалтай)
export const fillCredJs = (user: string, pass: string) => `(function(u, p){
  var vis = function(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function set(el, v){ var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value"); d.set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  var pw = [].filter.call(document.querySelectorAll("input[type=password]"), vis)[0];
  var scope = (pw && pw.form) || document;
  var ins = [].filter.call(scope.querySelectorAll("input"), function(i){ return /^(text|email|tel|)$/.test((i.getAttribute("type") || "").toLowerCase()) && vis(i); });
  var before = pw ? ins.filter(function(i){ return i.compareDocumentPosition(pw) & 4; }) : ins;
  var user = before[before.length - 1] || ins[0];
  if (user && u) set(user, u);
  if (pw) { set(pw, p); pw.focus(); }
})(${JSON.stringify(user)}, ${JSON.stringify(pass)});true;`;

// хуудас ачаалагдсаны дараа: pagetr.js + утасны нэмэлтүүд + нэвтрэх маягт
export const PAGE_JS = PAGETR_JS + "\n;" + TOOLS_JS + "\n;" + CRED_JS;
