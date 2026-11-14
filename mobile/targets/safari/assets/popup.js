// Хэлмэрч Safari өргөтгөлийн цэс: горим (pagetr.js-ийн chrome.storage.local-тай ижил нэрс), шалгалтын горим, түлхүүрүүд
const api = typeof browser !== "undefined" ? browser : chrome;
const $ = (s) => document.querySelector(s);

function showMode(m) {
  document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
}
document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => {
  api.storage.local.set({ pageMode: b.dataset.m });
  showMode(b.dataset.m);
}));
$("#exam").addEventListener("change", (e) => api.storage.local.set({ examMode: e.target.checked }));
$("#uitr").addEventListener("change", (e) => api.storage.local.set({ uiTr: e.target.checked }));
$("#save").addEventListener("click", async () => {
  const upd = {};
  const g = $("#gemini").value.trim(), h = $("#github").value.trim();
  if (g) upd.geminiKey = g;
  if (h) upd.githubToken = h;
  await api.storage.local.set(upd);
  $("#gemini").value = ""; $("#github").value = "";
  $("#saved").textContent = " Хадгалагдлаа ✓";
  load();
});

async function load() {
  const o = await api.storage.local.get(["pageMode", "examMode", "uiTr", "geminiKey", "githubToken"]);
  showMode(o.pageMode || "off");
  $("#exam").checked = !!o.examMode;
  $("#uitr").checked = o.uiTr !== false;
  $("#gemini").placeholder = o.geminiKey ? "Gemini — •••• хадгалсан" : "Gemini түлхүүр (AIza…)";
  $("#github").placeholder = o.githubToken ? "GitHub — •••• хадгалсан" : "GitHub токен (github_pat_…)";
}
load();
