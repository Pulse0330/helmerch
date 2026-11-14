// Safari өргөтгөлд зориулсан `@/lib/store`-ийн орлуулагч (scripts/build-safari.mjs нь translator.ts-ийн "./store"-ийг үүгээр солино).
// Түлхүүр, тохиргоо, кэш — browser.storage.local-д (аппынхаас тусдаа; түлхүүрийг өргөтгөлийн цэсэнд оруулна).
declare const browser: any;

export type Alt = { pos: string; terms: string[] };
const st: Record<string, any> = { geminiKey: "", githubToken: "", quality: true, proTerms: true };

export async function loadState() {
  Object.assign(st, await browser.storage.local.get(["geminiKey", "githubToken", "quality", "proTerms", "trcache"]));
  if (st.trcache) for (const [k, v] of Object.entries(st.trcache)) cache.set(k, v as any);
}
browser.storage.onChanged.addListener((c: Record<string, { newValue: unknown }>) => {
  for (const k of Object.keys(c)) if (k !== "trcache") st[k] = c[k].newValue;
});

export const keys = { get: () => ({ gemini: String(st.geminiKey || ""), github: String(st.githubToken || "") }) };
export const settings = { get: () => ({ quality: st.quality !== false, proTerms: st.proTerms !== false }) };

// орчуулгын кэш: санах ойд + storage-д (өргөтгөлийн хадгалах хэмжээ бага тул 3000 мөр хүртэл)
const cache = new Map<string, { mn: string; alts?: Alt[] }>();
let saveT: ReturnType<typeof setTimeout> | null = null;
export const trCache = {
  get: (k: string) => cache.get(k),
  set(k: string, v: { mn: string; alts?: Alt[] }) {
    cache.set(k, v);
    while (cache.size > 3000) cache.delete(cache.keys().next().value as string);
    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(() => { browser.storage.local.set({ trcache: Object.fromEntries(cache) }).catch(() => {}); }, 2000);
  },
};

// «Миний үгс» нь утасны аппад л байна (Safari-ийн сонголт аппад хуваалцагдахгүй)
export function rememberWord(_w: string, _mn: string) {}
