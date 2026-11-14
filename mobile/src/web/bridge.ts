// WebView-ээс ирсэн мессежийг боловсруулна: орчуулгын хүсэлт → translator, тохиргоо → store.
import { useCallback, useEffect, type RefObject } from "react";
import type { WebViewMessageEvent, WebViewRef } from "./WebView";
import { settings, type Settings } from "@/lib/store";
import { translate, translateAI, type TrResult } from "@/lib/translator";
import { toPage } from "./inject";

// хуудсанд харагдах тохиргоо (pagetr.js-ийн chrome.storage.local-тай ижил нэрс)
export function pageStore(s: Settings) {
  return { pageMode: s.pageMode, trStyle: s.trStyle, uiTr: s.uiTr, examMode: s.examMode,
           wordTap: s.wordTap, subs: s.subs, settings: { quality: s.quality } };
}
const PAGE_KEYS = ["pageMode", "trStyle", "uiTr", "examMode", "wordTap", "subs"] as const;

// алдааг хэрэглэгчид харуулахгүй: хэд хэдэн удаа чимээгүй дахин оролдоно
export async function translateQuiet(msg: Parameters<typeof translate>[0], tries = 3): Promise<TrResult> {
  let r: TrResult = { error: "x" };
  for (let i = 0; i < tries; i++) {
    try { r = await translate(msg); } catch { r = { error: "x" }; }
    if (!r.error) return r;
    await new Promise((res) => setTimeout(res, [800, 2000, 4000][i] || 4000));
  }
  return r;
}

export type PageEvent = { kind: "sel"; text: string } | { kind: "word"; word: string } | { kind: string; [k: string]: unknown };

// sync=false: тохиргооны өөрчлөлтийг энэ хуудсанд дамжуулахгүй (жишээ нь видеоны дэлгэц өөрийн тохиргоотой)
export function useBridge(ref: RefObject<WebViewRef | null>, onEvent?: (e: PageEvent) => void, sync = true) {
  // тохиргоо өөрчлөгдөхөд нээлттэй хуудсанд шууд мэдэгдэнэ (дахин ачаалахгүй)
  useEffect(() => {
    if (!sync) return;
    let prev = pageStore(settings.get());
    return settings.subscribe(() => {
      const next = pageStore(settings.get()), diff: Record<string, unknown> = {};
      for (const k of Object.keys(next) as (keyof typeof next)[]) {
        if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) diff[k] = next[k];
      }
      prev = next;
      if (Object.keys(diff).length) ref.current?.injectJavaScript(toPage({ kind: "store", data: diff }));
    });
  }, [ref, sync]);

  return useCallback(async (e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m?.kind === "req") {
      const msg = m.msg || {};
      let data: unknown = {};
      if (msg.type === "translateAI") {
        try { data = await translateAI(msg.texts || [], msg.context, msg.prefer); } catch { data = { error: "x", reason: "other" }; }
      }
      if (msg.type === "translate") {
        data = await translateQuiet({ kind: msg.kind, texts: msg.texts || [], quality: msg.quality, context: msg.context, remember: msg.remember, fast: msg.fast, prefer: msg.prefer });
      }
      ref.current?.injectJavaScript(toPage({ kind: "resp", id: m.id, data }));
    } else if (m?.kind === "set") {
      const patch: Partial<Settings> = {};
      for (const k of PAGE_KEYS) if (k in (m.data || {})) (patch as any)[k] = m.data[k];
      if (Object.keys(patch).length) settings.set(patch);
    } else if (m && onEvent) {
      onEvent(m);
    }
  }, [ref, onEvent]);
}
