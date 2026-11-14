// Хэлмэрч — хажуу самбар: идэвхтэй хуудсыг догол мөр бүрээр орчуулж харуулна
const $ = (id) => document.getElementById(id);
const list = $("list"), status = $("status");
const PDF_VIEWER = chrome.runtime.getURL("pdf.html");
let current = { tabId: null, url: "", blocks: [], cards: [] };
let runId = 0;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || {}); }));

try {
  if (localStorage.getItem("showsrc") === "0") $("showsrc").checked = false;
} catch (e) {}
$("showsrc").onchange = () => {
  try { localStorage.setItem("showsrc", $("showsrc").checked ? "1" : "0"); } catch (e) {}
  list.querySelectorAll(".card").forEach((c) => c.classList.toggle("hidesrc", !$("showsrc").checked));
};

function note(html) {
  list.innerHTML = `<div class="note">${html}</div>`;
  $("better").disabled = true;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function run() {
  const my = ++runId;
  const tab = await activeTab();
  if (!tab) return;
  current = { tabId: tab.id, url: tab.url || "", blocks: [], cards: [] };
  $("title").textContent = tab.title || "Монгол орчуулга";
  status.textContent = "";
  $("better").disabled = true;

  if (current.url.startsWith(PDF_VIEWER)) {
    note("Энэ PDF орчуулагч үзүүлэгчээр нээгдсэн байна. Хуудас бүрийн <b>хажууд</b> орчуулга харагдана " +
         "(дээд талын <b>“Орчуулга”</b> товчоор асаах/унтраах).");
    return;
  }
  if (!/^(https?|file):/.test(current.url)) {
    note("Энэ хуудсыг орчуулах боломжгүй (Chrome-ийн дотоод хуудас).");
    return;
  }

  status.textContent = "Хуудсын текстийг уншиж байна…";
  let data;
  try {
    data = await chrome.tabs.sendMessage(tab.id, { type: "extract" }, { frameId: 0 });
  } catch (e) {
    data = null;
  }
  if (my !== runId) return;
  const looksPdf = /\.pdf(\?|#|$)/i.test(current.url) || (data && data.isPdf);
  if (!data || !data.blocks || (looksPdf && !data.blocks.length)) {
    const fileNoAccess = current.url.startsWith("file:") && !(await chrome.extension.isAllowedFileSchemeAccess());
    let html = looksPdf ? "Энэ бол PDF файл байна. Орчуулагч үзүүлэгчээр нээхэд хуудас бүрийн хажууд орчуулга гарна."
                        : "Энэ хуудаснаас текст уншиж чадсангүй (хуудсыг refresh хийх хэрэгтэй байж магадгүй).";
    if (fileNoAccess) {
      html = "Компьютер дээрх файлыг уншихын тулд нэг удаа зөвшөөрөл өгнө үү:<br>" +
        "<b>chrome://extensions</b> → Хэлмэрч → <b>Details</b> → <b>Allow access to file URLs</b>-ийг асаана.";
    }
    note(html + `<br><button id="openpdf" class="primary">PDF орчуулагчаар нээх</button>` +
      `<button id="reload">Хуудсыг refresh хийх</button>`);
    $("openpdf").onclick = async () => {
      const r = await send({ type: "openPdf", tabId: tab.id, url: current.url, force: true });
      if (r && r.error === "nofile") status.textContent = "“Allow access to file URLs”-ийг асаана уу (дээрх заавар).";
    };
    $("reload").onclick = () => chrome.tabs.reload(tab.id);
    status.textContent = "";
    return;
  }
  if (!data.blocks.length) { note("Орчуулах текст олдсонгүй."); status.textContent = ""; return; }

  current.blocks = data.blocks;
  list.innerHTML = "";
  const hide = !$("showsrc").checked;
  current.cards = data.blocks.map((b) => {
    const c = document.createElement("div");
    c.className = "card" + (/^h[1-6]$/.test(b.tag) ? " h" : "") + (hide ? " hidesrc" : "");
    c.innerHTML = `<div class="src">${esc(b.text)}</div><div class="mn">…</div>`;
    c.onclick = () => b.id && chrome.tabs.sendMessage(tab.id, { type: "scrollTo", id: b.id }, { frameId: 0 }).catch(() => {});
    list.appendChild(c);
    return c;
  });

  // хурдан (Google) орчуулга
  const N = 40;
  for (let i = 0; i < current.blocks.length; i += N) {
    if (my !== runId) return;
    status.textContent = `Орчуулж байна… ${Math.min(i + N, current.blocks.length)}/${current.blocks.length}`;
    const msg = { type: "translate", kind: "text", quality: false, texts: current.blocks.slice(i, i + N).map((b) => b.text) };
    let r = await send(msg);
    // алдааг харуулахгүй — хэсэг хүлээгээд чимээгүй дахин оролдоно
    for (let k = 0; k < 4 && (r.error || !r.results); k++) {
      await new Promise((res) => setTimeout(res, 3000 * (k + 1)));
      if (my !== runId) return;
      r = await send(msg);
    }
    if (my !== runId) return;
    if (r.error || !r.results) { status.textContent = "Орчуулж байна…"; setTimeout(() => { if (my === runId) run(); }, 20000); return; }
    r.results.forEach((res, k) => { current.cards[i + k].querySelector(".mn").textContent = res.mn || ""; });
  }
  status.textContent = `${current.blocks.length} хэсэг орчуулагдлаа`;
  $("better").disabled = false;
  const s = await send({ type: "getSettings" });
  if (my === runId && (!s || s.quality !== false)) improve();
}

async function improve() {
  const my = runId;
  $("better").disabled = true;
  const N = 20;
  for (let i = 0; i < current.blocks.length; i += N) {
    if (my !== runId) return;
    status.textContent = `AI мэргэжлийн орчуулга хийж байна… ${Math.min(i + N, current.blocks.length)}/${current.blocks.length}`;
    const r = await send({ type: "translate", kind: "text", quality: true,
                           texts: current.blocks.slice(i, i + N).map((b) => b.text), context: $("title").textContent });
    if (my !== runId) return;
    if (r.error || !r.results) { status.textContent = `${current.blocks.length} хэсэг орчуулагдлаа`; $("better").disabled = false; return; }
    r.results.forEach((res, k) => {
      const mn = current.cards[i + k].querySelector(".mn");
      mn.innerHTML = esc(res.mn || "") + '<span class="q">✨</span>';
    });
  }
  status.textContent = "Мэргэжлийн орчуулга ✨";
}

$("go").onclick = run;
$("better").onclick = improve;

// таб солих / хуудас ачаалагдах үед автоматаар
let timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 400); };
chrome.tabs.onActivated.addListener(schedule);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === current.tabId && info.status === "complete") schedule();
});
run();
