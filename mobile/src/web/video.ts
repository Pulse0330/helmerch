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
  V.diag = { seen: 0, bytes: 0 };
  // Гол видео: хуудсанд хэд хэдэн <video> (зар, жижиг тоглуулагч) байж болно — эхнийх биш, тоглуулагчийнхыг эсвэл хамгийн томыг
  function mainVideo(){
    var v = document.querySelector("#movie_player video, video.html5-main-video, #player video");
    var r0 = v && v.getBoundingClientRect();
    if (v && r0.width > 50) return v;
    var best = null, area = 0;
    document.querySelectorAll("video").forEach(function(x){
      var r = x.getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = x; }
    });
    return best || v;
  }
  window.__hmMainVideo = mainVideo;
  function got(url, text){
    if (V.got) return;
    V.diag.seen++; V.diag.bytes = (text || "").length;
    var c = text ? parse(text) : [];
    if (c.length < 2) {
      // оношлогоо: хадмалын файл ирсэн ч хоосон эсвэл задарсангүй (дээд мөрөнд харагдана)
      post({ kind: "vstatus", text: text ? "Хадмалын файл задарсангүй (" + text.length + " тэмдэгт) — шууд орчуулж байна" : "Хадмал хоосон ирлээ — шууд орчуулж байна" });
      return;
    }
    V.got = true; V.cues = tidy(c);
    var lm = /[?&]lang=([\\w-]+)/.exec(url); V.lang = lm ? lm[1] : "";
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
  // quality=false → fast: шууд Google (~0.3 сек). quality=true → AI, Gemini эхэлж (prefer).
  function send(texts, quality){
    return new Promise(function(res){
      chrome.runtime.sendMessage({ type: "translate", kind: "text", texts: texts, quality: quality, fast: !quality, prefer: "gemini",
        context: "Video subtitles: " + document.title.slice(0, 100) }, function(r){ res(r || {}); });
    });
  }
  // тоглож буй хэсгээс (гүйлгэсэн бол шинэ байрлалаас) урагш, тухайн шатанд орчуулагдаагүй дараагийн мөрүүд
  function nextChunk(done, n){
    var v = mainVideo(), now = v ? v.currentTime : 0, c = V.cues, out = [], seen = {};
    var start = c.findIndex(function(x){ return x.e >= now; });
    if (start < 0) start = 0;
    for (var k = 0; k < c.length && out.length < n; k++) {
      var tx = c[(start + k) % c.length].t;
      if (!done[tx] && !seen[tx]) { seen[tx] = 1; out.push(tx); }
    }
    return out;
  }
  // 1) Google-ээр маш хурдан: видео зогсохгүй, тоглож буй хэсгээс эхэлж орчуулна (эхний мөрүүд ~0.5 сек).
  // 2) Хооронд нь Gemini-ээр (мэргэжлийн) мөн тоглож буй хэсгээс урагш орчуулж, бэлэн болсон мөрийг шууд сольно.
  async function translateAll(){
    V.preparing = false;
    var total = {};
    V.cues.forEach(function(x){ total[x.t] = 1; });
    var count = Object.keys(total).length, fastDone = {}, aiDone = {}, fails = 0;
    google();
    gemini();
    async function google(){
      for (;;) {
        var part = nextChunk(fastDone, 40);
        if (!part.length) break;
        var r = {};
        for (var a = 0; a < 3 && !r.results; a++) { r = await send(part, false); if (!r.results) await new Promise(function(z){ setTimeout(z, 1500); }); }
        part.forEach(function(tx, j){
          fastDone[tx] = 1;
          var mn = r.results && r.results[j] && r.results[j].mn;
          if (mn && !aiDone[tx]) V.mn[tx] = mn;                // Gemini-ийнх аль хэдийн байвал дарж бичихгүй
        });
        if (V.fill) V.fill();
      }
      post({ kind: "vready", count: count });
    }
    // Gemini-ийн явцыг апп-д мэдэгдэнэ (видеоны дээд талд «✨ Gemini 45%» → «✨ Gemini ✓ дууссан»)
    async function gemini(){
      await new Promise(function(z){ setTimeout(z, 600); });   // эхний Google мөрүүд түрүүлж гарна
      var n = function(){ return Object.keys(aiDone).length; };
      post({ kind: "vai", state: "progress", done: 0, total: count });
      for (;;) {
        var q = nextChunk(aiDone, 25);
        if (!q.length) break;
        var rq = await send(q, true);
        if (!rq.results || rq.ai === false) {                   // түлхүүргүй эсвэл хязгаар дүүрсэн — Google хэвээр
          if (rq.ai === false || ++fails > 3) {
            post({ kind: "vai", state: "stopped", done: n(), total: count, nokey: n() === 0 && rq.ai === false });
            return;
          }
          await new Promise(function(z){ setTimeout(z, 5000); });
          continue;
        }
        q.forEach(function(tx, j){ aiDone[tx] = 1; var mn = rq.results[j] && rq.results[j].mn; if (mn) V.mn[tx] = mn; });
        if (V.fill) V.fill();                                   // track-ийн мөрүүдийг ч сольно
        post({ kind: "vai", state: "progress", done: n(), total: count });
      }
      post({ kind: "vai", state: "done", done: n(), total: count });
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
  // YouTube-ийн CC-г хэрэглэгч унтраасан ч «МН хадмал» асаалттай бол хадмалын өгөгдлийг ар талд дахин асаана
  // (англи хадмал CSS-ээр нуугдмал тул дэлгэцэнд гарахгүй) — бүтэн хадмал баригдаагүй үед дэлгэцээс уншихад хэрэгтэй.
  setInterval(function(){
    if (!V.on || V.got) return;
    var p = document.getElementById("movie_player");
    if (!p || !p.getOption) return;
    try {
      var cur = p.getOption("captions", "track");
      if (!cur || !cur.languageCode) loadTrack();
    } catch (e) { loadTrack(); }
  }, 1500);
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
  // --- Видеоны text track: (1) YouTube iPhone-д хадмалаа видеонд track болгон залгадаг — түүнээс БҮХ мөрийг авна;
  // (2) монгол хадмалыг ч track болгон залгана — iPhone-ий бүтэн дэлгэцийн тоглуулагч хуудсан дээрх давхаргыг харуулдаггүй,
  // харин track-ийг харуулдаг. Апп дотор (жижиг дэлгэцэнд) давхаргаар харуулж, монгол track-ийг нууна (давхар гарахгүй).
  var mnTrack = null, mnVideo = null, cueMap = {}, liveCue = null;
  function isFull(v){ return !!(v.webkitDisplayingFullscreen || document.fullscreenElement || document.webkitFullscreenElement); }
  function ensureTrack(v){
    if (mnVideo === v && mnTrack) return mnTrack;
    try { mnTrack = v.addTextTrack("subtitles", "Монгол", "mn"); } catch (e) { mnTrack = null; return null; }
    mnVideo = v; cueMap = {}; liveCue = null; mnTrack.mode = "hidden";
    fillTrack();
    return mnTrack;
  }
  function fillTrack(){
    if (!mnTrack || typeof VTTCue === "undefined") return;
    V.cues.forEach(function(c, i){
      var mn = V.mn[c.t];
      if (!mn) return;
      var q = cueMap[i];
      if (q) { if (q.text !== mn) q.text = mn; return; }
      try { q = new VTTCue(c.s, Math.max(c.e, c.s + 0.6), mn); q.line = -3; mnTrack.addCue(q); cueMap[i] = q; } catch (e) {}
    });
  }
  V.fill = fillTrack;
  // YouTube-ийн track-аас бүх мөрийг авах (хүсэлт баригдаагүй үед)
  function harvest(v){
    if (V.got) return;
    var tt = v.textTracks || [];
    for (var i = 0; i < tt.length; i++) {
      var tr = tt[i];
      if (tr === mnTrack || !/subtitles|captions/.test(tr.kind)) continue;
      if (tr.mode === "disabled") { try { tr.mode = "hidden"; } catch (e) {} }   // ачаалуулна, харуулахгүй
      if (!tr.cues || tr.cues.length < 3) continue;
      var c = [];
      for (var j = 0; j < tr.cues.length; j++) {
        var q = tr.cues[j], s = (q.text || "").replace(/<[^>]+>/g, "").replace(/\\s+/g, " ").trim();
        if (s) c.push({ s: q.startTime, e: q.endTime, t: s });
      }
      if (c.length > 2) { V.got = true; V.cues = tidy(c); translateAll(); return; }
    }
  }
  // YouTube-ийн track-ийн одоо гарч буй мөр (бүтэн дэлгэцэнд DOM хадмал байхгүй)
  function trackLine(v){
    var tt = v.textTracks || [];
    for (var i = 0; i < tt.length; i++) {
      var tr = tt[i];
      if (tr === mnTrack || !tr.activeCues || !tr.activeCues.length) continue;
      var s = [].map.call(tr.activeCues, function(q){ return (q.text || "").replace(/<[^>]+>/g, ""); }).join(" ").replace(/\\s+/g, " ").trim();
      if (s) return s;
    }
    return "";
  }

  var box = null, played = 0, hinted = false, blank = 0, blankTold = false;
  function draw(){
    var v = mainVideo();
    if (!css.isConnected && document.head) document.head.appendChild(css);
    if (!v || !V.on) { if (box) box.innerHTML = ""; if (mnTrack && mnTrack.mode !== "hidden") mnTrack.mode = "hidden"; return; }
    harvest(v);
    var full = isFull(v);
    ensureTrack(v);
    var t = v.currentTime, cue = null;
    for (var i = 0; i < V.cues.length; i++) { if (V.cues[i].s <= t && t < V.cues[i].e + 0.3) cue = V.cues[i]; if (V.cues[i].s > t) break; }
    var mn = cue ? (V.mn[cue.t] || "") : "";
    if (!mn) { var dc = domCaption(v) || trackLine(v); mn = dc ? liveMn(dc) : ""; if (!dc) lastMn = ""; }
    // Монгол хадмалыг видеоны track-аар харуулна — жижиг дэлгэц, бүтэн дэлгэц аль алинд iPhone өөрөө зурна
    // (хуудсан дээрх давхарга iPhone-ий жижиг тоглуулагч дээр харагдахгүй байсан). YouTube-ийн англи track нуугдана.
    if (mnTrack) {
      var trackMode = V.preparing ? "hidden" : "showing";
      if (mnTrack.mode !== trackMode) mnTrack.mode = trackMode;
      var tt = v.textTracks;
      for (var k = 0; k < tt.length; k++) if (tt[k] !== mnTrack && tt[k].mode === "showing" && !V.both) tt[k].mode = "hidden";
      // бүтэн хадмал байхгүй (мөр мөрөөр) үед одоогийн мөрийг track-д түр нэмнэ
      if (!V.got && mn && typeof VTTCue !== "undefined" && (!liveCue || liveCue.text !== mn)) {
        try { if (liveCue) mnTrack.removeCue(liveCue); liveCue = new VTTCue(t, t + 4, mn); liveCue.line = -3; mnTrack.addCue(liveCue); } catch (e) {}
      }
      if (!mn && liveCue && !V.got) { try { mnTrack.removeCue(liveCue); } catch (e) {} liveCue = null; }
    }
    // оношлогоо: хадмал бэлэн ч 5 сек тоглуулахад нэг ч мөр таарахгүй бол цагийг харуулна
    if (V.got && !V.preparing && !v.paused) blank = mn ? 0 : blank + 0.2;
    if (!blankTold && blank > 5 && V.cues.length) {
      blankTold = true;
      var nxt = V.cues.find(function(c){ return c.s > t; });
      post({ kind: "vstatus", text: "Хадмал таарсангүй: видео " + t.toFixed(1) + "с, мөр " + V.cues.length + ", эхний " + V.cues[0].s.toFixed(1) + "с, дараагийн " + (nxt ? nxt.s.toFixed(1) + "с" : "—") });
    }
    // 10 сек тоглуулаад ч хадмал олдохгүй бол CC асаахыг сануулна
    if (!v.paused) played += 0.2;
    if (!hinted && played > 10 && !V.got && !liveTold) { hinted = true; post({ kind: "vnone" }); }
    // бүтэн хадмал баригдаагүй, шууд орчуулж байгаа бол яагаад гэдгийг нэг удаа хэлнэ (оношлогоо)
    if (!hinted && played > 8 && !V.got && liveTold) {
      hinted = true;
      post({ kind: "vstatus", text: "Бүтэн хадмал баригдсангүй (хүсэлт " + V.diag.seen + ", " + V.diag.bytes + " тэмдэгт) — мөр мөрөөр орчуулж байна" });
    }
    if (!box) {
      box = document.createElement("hm-sub");
      box.style.cssText = "position:fixed;z-index:2147483646;left:0;right:0;pointer-events:none;text-align:center;padding:0 10px";
      document.documentElement.appendChild(box);
    }
    var r = v.getBoundingClientRect();
    // видеоны доод хэсэгт; видео харагдахгүй байвал дэлгэцийн доод хэсэгт
    box.style.top = (r.height > 60 && r.bottom > 0 ? Math.min(innerHeight - 90, Math.max(0, r.bottom - 70)) : innerHeight * 0.62) + "px";
    if (full || mnTrack) mn = "";                         // track харуулж байгаа — давхарга зөвхөн track залгаж чадаагүй үед (нөөц)
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
