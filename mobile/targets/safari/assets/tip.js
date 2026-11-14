// Хэлмэрч (Safari, iPhone): текстийг удаан дарж сонгоход доод хэсэгт монгол орчуулга харуулна.
// Хуудсанд элемент нэмэхдээ shadow DOM ашиглана (сайтын хэв маяг эвдрэхгүй). Алдаа харуулахгүй — бүтэлгүйтвэл чимээгүй хаагдана.
(() => {
  if (window.__hmTip || window !== window.top) return;
  window.__hmTip = true;
  const api = typeof browser !== "undefined" ? browser : chrome;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let host = null, root = null, seq = 0, last = "";
  function panel() {
    if (host) return;
    host = document.createElement("hm-tip");
    host.style.cssText = "all:initial;position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;display:none";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .p{background:#1f2430;color:#f2f4f8;border-radius:16px;padding:12px 14px;font:15px/1.45 -apple-system,system-ui,sans-serif;
         box-shadow:0 10px 30px rgba(0,0,0,.35);max-height:42vh;overflow:auto;-webkit-user-select:text;user-select:text}
      .s{color:#98a2b6;font-size:12.5px;margin-bottom:6px;max-height:3.2em;overflow:hidden}
      .m{font-size:16.5px}.w{color:#98a2b6}
      .b{display:flex;gap:18px;margin-top:10px;font-size:14px;font-weight:600}
      .b span{color:#8fbcff}
    </style><div class="p"><div class="s"></div><div class="m"></div><div class="b"><span data-a="copy">Хуулах</span><span data-a="close">Хаах</span></div></div>`;
    root.querySelector('[data-a="close"]').addEventListener("click", hide);
    root.querySelector('[data-a="copy"]').addEventListener("click", (e) => {
      navigator.clipboard.writeText(root.querySelector(".m").textContent || "").then(() => { e.target.textContent = "Хууллаа ✓"; }).catch(() => {});
    });
    document.documentElement.appendChild(host);
  }
  function hide() { if (host) host.style.display = "none"; last = ""; }
  function show(src, mn) {
    panel();
    root.querySelector(".s").textContent = src;
    root.querySelector(".m").innerHTML = mn ? esc(mn) : '<span class="w">Орчуулж байна…</span>';
    root.querySelector('[data-a="copy"]').textContent = "Хуулах";
    host.style.display = "block";
  }

  let t = 0;
  document.addEventListener("selectionchange", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const sel = window.getSelection();
      if (sel && host && sel.anchorNode && host.contains(sel.anchorNode)) return;
      const text = sel ? String(sel).replace(/\s+/g, " ").trim() : "";
      if (!text || text === last || text.length < 2 || text.length > 3000 || !/\p{L}/u.test(text)) return;
      last = text;
      const my = ++seq, single = !/\s/.test(text) && text.length < 40;
      show(text, "");
      try {
        const r = await api.runtime.sendMessage({ type: "translate", kind: single ? "word" : "text", texts: [text], quality: !single });
        const mn = r && r.results && r.results[0] && r.results[0].mn;
        if (my !== seq) return;
        if (mn) show(text, mn); else hide();
      } catch (e) { if (my === seq) hide(); }
    }, 700);
  });
})();
