// Хэлмэрч — background service worker
const SERVER = "http://127.0.0.1:8765";
const MEDIA_RE = /\.(m3u8|mp4|m4a|webm|mp3)(\?|#|$)/i;
const SUB_RE = /\.(vtt|srt|ttml|dfxp|ass)(\?|#|$)/i;   // сайтын хадмалын файл
// embed тоглуулагчийн видео ID агуулсан хүсэлт (жишээ нь Dailymotion-ы metadata)
const HINT_RE = /(dailymotion\.com|dmcdn\.net|dai\.ly)\/.*video\/x[0-9a-z]{4,}|player\.vimeo\.com\/video\/\d+/i;
const OFFLINE = "Хэлмэрч програм асаагүй байна";
const PDF_RULE_ID = 1;
const PDF_REGEX = "^https?://[^#]*\\.[pP][dD][fF](\\?[^#]*)?$";

// ---------------------------------------------------------------- видео холбоос барих
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    let path;
    try { path = new URL(d.url).pathname; } catch { return; }
    const isSub = SUB_RE.test(path) && !/youtube\.com/.test(d.url);
    const isHint = !isSub && !MEDIA_RE.test(path) && HINT_RE.test(d.url);
    if (!isSub && !isHint && !MEDIA_RE.test(path)) return;
    if (/googlevideo\.com/.test(d.url)) return; // YouTube-ийг сервер өөрөө танина
    const k = (isSub ? "s" : isHint ? "h" : "m") + d.tabId;
    chrome.storage.session.get(k).then((o) => {
      const arr = (o[k] || []).filter((u) => u !== d.url);
      arr.push(d.url);
      chrome.storage.session.set({ [k]: arr.slice(-15) });
    });
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(["m" + tabId, "s" + tabId, "h" + tabId, "bypass" + tabId]);
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [100000 + tabId] }).catch(() => {});
});

// ---------------------------------------------------------------- сервертэй холбогдох
// tries > 1 бол алдаа гарахад (сервер түр саатах, 429 г.м.) хэрэглэгчид мэдэгдэлгүй хэд хэдэн удаа дахин оролдоно
const RETRY_WAIT = [700, 1800, 3500, 6000];
async function post(path, body, tries = 1) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(SERVER + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j && j.error && i < tries - 1) throw new Error(j.error);
      return j;
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, RETRY_WAIT[i] || 6000));
    }
  }
}

let lastPdfSetting = null;
async function fetchSettings() {
  try {
    const r = await fetch(SERVER + "/settings");
    const s = await r.json();
    await chrome.storage.local.set({ settings: s, online: true });
    if (s.pdf !== lastPdfSetting) { lastPdfSetting = s.pdf; await updatePdfRule(s.pdf); }
    return s;
  } catch (e) {
    const o = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ online: false });
    return { ...(o.settings || {}), offline: true };
  }
}

// ---------------------------------------------------------------- PDF-ийг орчуулагч үзүүлэгчээр нээх
async function updatePdfRule(on) {
  const addRules = on === false ? [] : [{
    id: PDF_RULE_ID,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: chrome.runtime.getURL("pdf.html") + "?file=\\0" } },
    condition: { regexFilter: PDF_REGEX, resourceTypes: ["main_frame"] },
  }];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PDF_RULE_ID], addRules }).catch(() => {});
}

async function openOriginal(tabId, url) {
  await chrome.storage.session.set({ ["bypass" + tabId]: url });
  // энэ таб дээр PDF-ийг Chrome-ийн өөрийн үзүүлэгчээр нээхийг зөвшөөрнө
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [100000 + tabId],
    addRules: [{
      id: 100000 + tabId, priority: 2, action: { type: "allow" },
      condition: { tabIds: [tabId], regexFilter: PDF_REGEX, resourceTypes: ["main_frame"] },
    }],
  }).catch(() => {});
  await chrome.tabs.update(tabId, { url });
}

function setup() {
  // дүрс дээр дарахад цэс (popup) нээгдэнэ; хажуу самбарыг цэснээс нээнэ
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  setupMenus();
  chrome.alarms.create("settings", { periodInMinutes: 0.5 });
  fetchSettings();
}
chrome.runtime.onInstalled.addListener((d) => {
  setup();
  if (d.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

// ---------------------------------------------------------------- баруун товчны цэс
async function setupMenus() {
  await chrome.contextMenus.removeAll().catch(() => {});
  chrome.contextMenus.create({ id: "hm-sel", title: "Хэлмэрч: сонгосон текстийг орчуулах", contexts: ["selection"] });
  const o = await chrome.storage.local.get("pageMode");
  chrome.contextMenus.create({ id: "hm-page", title: pageMenuTitle(o.pageMode), contexts: ["page"] });
}
const pageMenuTitle = (m) => (m === "bi" || m === "mo") ? "Хэлмэрч: орчуулгыг унтраах (Эх)" : "Хэлмэрч: хуудсыг орчуулах";
chrome.storage.onChanged.addListener((c) => {
  if (c.pageMode) chrome.contextMenus.update("hm-page", { title: pageMenuTitle(c.pageMode.newValue) }).catch(() => {});
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "hm-sel" && tab) {
    chrome.tabs.sendMessage(tab.id, { type: "ctxSel", text: info.selectionText || "" },
      { frameId: info.frameId || 0 }).catch(() => {});
  } else if (info.menuItemId === "hm-page") {
    const o = await chrome.storage.local.get(["pageMode", "lastMode"]);
    const on = o.pageMode === "bi" || o.pageMode === "mo";
    await chrome.storage.local.set(on ? { pageMode: "off", lastMode: o.pageMode } : { pageMode: o.lastMode || "bi" });
  }
});
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "settings") fetchSettings(); });

// ---------------------------------------------------------------- мессеж
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "start": {
          const id = sender.tab.id;
          const o = await chrome.storage.session.get(["m" + id, "s" + id, "h" + id]);
          sendResponse(await post("/start", { ...msg, page_url: sender.tab.url,
                                              media_urls: o["m" + id] || [], sub_urls: o["s" + id] || [],
                                              hint_urls: o["h" + id] || [] }));
          break;
        }
        case "poll": {
          const id = sender.tab ? sender.tab.id : -1;
          const o = await chrome.storage.session.get(["s" + id, "m" + id]);
          sendResponse(await post("/poll", { ...msg, sub_urls: o["s" + id] || [], media_urls: o["m" + id] || [] }));
          break;
        }
        case "translate":
          // AI сайжруулалт (quality) бүтэлгүйтвэл хурдан орчуулга харагдсаар байдаг тул цөөн оролдоно
          sendResponse(await post("/translate", { kind: msg.kind, texts: msg.texts, quality: msg.quality, context: msg.context,
                                                  remember: !!msg.remember },
                                  msg.quality ? 2 : 4));
          break;
        case "ocr":
          sendResponse(await post("/ocr", { image: msg.image }, 3));
          break;
        case "getSettings":
          sendResponse(await fetchSettings());
          break;
        case "saveSettings":
          await post("/settings", msg.update || {});
          sendResponse(await fetchSettings());
          break;
        case "showApp":
          sendResponse(await post("/show", {}));
          break;
        case "openPdf": {
          const tabId = msg.tabId ?? sender.tab.id;
          const k = "bypass" + tabId;
          const o = await chrome.storage.session.get(k);
          if (!msg.force && o[k] === msg.url) { sendResponse({ skipped: true }); break; }
          if (msg.url.startsWith("file:") && !(await chrome.extension.isAllowedFileSchemeAccess())) {
            sendResponse({ error: "nofile" });
            break;
          }
          await chrome.storage.session.remove(k);
          await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("pdf.html") + "?file=" + msg.url });
          sendResponse({ ok: true });
          break;
        }
        case "openOriginal":
          await openOriginal(sender.tab.id, msg.url);
          sendResponse({ ok: true });
          break;
        default:
          return; // бусад (жишээ нь хажуу самбарын) мессежид хариулахгүй
      }
    } catch (e) {
      sendResponse({ error: OFFLINE + " (Desktop дээрх Хэлмэрч товчлолоор асаана уу)" });
    }
  })();
  return ["start", "poll", "translate", "ocr", "getSettings", "saveSettings", "showApp", "openPdf", "openOriginal"].includes(msg.type);
});
