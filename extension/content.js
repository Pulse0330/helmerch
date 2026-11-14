// Хэлмэрч — видео дээр хадмал харуулна
(() => {
  if (window.__mnHadmal) return;
  window.__mnHadmal = true;

  const isYT = location.hostname.endsWith("youtube.com");
  let video = null, srcKey = "", jobId = null, started = false;
  // видео бүр хадмал УНТРААЛТТАЙ эхэлнэ — «МН» товч (эсвэл Alt+M) дарж асаана
  let status = "", enabled = false, polling = false, lastPoll = 0, lastHref = "";
  let startFails = 0;   // эхлүүлэх оролдлого бүтэлгүйтсэн тоо (алдааг хэрэглэгчид харуулахгүй, чимээгүй дахин оролдоно)
  const cueMap = new Map();
  let subsEnabled = true;
  try {
    chrome.storage.local.get("settings").then((o) => { if (o.settings && o.settings.subs === false) subsEnabled = false; });
    chrome.storage.onChanged.addListener((c) => { if (c.settings) subsEnabled = c.settings.newValue?.subs !== false; });
  } catch (e) {}
  let cues = [];
  let trackCount = 0, lastTrackCheck = 0;

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;z-index:2147483647;pointer-events:none;text-align:center;color:#fff;" +
    "font-family:'Segoe UI',Arial,sans-serif;font-weight:600;line-height:1.3;white-space:pre-wrap;" +
    "text-shadow:0 0 4px #000,0 0 4px #000,0 0 3px #000,2px 2px 2px #000;display:none;";
  const badge = document.createElement("div");
  badge.title = "Дарж хадмалыг асаах/унтраах";
  badge.style.cssText =
    "position:fixed;z-index:2147483647;font:12px 'Segoe UI',Arial,sans-serif;color:#fff;" +
    "background:rgba(0,0,0,.6);padding:3px 8px;border-radius:10px;cursor:pointer;display:none;opacity:.8;";
  const toggle = () => { enabled = !enabled; lastPoll = 0; };
  for (const ev of ["pointerdown", "mousedown", "mouseup"]) badge.addEventListener(ev, (e) => e.stopPropagation());
  badge.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
  badge.addEventListener("mouseenter", () => { badge.style.opacity = "1"; });
  badge.addEventListener("mouseleave", () => { badge.style.opacity = enabled ? ".8" : ".55"; });
  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && (e.code === "KeyM") && video) { e.preventDefault(); toggle(); }
  }, true);

  function findVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (r.width > 200 && r.width * r.height > area) { best = v; area = r.width * r.height; }
    }
    return best;
  }

  function send(msg) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError;
          res(r || { error: "Өргөтгөл холбогдсонгүй (хуудсыг refresh хийнэ үү)" });
        });
      } catch (e) {
        res({ error: "Өргөтгөл шинэчлэгдсэн — хуудсыг refresh хийнэ үү" });
      }
    });
  }

  function reset() {
    jobId = null; started = false; status = ""; startFails = 0; cueMap.clear(); cues = [];
    trackCount = 0; lastTrackCheck = 0;
    if (typeof live !== "undefined") { live.text = live.mn = ""; live.rect = null; }
  }

  function merge(list) {
    for (const c of list) cueMap.set(c.start.toFixed(2), c);
    cues = [...cueMap.values()].sort((a, b) => a.start - b.start);
  }

  // ---------------------------------------------------------------- тоглуулагчийн өөрийн хадмал (textTracks)
  // Сайт <track> эсвэл JS-ээр хадмал ачаалсан бол бүтэн хадмалыг нь авч серверт өгнө — Whisper хэрэггүй, илүү нарийн.
  function readTracks(v) {
    let best = null, bestScore = -1;
    for (const tr of v.textTracks || []) {
      if (!/subtitles|captions/.test(tr.kind)) continue;
      const lang = (tr.language || "").toLowerCase();
      if (lang.startsWith("mn")) continue;
      if (tr.mode === "disabled") { try { tr.mode = "hidden"; } catch (e) {} }   // ачаалуулна, харуулахгүй
      const n = tr.cues ? tr.cues.length : 0;
      const score = n + (lang.startsWith("en") ? 100000 : 0) + (tr.mode === "showing" ? 50000 : 0);
      if (n && score > bestScore) { best = tr; bestScore = score; }
    }
    if (!best) return null;
    const cues = [];
    for (const c of best.cues) {
      const text = (c.text || "").replace(/<[^>]+>/g, "").trim();
      if (text) cues.push({ start: c.startTime, end: c.endTime, text });
      if (cues.length >= 6000) break;
    }
    return cues.length ? { lang: best.language || "", cues } : null;
  }

  // ---------------------------------------------------------------- дэлгэц дээр гарч буй хадмалыг шууд орчуулах
  // Netflix, Disney+ гэх мэт дууг нь татаж болдоггүй сайтад: тоглуулагчийн харуулж буй англи хадмалыг уншиж орчуулна.
  const CAP_SEL = ".player-timedtext, .dss-subtitle-renderer-cue-window, .atvwebplayersdk-captions-text, " +
    ".ytp-caption-window-container, .vjs-text-track-display, .plyr__captions, .jw-captions, .shaka-text-container, " +
    ".bmpui-ui-subtitle-overlay, [class*='caption' i], [class*='subtitle' i], [class*='timedtext' i]";
  const live = { text: "", mn: "", rect: null, cache: new Map(), pending: "" };
  function domCaption(v) {
    // 1) тоглуулагч өөрөө харуулж буй textTrack
    for (const tr of v.textTracks || []) {
      if (tr.mode !== "showing" || !tr.activeCues) continue;
      const t = [...tr.activeCues].map((c) => (c.text || "").replace(/<[^>]+>/g, "")).join("\n").trim();
      if (t) return { text: t, rect: null };
    }
    // 2) HTML дээр зурагдсан хадмал (видеоны ойролцоо)
    let root = v;
    for (let i = 0; i < 5 && root.parentElement; i++) root = root.parentElement;
    const vr = v.getBoundingClientRect();
    for (const el of root.querySelectorAll(CAP_SEL)) {
      if (el === box || el.contains(box) || el.closest("hm-tr,hm-pill")) continue;
      const t = (el.innerText || "").trim();
      if (!t || t.length > 400 || !/\p{L}/u.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 8 || r.bottom < vr.top || r.top > vr.bottom ||
          r.right < vr.left || r.left > vr.right) continue;   // зөвхөн видеоны талбай дотор
      return { text: t, rect: r };
    }
    return null;
  }
  async function liveTranslate(text) {
    if (live.cache.has(text)) return live.cache.get(text);
    if (live.pending === text) return null;
    live.pending = text;
    const r = await send({ type: "translate", kind: "text", texts: [text.replace(/\n/g, " ")], quality: false });
    live.pending = "";
    const mn = r && r.results && r.results[0] ? r.results[0].mn : "";
    if (mn) { live.cache.set(text, mn); if (live.cache.size > 500) live.cache.delete(live.cache.keys().next().value); }
    return mn;
  }

  // embed тоглуулагчийн жинхэнэ видеоны хуудас (yt-dlp-д хэрэгтэй)
  function canonicalUrl() {
    const el = document.querySelector('link[rel="canonical"], meta[property="og:url"], meta[itemprop="embedUrl"]');
    return el ? (el.href || el.content || "") : "";
  }

  async function tick() {
    if (!subsEnabled) return;
    const v = findVideo();
    if (!v) { video = null; return; }
    if (isYT && document.querySelector(".ad-showing")) return; // YouTube зар
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const key = location.href.split("#")[0] + "|" + (dur ? Math.round(dur) : "live");
    if (v !== video || key !== srcKey) {
      // шинэ видео: унтраалттай эхэлнэ (зар → кино шилжихэд асаасан төлөв хадгалагдана)
      const href = location.href.split("#")[0];
      if (v !== video || href !== lastHref) enabled = false;
      lastHref = href;
      video = v; srcKey = key; reset();
    }
    if (!enabled) { live.text = live.mn = ""; return; }   // асаагаагүй бол серверт юу ч илгээхгүй (GPU, токен хэмнэнэ)

    if (!started && !v.paused && v.currentTime > 0.5 && (!dur || dur > 20)) {
      started = true;
      status = "Бэлтгэж байна…";
      const myKey = srcKey;
      let tr = readTracks(v);
      // хадмалын мөр байгаа ч ачаалагдаж амжаагүй бол хэсэг хүлээнэ
      if (!tr && [...(v.textTracks || [])].some((t) => /subtitles|captions/.test(t.kind))) {
        await new Promise((res) => setTimeout(res, 1500));
        tr = readTracks(v);
      }
      trackCount = tr ? tr.cues.length : 0;
      const r = await send({
        type: "start", frame_url: location.href, duration: dur, time: v.currentTime,
        title: document.title, user_agent: navigator.userAgent, canonical: canonicalUrl(),
        track_cues: tr ? tr.cues : undefined, track_lang: tr ? tr.lang : undefined,
      });
      if (myKey !== srcKey) return;
      if (r.disabled) { subsEnabled = false; return; }
      if (r.job_id) { jobId = r.job_id; startFails = 0; }
      else {
        // алдааг харуулахгүй: эхэндээ хурдан, дараа нь аажмаар дахин оролдоно; удаа дараа бүтэхгүй бол чимээгүй болно
        startFails++;
        status = startFails < 5 ? "Бэлтгэж байна…" : "";
        setTimeout(() => { if (myKey === srcKey) started = false; }, Math.min(30000, 3000 * startFails));
      }
    }

    // серверийн хадмал энэ мөчид алга бол дэлгэц дээрх англи хадмалыг шууд орчуулна
    if (!currentCue(v.currentTime)) {
      const dc = domCaption(v);
      if (dc) {
        live.rect = dc.rect;
        if (dc.text !== live.text) {
          live.text = dc.text;
          live.mn = live.cache.get(dc.text) || "";
          if (!live.mn) liveTranslate(dc.text).then((mn) => { if (mn && live.text === dc.text) live.mn = mn; });
        }
      } else { live.text = ""; live.mn = ""; live.rect = null; }
    } else { live.text = ""; live.mn = ""; }

    if (jobId && !polling && Date.now() - lastPoll > 1500) {
      polling = true;
      lastPoll = Date.now();
      const myKey = srcKey;
      const msg = { type: "poll", job_id: jobId, time: v.currentTime };
      // хадмал хожуу ачаалагдсан бол (зарын дараа, урсгалаар) серверт дахин өгнө
      if (Date.now() - lastTrackCheck > 8000) {
        lastTrackCheck = Date.now();
        const tr = readTracks(v);
        if (tr && tr.cues.length > trackCount + 20) { trackCount = tr.cues.length; msg.track_cues = tr.cues; msg.track_lang = tr.lang; }
      }
      const r = await send(msg);
      polling = false;
      if (myKey !== srcKey) return;
      if (r.error === "unknown") { reset(); }       // сервер дахин асаагдсан
      else if (r.cues) { merge(r.cues); status = r.status; }
      // r.error: түр саатал — өмнөх төлөвөө хэвээр үлдээгээд дараагийн poll-оор дахин оролдоно (алдаа харуулахгүй)
    }
  }

  function currentCue(t) {
    let lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < 0) return null;
    const c = cues[idx], next = cues[idx + 1];
    const until = Math.max(c.end, Math.min(c.end + 1.0, next ? next.start : Infinity));
    return t < until ? c : null;
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!subsEnabled || !video || !video.isConnected) {
      box.style.display = badge.style.display = "none";
      return;
    }
    const fsEl = document.fullscreenElement;
    const host = fsEl && fsEl.tagName !== "VIDEO" ? fsEl : document.body || document.documentElement;
    for (const el of [box, badge]) if (el.parentNode !== host) host.appendChild(el);

    const r = video.getBoundingClientRect();
    const cue = enabled ? currentCue(video.currentTime) : null;
    const text = cue && cue.mn ? cue.mn : (enabled && live.mn ? live.mn : "");
    if (text) {
      if (box.textContent !== text) box.textContent = text;
      box.style.fontSize = Math.max(14, Math.round(r.height * 0.045)) + "px";
      box.style.left = r.left + r.width * 0.08 + "px";
      box.style.width = r.width * 0.84 + "px";
      // сайтын англи хадмал дэлгэц дээр байвал түүний дээр гаргана (давхцахгүй)
      const lr = !cue && live.rect;
      box.style.bottom = (lr ? window.innerHeight - lr.top + 6 : window.innerHeight - r.bottom + r.height * 0.09) + "px";
      box.style.display = "block";
    } else box.style.display = "none";

    const liveOn = enabled && live.mn && !cue;
    badge.textContent = !enabled ? "МН · хадмал асаах" : liveOn ? "МН ✓ (дэлгэцийн хадмалаас)" : !started ? "МН · бэлтгэж байна…"
      : status === "ready" ? "МН ✓" : "МН · " + status;
    badge.title = enabled ? "Дарж хадмалыг унтраах (Alt+M)" : "Дарж монгол хадмал асаах (Alt+M)";
    if (!badge.matches(":hover")) badge.style.opacity = enabled ? ".8" : ".55";
    badge.style.left = r.left + 10 + "px";
    badge.style.top = r.top + 10 + "px";
    badge.style.display = "block";
  }

  setInterval(tick, 500);
  requestAnimationFrame(draw);
})();
