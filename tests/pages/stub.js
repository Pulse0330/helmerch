// Тестийн хуудсуудад зориулсан chrome.* API-ийн дуураймал.
// Орчуулга = "MN:" + текст. "Flaky" гэж эхэлсэн текст эхний 2 удаа хоосон хариу авна (дахин оролдлогыг шалгах).
// Хуудас window.HM_STORE-оор анхны тохиргоог өгнө. window.__calls = орчуулгын хүсэлтүүд.
(() => {
  const listeners = [];
  const store = Object.assign({ pageMode: "bi", uiTr: true, settings: { quality: false } }, window.HM_STORE || {});
  let flaky = 0;
  window.__calls = [];
  window.chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      sendMessage(msg, cb) {
        setTimeout(() => {
          if (msg.type !== "translate") return cb({});
          window.__calls.push(msg.texts.slice());
          cb({ results: msg.texts.map((t) => (t.startsWith("Flaky") && flaky++ < 2 ? { mn: "" } : { mn: "MN:" + t })),
               tier: "google", ai: false });
        }, 30);
      },
    },
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (o) => {
          const c = {};
          for (const k in o) { c[k] = { oldValue: store[k], newValue: o[k] }; store[k] = o[k]; }
          listeners.forEach((f) => f(c));
        },
      },
      onChanged: { addListener: (f) => listeners.push(f) },
    },
  };
  // туслахууд: tr(id) = орчуулгын текст ("" бол орчуулагдаагүй), ui(id) = цэс гэж ангилсан эсэх
  window.tr = (id) => { const e = document.getElementById(id); return e ? e.getAttribute("data-hm-tr") || "" : null; };
  window.ui = (id) => { const e = document.getElementById(id); return !!(e && e.hasAttribute("data-hm-ui")); };
  // шалгалт: check([[нөхцөл, "тайлбар"], ...]) → body[data-result] = "PASS" эсвэл "FAIL: ..."
  window.check = (list) => {
    const bad = list.filter(([ok]) => !ok).map(([, why]) => why);
    document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
  };
})();
