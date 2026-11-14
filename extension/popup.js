// Хэлмэрч — өргөтгөлийн цэс
const $ = (s) => document.querySelector(s);
const HINT = {
  off: "Хуудсууд өөрчлөгдөхгүй, эх хэлээрээ харагдана.",
  bi: "Догол мөр бүрийн доор монгол орчуулга гарна. «Эх» сонгох хүртэл бүх хуудсанд хадгалагдана.",
  mo: "Хуудасны текст монголоор солигдоно. «Эх» сонгох хүртэл бүх хуудсанд хадгалагдана.",
};
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || {}); }));

let host = "", never = [];
function showMode(m) {
  m = ["bi", "mo"].includes(m) ? m : "off";
  document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  const off = host && never.includes(host);
  $("#modehint").textContent = off && m !== "off" ? `«${host}» дээр орчуулахгүй (доорх тэмдэглэгээг арилгавал орчуулна).` : HINT[m];
  $("#sty").classList.toggle("show", m === "bi");
  $("#uibox").hidden = m !== "bi";
  $("#exambox").hidden = m === "off";
  $("#sitebox").hidden = !host || m === "off";
}
function showStyle(st) {
  st = ["bg", "learn"].includes(st) ? st : "line";
  document.querySelectorAll("#style button").forEach((b) => b.classList.toggle("on", b.dataset.s === st));
}
document.querySelectorAll("#style button").forEach((b) => b.addEventListener("click", () => {
  chrome.storage.local.set({ trStyle: b.dataset.s });
  showStyle(b.dataset.s);
}));
$("#uitr").addEventListener("change", (e) => chrome.storage.local.set({ uiTr: e.target.checked }));
$("#exam").addEventListener("change", (e) => chrome.storage.local.set({ examMode: e.target.checked }));
$("#never").addEventListener("change", async (e) => {
  const set = new Set(never);
  if (e.target.checked) set.add(host); else set.delete(host);
  never = [...set];
  await chrome.storage.local.set({ neverSites: never });
  const o = await chrome.storage.local.get("pageMode");
  showMode(o.pageMode);
});
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, "");
  } catch (e) {}
  const o = await chrome.storage.local.get(["pageMode", "trStyle", "neverSites", "uiTr", "examMode"]);
  $("#uitr").checked = o.uiTr !== false;
  $("#exam").checked = !!o.examMode;
  never = o.neverSites || [];
  $("#sitetxt").textContent = `«${host}»-ийг хэзээ ч бүү орчуул`;
  $("#never").checked = never.includes(host);
  showStyle(o.trStyle);
  showMode(o.pageMode);
})();
document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => {
  chrome.storage.local.set(b.dataset.m === "off" ? { pageMode: "off" } : { pageMode: b.dataset.m, lastMode: b.dataset.m });
  showMode(b.dataset.m);
}));

let S = {};
async function loadSettings() {
  const s = await send({ type: "getSettings" });
  S = s || {};
  const online = !s.offline && !s.error;
  $("#st").className = "st " + (online ? "ok" : "bad");
  $("#st span").textContent = online ? "Ажиллаж байна" : "Асаагүй";
  $("#off").style.display = online ? "none" : "block";
  // шинэ хувилбар гарсан бол (сервер GitHub-аас шалгасан)
  try {
    const st = await (await fetch("http://127.0.0.1:8765/")).json();
    if (st.update) {
      const u = $("#upd");
      u.innerHTML = `Шинэ хувилбар <b>${String(st.update).replace(/[^\w.]/g, "")}</b> гарлаа — <a href="#" id="updgo">Хэлмэрч цонхноос шинэчлэх</a>`;
      u.style.display = "block";
      $("#updgo").onclick = async (e) => { e.preventDefault(); await send({ type: "showApp" }); window.close(); };
    }
  } catch (e) {}
  $("#ver").textContent = "v" + chrome.runtime.getManifest().version + " · монгол орчуулга";
  $("#hovsub").textContent = S.hover_mode === "always" ? "Хулганаа үг дээр аваачихад" : "Ctrl дараад хулганаа үг дээр";
  document.querySelectorAll("[data-s]").forEach((el) => {
    el.checked = S[el.dataset.s] !== false;
    el.disabled = !online;
  });
}
document.querySelectorAll("[data-s]").forEach((el) => el.addEventListener("change", async () => {
  const r = await send({ type: "saveSettings", update: { [el.dataset.s]: el.checked } });
  if (r.error) { el.checked = !el.checked; }
}));

$("#panel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { await chrome.sidePanel.open({ tabId: tab.id }); } catch (e) { await chrome.sidePanel.open({ windowId: tab.windowId }); }
  window.close();
});
$("#app").addEventListener("click", async () => { await send({ type: "showApp" }); window.close(); });
loadSettings();
