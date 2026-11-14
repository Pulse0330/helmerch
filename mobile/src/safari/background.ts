// Safari өргөтгөлийн background: pagetr.js / tip.js-ийн орчуулгын хүсэлтийг аппын translator.ts-ээр биелүүлнэ.
// (компьютерын өргөтгөлийн background.js-ийн утсан дээрх хувилбар — Python сервергүй.)
import { loadState } from "./store-shim";
import { translate, testProvider } from "../lib/translator";

declare const browser: any;
const ready = loadState().catch(() => {});

async function handle(msg: any) {
  await ready;
  if (msg?.type === "translate") {
    // алдааг харуулахгүй: хэд хэдэн удаа чимээгүй дахин оролдоно
    for (let i = 0; i < 3; i++) {
      try {
        const r = await translate({ kind: msg.kind, texts: msg.texts || [], quality: msg.quality, context: msg.context });
        if (!r.error) return r;
      } catch { /* дахин */ }
      await new Promise((res) => setTimeout(res, [800, 2000, 4000][i]));
    }
    return { error: "busy" };
  }
  if (msg?.type === "test") return testProvider(msg.name);
  if (msg?.type === "getSettings") return {};
  return undefined;
}

browser.runtime.onMessage.addListener((msg: any, _sender: unknown, sendResponse: (r: unknown) => void) => {
  handle(msg).then((r) => sendResponse(r ?? {})).catch(() => sendResponse({ error: "x" }));
  return true;    // хариуг асинхроноор илгээнэ
});
