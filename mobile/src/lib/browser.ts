// Хөтчийн хадгалалт: хадгалсан хуудас (★), түүх — утасны дотоод JSON файлд.
// Нэвтэрсэн төлөв (cookie) нь WebView-ийн өөрийн санд хадгалагдана (апп хаагдсан ч үлдэнэ).
import { useSyncExternalStore } from "react";
import { createStore, jsonFile } from "./store";

export type Site = { url: string; title: string };
type State = { bookmarks: Site[]; history: (Site & { at: number })[] };

const DEFAULT_BOOKMARKS: Site[] = [
  { url: "https://www.google.com", title: "Google" },
  { url: "https://www.pmi.org", title: "PMI" },
  { url: "https://m.youtube.com", title: "YouTube" },
  { url: "https://en.wikipedia.org", title: "Wikipedia" },
];

const file = jsonFile<State>("browser.json", { bookmarks: DEFAULT_BOOKMARKS, history: [] });
export const browser = createStore<State>(file.load());
browser.subscribe(() => file.save(browser.get));
export const useBrowser = () => useSyncExternalStore(browser.subscribe, browser.get);

const same = (a: string, b: string) => a.replace(/\/$/, "") === b.replace(/\/$/, "");
export const isBookmarked = (url: string) => browser.get().bookmarks.some((b) => same(b.url, url));

export function toggleBookmark(url: string, title: string) {
  const list = browser.get().bookmarks;
  browser.set({ bookmarks: isBookmarked(url) ? list.filter((b) => !same(b.url, url)) : [{ url, title: title || url }, ...list].slice(0, 60) });
}

export function addHistory(url: string, title: string) {
  if (!/^https?:/.test(url)) return;
  const h = browser.get().history.filter((x) => !same(x.url, url));
  browser.set({ history: [{ url, title: title || url, at: Date.now() }, ...h].slice(0, 200) });
}

export const clearHistory = () => browser.set({ history: [] });

// хаяг эсвэл хайлтын үг → URL
export function toUrl(input: string) {
  const s = input.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return "https://" + s;
  return "https://www.google.com/search?q=" + encodeURIComponent(s);
}

export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
