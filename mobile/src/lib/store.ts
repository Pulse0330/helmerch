// Аппын хадгалалт: тохиргоо, «Миний үгс», орчуулгын кэш — утасны дотоод файлд (JSON).
// AI түлхүүрүүд тусдаа: expo-secure-store (iOS Keychain / Android Keystore) — хэзээ ч JSON файлд бүү хадгал.
import { useSyncExternalStore } from "react";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------- JSON файл
export function jsonFile<T>(name: string, fallback: T) {
  const file = new File(Paths.document, name);
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    load(): T {
      try {
        if (file.exists) return { ...fallback, ...JSON.parse(file.textSync()) };
      } catch {
        // эвдэрсэн файл — анхны утгаар эхэлнэ
      }
      return fallback;
    },
    // олон удаа дараалан бичихгүй — 1.5 секундын дотор нэг удаа
    save(get: () => unknown) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          if (!file.exists) file.create();
          file.writeSync(JSON.stringify(get()));
        } catch {
          // дараагийн удаа дахин оролдоно
        }
      }, 1500);
    },
  };
}

// ---------------------------------------------------------------- энгийн дэлгүүр (React-д холбогдоно)
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => { subs.delete(f); };
    },
  };
}

// ---------------------------------------------------------------- тохиргоо
export type PageMode = "off" | "bi" | "mo";
export type Settings = {
  pageMode: PageMode;      // вэб хуудас: Эх / 2 хэл / Монгол
  trStyle: "line" | "bg" | "learn";
  uiTr: boolean;           // цэс, товчийг ч орчуулах
  examMode: boolean;       // 📝 шалгалтын горим
  wordTap: boolean;        // үг дээр дарахад орчуулах (холбоосоор шилжихгүй)
  subs: boolean;           // видео хадмал (сайт хадмалтай бол)
  quality: boolean;        // мэргэжлийн (AI) орчуулга
  proTerms: boolean;       // нэр томьёог хаалтанд англиар
  home: string;
};
const SETTINGS_DEFAULT: Settings = {
  pageMode: "bi", trStyle: "line", uiTr: true, examMode: false, wordTap: false, subs: false,
  quality: true, proTerms: true, home: "https://www.google.com",
};
const settingsFile = jsonFile("settings.json", SETTINGS_DEFAULT);
export const settings = createStore<Settings>(settingsFile.load());
settings.subscribe(() => settingsFile.save(settings.get));
export const useSettings = () => useSyncExternalStore(settings.subscribe, settings.get);

// ---------------------------------------------------------------- AI түлхүүрүүд (Keychain / Keystore)
// Gemini түлхүүр 3 хүртэл: нэгнийх нь үнэгүй хязгаар дүүрвэл дараагийнх руу шилжинэ (хүсэлтүүдийг хооронд нь хуваана)
export type KeyName = "gemini" | "gemini2" | "gemini3" | "github";
export const GEMINI_SLOTS: KeyName[] = ["gemini", "gemini2", "gemini3"];
const KEY_ID: Record<KeyName, string> = {
  gemini: "helmerch_gemini_key", gemini2: "helmerch_gemini_key2", gemini3: "helmerch_gemini_key3", github: "helmerch_github_token",
};
export const keys = createStore<Record<KeyName, string>>({ gemini: "", gemini2: "", gemini3: "", github: "" });
export const useKeys = () => useSyncExternalStore(keys.subscribe, keys.get);
export async function loadKeys() {
  const names = Object.keys(KEY_ID) as KeyName[];
  const vals = await Promise.all(names.map((n) => SecureStore.getItemAsync(KEY_ID[n]).catch(() => null)));
  keys.set(Object.fromEntries(names.map((n, i) => [n, vals[i] || ""])) as Record<KeyName, string>);
}
export async function saveKey(name: KeyName, value: string) {
  const v = value.trim();
  if (v) await SecureStore.setItemAsync(KEY_ID[name], v);
  else await SecureStore.deleteItemAsync(KEY_ID[name]);
  keys.set({ [name]: v } as Partial<Record<KeyName, string>>);
}

// ---------------------------------------------------------------- миний үгс
export type Word = { k: string; w: string; mn: string; n: number; learned: boolean; first: number; last: number };
const wordsFile = jsonFile<{ items: Record<string, Word> }>("words.json", { items: {} });
export const words = createStore(wordsFile.load());
words.subscribe(() => wordsFile.save(words.get));
export const useWords = () => useSyncExternalStore(words.subscribe, words.get);
const WORD_RE = /^[A-Za-z][A-Za-z'\-]{1,40}$/;

export function rememberWord(word: string, mn: string) {
  word = word.trim();
  if (!mn || !WORD_RE.test(word)) return;
  const k = word.toLowerCase(), now = Date.now();
  const items = { ...words.get().items };
  const e = items[k] || { k, w: word, mn, n: 0, learned: false, first: now, last: now };
  items[k] = { ...e, mn: mn.slice(0, 200), n: e.n + 1, last: now, learned: e.n > 0 ? false : e.learned };
  const list = Object.values(items);
  if (list.length > 3000) delete items[list.sort((a, b) => a.last - b.last)[0].k];
  words.set({ items });
}
export function updateWord(k: string, patch: { learned?: boolean; delete?: boolean }) {
  const items = { ...words.get().items };
  if (!items[k]) return;
  if (patch.delete) delete items[k];
  else items[k] = { ...items[k], learned: !!patch.learned };
  words.set({ items });
}

// ---------------------------------------------------------------- орчуулгын кэш (зөвхөн AI орчуулга)
const cacheFile = jsonFile<{ items: Record<string, { mn: string; alts?: Alt[] }> }>("translations.json", { items: {} });
const cache = new Map(Object.entries(cacheFile.load().items));
export type Alt = { pos: string; terms: string[] };
export const trCache = {
  get: (k: string) => cache.get(k),
  set(k: string, v: { mn: string; alts?: Alt[] }) {
    cache.set(k, v);
    while (cache.size > 20000) cache.delete(cache.keys().next().value as string);   // хамгийн хуучнаас нь
    cacheFile.save(() => ({ items: Object.fromEntries(cache) }));
  },
};
