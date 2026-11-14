// Видео (YouTube): тоглуулагч өөрөө хадмалаа татах хүсэлтийг (api/timedtext) барьж авч, бүх хадмалыг
// урьдчилан орчуулаад видеоны цагтай тааруулан монгол хадмал харуулна (компьютерын yt-dlp аргатай төстэй).
// Хадмалын хүсэлт барих нь тоглуулагчийн скриптээс ӨМНӨ ажиллах ёстой → injectedJavaScriptBeforeContentLoaded.
// Олдохгүй бол дэлгэц дээр гарч буй хадмалыг шууд орчуулах арга (inject.ts-ийн TOOLS) нөөц болно.

// YouTube-ийн холбоосоос видеоны ID
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/|v\/))([\w-]{11})/i);
  return m ? m[1] : null;
}

export const VIDEO_BEFORE_JS = `(function(){
  if (window.__hmVideo) return; window.__hmVideo = true;
  var post = function(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} };
  // on: «МН хадмал» товч (анхдагчаар асаалттай). YouTube-ийн CC-г хэрэглэгч асаагаагүй ч өгөгдлийг нь ар талд ачаалж,
  // англи хадмалыг дэлгэцэнд ХАРУУЛАХГҮЙ — зөвхөн монгол хадмал гарна.
  var V = window.__hmV = { cues: [], mn: {}, got: false, lang: "", both: false, on: true };

  // --- хадмалын файлыг задлах (json3 эсвэл xml)
  function parse(text){
    var out = [];
    try {
      var j = JSON.parse(text);
      (j.events || []).forEach(function(e){
        if (!e.segs) return;
        var t = e.segs.map(function(s){ return s.utf8 || ""; }).join("").replace(/\\s+/g, " ").trim();
        if (t) out.push({ s: (e.tStartMs || 0) / 1000, e: ((e.tStartMs || 0) + (e.dDurationMs || 2000)) / 1000, t: t });
      });
    } catch (err) {
      var re = /<(?:text|p)[^>]*?(?:start="([\\d.]+)"[^>]*?dur="([\\d.]+)"|t="(\\d+)"[^>]*?d="(\\d+)")[^>]*>([\\s\\S]*?)<\\/(?:text|p)>/g, m;
      while ((m = re.exec(text))) {
        var s = m[1] ? +m[1] : +m[3] / 1000, d = m[2] ? +m[2] : +m[4] / 1000;
        var t = m[5].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\\s+/g, " ").trim();
        if (t) out.push({ s: s, e: s + d, t: t });
      }
    }
    return out;
  }
  // автомат хадмал нэг үгээр давхцаж ирдэг — дараагийн мөр эхлэхэд өмнөхийг дуусгана
  function tidy(c){
    c.sort(function(a, b){ return a.s - b.s; });
    for (var i = 0; i < c.length - 1; i++) if (c[i].e > c[i + 1].s) c[i].e = c[i + 1].s;
    return c;
  }
  function got(url, text){
    if (!text || V.got) return;
    var c = parse(text);
    if (c.length < 2) return;
    V.got = true; V.cues = tidy(c);
    var lm = /[?&]lang=([\\w-]+)/.exec(url); V.lang = lm ? lm[1] : "";
    post({ kind: "vstatus", text: "Хадмал олдлоо (" + c.length + " мөр) — урьдчилан орчуулж байна…" });
    translateAll();
  }

  // --- тоглуулагчийн хүсэлтийг барих (fetch + XHR)
  var isTT = function(u){ return /\\/api\\/timedtext|\\/timedtext\\?/.test(String(u || "")); };
  var of = window.fetch;
  if (of) window.fetch = function(input, init){
    var u = typeof input === "string" ? input : (input && input.url);
    var p = of.apply(this, arguments);
    if (isTT(u)) p.then(function(r){ r.clone().text().then(function(t){ got(u, t); }).catch(function(){}); }).catch(function(){});
    return p;
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){ this.__hmU = u; return oo.apply(this, arguments); };
  // тоглуулагч хариуг текст биш (arraybuffer / json / blob) хэлбэрээр авч болно — бүгдийг текст болгоно
  function xhrText(x, cb){
    var rt = x.responseType;
    if (!rt || rt === "text") return cb(x.responseText);
    if (rt === "json") return cb(typeof x.response === "string" ? x.response : JSON.stringify(x.response));
    if (rt === "arraybuffer" && x.response) return cb(new TextDecoder("utf-8").decode(x.response));
    if (rt === "blob" && x.response && x.response.text) x.response.text().then(cb).catch(function(){});
  }
  XMLHttpRequest.prototype.send = function(){
    var x = this;
    if (isTT(x.__hmU)) x.addEventListener("load", function(){ try { xhrText(x, function(t){ got(x.__hmU, t); }); } catch (e) {} });
    return os.apply(this, arguments);
  };

  // --- бүх хадмалыг орчуулах: тоглож буй хэсгээс эхэлж, эхлээд хурдан, дараа нь AI
  // quality=false → fast: шууд Google (~0.3 сек). AI (quality) нь зөвхөн урьдчилан татсан хадмалыг ар талд сайжруулна.
  function send(texts, quality){
    return new Promise(function(res){
      chrome.runtime.sendMessage({ type: "translate", kind: "text", texts: texts, quality: quality, fast: !quality,
        context: "Video subtitles: " + document.title.slice(0, 100) }, function(r){ res(r || {}); });
    });
  }
  async function translateAll(){
    var c = V.cues, N = 30;
    var v = document.querySelector("video"), now = v ? v.currentTime : 0;
    var start = Math.max(0, c.findIndex(function(x){ return x.e >= now; }));
    var order = [];
    for (var i = start; i < c.length; i += N) order.push(i);
    for (var k = 0; k < start; k += N) order.push(k);
    for (var pass = 0; pass < 2; pass++) {               // 0 = хурдан, 1 = AI (мэргэжлийн)
      for (var o = 0; o < order.length; o++) {
        var from = order[o], part = c.slice(from, from + N), texts = part.map(function(x){ return x.t; });
        var r = await send(texts, pass === 1);
        if (!r.results) { await new Promise(function(z){ setTimeout(z, 3000); }); continue; }
        r.results.forEach(function(x, j){ if (x.mn && (pass === 1 || !V.mn[part[j].t])) V.mn[part[j].t] = x.mn; });
        if (pass === 0 && o === 0) post({ kind: "vstatus", text: "" });
        if (pass === 1 && r.ai === false) break;            // AI түлхүүргүй — хурдан орчуулга хэвээр
      }
    }
  }

  // --- YouTube-ийн хадмалын өгөгдлийг ачаалах (англи эсвэл байгаа хадмал). Дэлгэцэнд нь CSS-ээр нуугдана.
  function loadTrack(){
    var p = document.getElementById("movie_player");
    if (!p || !p.getOption) return false;
    try {
      p.loadModule && p.loadModule("captions");
      var list = p.getOption("captions", "tracklist") || [];
      // гараар хийсэн англи хадмал → автомат (asr) англи → байгаа хадмал
      var tr = list.filter(function(t){ return /^en/.test(t.languageCode) && t.kind !== "asr"; })[0] ||
               list.filter(function(t){ return /^en/.test(t.languageCode); })[0] || list[0];
      if (tr) { p.setOption("captions", "track", tr); return true; }   // бүтэн объектыг өгнө (зөвхөн languageCode биш)
    } catch (e) {}
    return false;
  }
  var tries = 0, loaded = false;
  var tick = setInterval(function(){
    if (!V.on) return;
    if ((loaded && V.got) || ++tries > 60) { clearInterval(tick); return; }
    if (loadTrack()) loaded = true;
  }, 1000);
  // апп-ын «МН хадмал» товч
  window.__hmSubs = function(on){
    V.on = !!on;
    document.documentElement.classList.toggle("hm-sub-on", V.on);
    var p = document.getElementById("movie_player");
    if (V.on) loadTrack();
    else { try { p && p.setOption && p.setOption("captions", "track", {}); } catch (e) {} }   // YouTube-ийн хадмалыг ч унтраана
    if (box && !V.on) box.innerHTML = "";
  };

  // --- дэлгэц дээр гарч буй хадмал (YouTube-ийн CC асаалттай үед) — хүсэлт баригдаагүй ч эндээс уншина
  var CAP = ".ytp-caption-segment, .caption-visual-line, .captions-text, .ytp-caption-window-container, .caption-window, [class*='caption-window']";
  function domCaption(v){
    var vr = v.getBoundingClientRect(), segs = document.querySelectorAll(".ytp-caption-segment");
    var parts = [];
    for (var i = 0; i < segs.length; i++) { var s = (segs[i].textContent || "").trim(); if (s) parts.push(s); }
    if (parts.length) return parts.join(" ").replace(/\\s+/g, " ");
    var els = document.querySelectorAll(CAP);
    for (var j = 0; j < els.length; j++) {
      if (box && (els[j] === box || box.contains(els[j]))) continue;
      var r = els[j].getBoundingClientRect(), t = (els[j].textContent || "").replace(/\\s+/g, " ").trim();
      if (t && t.length < 400 && r.bottom >= vr.top && r.top <= vr.bottom + 40) return t;
    }
    return "";
  }
  // Дэлгэцийн хадмалыг шууд орчуулах: нэг удаад НЭГ хүсэлт. Автомат хадмал үгээ нэг нэгээр нэмдэг тул хагас өгүүлбэр бүрийг
  // тусад нь хүсвэл дараалал үүсч хоцорно — хариу ирэхэд текст өөрчлөгдсөн бол хамгийн сүүлийнхийг л хүснэ.
  var live = {}, inflight = false, want = "", lastMn = "", liveTold = false;
  function ask(){
    if (inflight || !want || live[want]) return;
    var text = want;
    inflight = true;
    send([text], false).then(function(r){
      inflight = false;
      var mn = r.results && r.results[0] && r.results[0].mn;
      if (mn) live[text] = mn;
      ask();                                              // энэ хооронд шинэ мөр гарсан бол
    });
  }
  function liveMn(text){
    want = text;
    if (live[text]) { lastMn = live[text]; return lastMn; }
    // хадмал хэсэгчлэн өссөн бол (өмнөх мөрийн үргэлжлэл) орчуулга ирэх хүртэл өмнөхийг харуулна
    ask();
    if (!liveTold) { liveTold = true; post({ kind: "vstatus", text: "Дэлгэц дээрх хадмалыг орчуулж байна" }); setTimeout(function(){ post({ kind: "vstatus", text: "" }); }, 3000); }
    return lastMn;
  }

  // --- монгол хадмалыг видеон дээр харуулах. «МН хадмал» асаалттай үед YouTube-ийн англи хадмал ҮРГЭЛЖ нуугдана
  // («Англи хадмал хамт» сонгосон үед л харагдана). Нуусан ч текст нь DOM-д байгаа тул уншиж орчуулна.
  var HIDE = ".caption-window, .ytp-caption-window-container, .captions-text, .ytp-caption-segment, .caption-visual-line, [class*='caption-window'], [class*='captions-text']";
  var css = document.createElement("style");
  css.textContent = HIDE.split(", ").map(function(s){ return "html.hm-sub-on:not(.hm-both) " + s; }).join(", ") + "{opacity:0!important}";
  document.documentElement.classList.add("hm-sub-on");
  var box = null, played = 0, hinted = false;
  function draw(){
    var v = document.querySelector("video");
    if (!css.isConnected && document.head) document.head.appendChild(css);
    if (!v || !V.on) { if (box) box.innerHTML = ""; return; }
    var t = v.currentTime, cue = null;
    for (var i = 0; i < V.cues.length; i++) { if (V.cues[i].s <= t && t < V.cues[i].e + 0.3) cue = V.cues[i]; if (V.cues[i].s > t) break; }
    var mn = cue ? (V.mn[cue.t] || "") : "";
    if (!mn) { var dc = domCaption(v); mn = dc ? liveMn(dc) : ""; if (!dc) lastMn = ""; }
    // 10 сек тоглуулаад ч хадмал олдохгүй бол CC асаахыг сануулна
    if (!v.paused) played += 0.2;
    if (!hinted && played > 10 && !V.got && !liveTold) { hinted = true; post({ kind: "vnone" }); }
    if (!box) {
      box = document.createElement("hm-sub");
      box.style.cssText = "position:fixed;z-index:2147483646;left:0;right:0;pointer-events:none;text-align:center;padding:0 10px";
      document.documentElement.appendChild(box);
    }
    var r = v.getBoundingClientRect();
    box.style.top = Math.max(0, r.bottom - 70) + "px";
    box.innerHTML = mn ? '<span style="background:rgba(0,0,0,.72);color:#fff;font:600 16px/1.4 -apple-system,system-ui,sans-serif;' +
      'padding:3px 8px;border-radius:6px;-webkit-box-decoration-break:clone;box-decoration-break:clone">' +
      mn.replace(/[&<>]/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }) + "</span>" : "";
  }
  setInterval(draw, 200);
})();true;`;

// апп-аас: эх хадмалыг хамт харуулах эсэх
export const videoBothJs = (on: boolean) => `document.documentElement.classList.toggle("hm-both", ${on});true;`;
// апп-аас: «МН хадмал» асаах / унтраах
export const videoSubsJs = (on: boolean) => `window.__hmSubs && window.__hmSubs(${on});true;`;
