// Хөтчийн нэвтрэлт: маягт таних (haspw), нэвтрэхэд нэр/нууц үг апп руу очих (cred),
// хоёр шаттай нэвтрэлт (эхлээд имэйл), хадгалсан мэдээллээр бөглөх (fillCredJs).
import { writeFileSync } from "node:fs";
import { bridgeJs, fillCredJs, PAGE_JS } from "../src/web/inject";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script>window.__events = []; window.ReactNativeWebView = { postMessage(s) { const m = JSON.parse(s); if (m.kind !== "req") __events.push(m); } };</script>
<script>${bridgeJs({ pageMode: "off", settings: { quality: false } })}</script>
</head><body>
<form id="f1" onsubmit="event.preventDefault()"><input id="u1" type="email"><input id="p1" type="password"><button id="b1">Sign in</button></form>
<div id="step2" hidden><input id="e2" type="email" name="identifier"><button id="n2" type="button">Next</button><input id="p2" type="password" style="display:none"><button id="b2" type="button">Sign in</button></div>
<form id="f3"><input id="u3" type="text"><input id="p3" type="password"></form>
<script>${PAGE_JS.replace(/<\/script>/g, "<\\/script>")}</script>
<script>
const $ = (id) => document.getElementById(id);
const type = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
setTimeout(() => { type($("u1"), "bold@mail.mn"); type($("p1"), "secret-1"); $("b1").click(); }, 1500);
// хоёр шаттай: имэйл → Next → нууц үг
setTimeout(() => { $("f1").remove(); $("step2").hidden = false; type($("e2"), "two@mail.mn"); $("n2").click(); $("e2").style.display = "none"; $("p2").style.display = ""; }, 2500);
setTimeout(() => { type($("p2"), "secret-2"); $("b2").click(); }, 3000);
// хадгалсан нэвтрэлтээр бөглөх
setTimeout(() => { eval(${JSON.stringify(fillCredJs("filled@mail.mn", "pw-3"))}); }, 3500);
setTimeout(() => {
  const creds = __events.filter((e) => e.kind === "cred").map((e) => e.user + ":" + e.pass);
  const bad = [];
  if (!__events.some((e) => e.kind === "haspw" && e.has)) bad.push("нууц үгийн талбар мэдэгдээгүй");
  if (!creds.includes("bold@mail.mn:secret-1")) bad.push("энгийн нэвтрэлт: " + JSON.stringify(creds));
  if (!creds.includes("two@mail.mn:secret-2")) bad.push("хоёр шаттай нэвтрэлт: " + JSON.stringify(creds));
  if ($("p2").value !== "pw-3" && $("p3").value !== "pw-3") bad.push("бөглөсөнгүй");
  document.body.setAttribute("data-result", bad.length ? "FAIL: " + bad.join("; ") : "PASS");
}, 5000);
</script></body></html>`;
writeFileSync(process.argv[2], html);
