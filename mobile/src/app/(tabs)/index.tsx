// Хөтөч: Safari шиг апп доторх браузер — олон таб, хадгалсан хуудас, түүх, нэвтэрсэн төлөв хадгалагдана,
// нууц үг хадгалж бөглөнө. Хуудсыг компьютерын өргөтгөлийн pagetr.js-ээр орчуулна (Эх / 2 хэл / Монгол, шалгалтын горим).
import { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { settings, useSettings, type PageMode } from "@/lib/store";
import { addHistory, hostOf, isBookmarked, toggleBookmark, toUrl, useBrowser } from "@/lib/browser";
import { getCred, saveCred, useSavedHosts } from "@/lib/passwords";
import { useTheme } from "@/lib/theme";
import { Chip, Seg } from "@/components/ui";
import { TrSheet, type SheetReq } from "@/components/TrSheet";
import { StartPage } from "@/components/StartPage";
import { WebView, type WebViewRef } from "@/web/WebView";
import { bridgeJs, fillCredJs, PAGE_JS } from "@/web/inject";
import { pageStore, useBridge, type PageEvent } from "@/web/bridge";

type Tab = { id: string; url: string | null; title: string };
type Nav = { url: string; title: string; back: boolean; fwd: boolean; loading: boolean };
let seq = 1;
const newTab = (url: string | null = null): Tab => ({ id: "t" + seq++, url, title: url ? hostOf(url) : "Нүүр" });

// нэг таб: өөрийн WebView, гүүр (орчуулга), нэвтрэлт — бусад табыг сольж байхад ч төлөвөө хадгална
function TabView({ tab, visible, onNav, onEvent, setRef }:
  { tab: Tab; visible: boolean; onNav: (id: string, n: Nav) => void; onEvent: (id: string, e: PageEvent) => void; setRef: (id: string, r: WebViewRef | null) => void }) {
  const t = useTheme();
  const web = useRef<WebViewRef>(null);
  const handle = useCallback((e: PageEvent) => onEvent(tab.id, e), [onEvent, tab.id]);
  const onMessage = useBridge(web, handle);
  const before = useMemo(() => bridgeJs(pageStore(settings.get())), []);
  if (!tab.url) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { display: visible ? "flex" : "none" }]}>
      <WebView
        ref={(r) => { web.current = r; setRef(tab.id, r); }}
        source={{ uri: tab.url }}
        style={{ flex: 1, backgroundColor: t.bg }}
        injectedJavaScriptBeforeContentLoaded={before}
        injectedJavaScript={PAGE_JS}
        onMessage={onMessage}
        onNavigationStateChange={(n) => onNav(tab.id, { url: n.url, title: n.title, back: n.canGoBack, fwd: n.canGoForward, loading: n.loading })}
        sharedCookiesEnabled            // нэвтэрсэн төлөв (cookie) хадгалагдана
        thirdPartyCookiesEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        pullToRefreshEnabled={Platform.OS === "ios"}
      />
    </View>
  );
}

export default function Browser() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  useBrowser();                                   // ★ өөрчлөгдөхөд шинэчлэгдэнэ
  const { hosts } = useSavedHosts();
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(null)]);
  const [active, setActive] = useState(tabs[0].id);
  const [navs, setNavs] = useState<Record<string, Nav>>({});
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [showTabs, setShowTabs] = useState(false);
  const [sheet, setSheet] = useState<SheetReq>(null);
  const [ask, setAsk] = useState<{ host: string; user: string; pass: string } | null>(null);
  const [pwHost, setPwHost] = useState<Record<string, string>>({});   // таб → нууц үгийн талбартай хост
  const refs = useRef<Record<string, WebViewRef | null>>({});

  const tab = tabs.find((x) => x.id === active) || tabs[0];
  const nav = navs[tab.id];
  const shownUrl = editing ? input : (nav?.url || tab.url || "");

  const setRef = useCallback((id: string, r: WebViewRef | null) => { refs.current[id] = r; }, []);
  const onNav = useCallback((id: string, n: Nav) => {
    setNavs((m) => ({ ...m, [id]: n }));
    if (!n.loading && n.url) {
      setTabs((ts) => ts.map((x) => (x.id === id ? { ...x, title: n.title || hostOf(n.url) } : x)));
      addHistory(n.url, n.title);
    }
  }, []);
  const onEvent = useCallback(async (id: string, e: PageEvent) => {
    if (e.kind === "sel" && typeof e.text === "string") setSheet({ text: e.text, word: false });
    if (e.kind === "word" && typeof e.word === "string") setSheet({ text: e.word, word: true });
    if (e.kind === "haspw" && typeof e.host === "string") setPwHost((m) => ({ ...m, [id]: e.has ? String(e.host) : "" }));
    if (e.kind === "cred" && typeof e.host === "string" && typeof e.pass === "string" && e.pass) {
      const old = await getCred(e.host);
      if (!old || old.pass !== e.pass || (e.user && old.user !== e.user)) setAsk({ host: e.host, user: String(e.user || ""), pass: e.pass });
    }
  }, []);

  const open = (raw: string) => {
    const u = toUrl(raw);
    if (!u) return;
    Keyboard.dismiss(); setEditing(false); setShowTabs(false);
    const r = refs.current[tab.id];
    if (tab.url && r) r.injectJavaScript(`location.href=${JSON.stringify(u)};true;`);
    else setTabs((ts) => ts.map((x) => (x.id === tab.id ? { ...x, url: u, title: hostOf(u) } : x)));
  };
  const addTab = () => { const n = newTab(null); setTabs((ts) => [...ts, n]); setActive(n.id); setShowTabs(false); };
  const closeTab = (id: string) => {
    setTabs((ts) => {
      const rest = ts.filter((x) => x.id !== id);
      const list = rest.length ? rest : [newTab(null)];
      if (id === active) setActive(list[list.length - 1].id);
      return list;
    });
    delete refs.current[id];
  };
  const fill = async () => {
    const host = pwHost[tab.id];
    const c = host ? await getCred(host) : null;
    if (c) refs.current[tab.id]?.injectJavaScript(fillCredJs(c.user, c.pass));
  };

  // Android-ийн «буцах» товч → хуудасны түүхээр буцна
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (sheet) { setSheet(null); return true; }
      if (showTabs) { setShowTabs(false); return true; }
      if (nav?.back) { refs.current[tab.id]?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [nav?.back, sheet, showTabs, tab.id]));

  const closeSheet = useCallback(() => setSheet(null), []);
  const starred = !!nav?.url && isBookmarked(nav.url);
  const canFill = !!pwHost[tab.id] && hosts.includes(pwHost[tab.id]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={[styles.top, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <View style={styles.urlRow}>
          <Pressable onPress={() => refs.current[tab.id]?.goBack()} disabled={!nav?.back} hitSlop={8} accessibilityLabel="Буцах">
            <Ionicons name="chevron-back" size={24} color={nav?.back ? t.text : t.line} />
          </Pressable>
          <Pressable onPress={() => refs.current[tab.id]?.goForward()} disabled={!nav?.fwd} hitSlop={8} accessibilityLabel="Урагшлах">
            <Ionicons name="chevron-forward" size={24} color={nav?.fwd ? t.text : t.line} />
          </Pressable>
          <TextInput value={shownUrl} onChangeText={(v) => { setEditing(true); setInput(v); }} onFocus={() => { setEditing(true); setInput(shownUrl); }}
            onBlur={() => setEditing(false)} onSubmitEditing={() => open(input)} selectTextOnFocus
            autoCapitalize="none" autoCorrect={false} keyboardType="web-search" returnKeyType="go"
            placeholder="Хайх эсвэл хаяг" placeholderTextColor={t.muted}
            style={[styles.url, { backgroundColor: t.field, color: t.text }]} />
          {tab.url ? (
            <Pressable onPress={() => nav?.url && toggleBookmark(nav.url, nav.title)} hitSlop={8} accessibilityLabel="Хуудсыг хадгалах">
              <Ionicons name={starred ? "star" : "star-outline"} size={21} color={starred ? t.accent : t.text} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => setShowTabs(!showTabs)} hitSlop={8} accessibilityLabel="Табууд" style={[styles.count, { borderColor: t.text }]}>
            <Text style={{ color: t.text, fontSize: 12, fontWeight: "700" }}>{tabs.length}</Text>
          </Pressable>
          {tab.url ? (
            <Pressable onPress={() => (nav?.loading ? refs.current[tab.id]?.stopLoading() : refs.current[tab.id]?.reload())} hitSlop={8}
              accessibilityLabel={nav?.loading ? "Зогсоох" : "Дахин ачаалах"}>
              <Ionicons name={nav?.loading ? "close" : "refresh"} size={21} color={t.text} />
            </Pressable>
          ) : null}
        </View>
        <Seg<PageMode> value={s.pageMode} onChange={(v) => settings.set({ pageMode: v })}
          options={[["off", "Эх"], ["bi", "2 хэл"], ["mo", "Монгол"]]} />
        <View style={styles.chips}>
          <Chip label="📝 Шалгалт" on={s.examMode} onPress={() => settings.set({ examMode: !s.examMode })} />
          <Chip label="👆 Үг дээр дарах" on={s.wordTap} onPress={() => settings.set({ wordTap: !s.wordTap })} />
          <Chip label="🎬 Хадмал" on={s.subs} onPress={() => settings.set({ subs: !s.subs })} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tabs.map((x) => (
          <TabView key={x.id} tab={x} visible={x.id === tab.id && !showTabs} onNav={onNav} onEvent={onEvent} setRef={setRef} />
        ))}
        {!tab.url && !showTabs ? <StartPage onOpen={open} /> : null}

        {showTabs ? (
          <ScrollView style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} contentContainerStyle={{ padding: 14, gap: 10 }}>
            {tabs.map((x) => (
              <Pressable key={x.id} onPress={() => { setActive(x.id); setShowTabs(false); }}
                style={[styles.tabCard, { backgroundColor: t.card, borderColor: x.id === tab.id ? t.accent : t.line }]}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{x.title}</Text>
                  <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{navs[x.id]?.url ? hostOf(navs[x.id].url) : x.url ? hostOf(x.url) : "Нүүр хуудас"}</Text>
                </View>
                <Pressable onPress={() => closeTab(x.id)} hitSlop={10} accessibilityLabel="Табыг хаах">
                  <Ionicons name="close" size={20} color={t.muted} />
                </Pressable>
              </Pressable>
            ))}
            <Pressable onPress={addTab} style={[styles.tabCard, { backgroundColor: t.accentSoft, borderColor: t.accentSoft, justifyContent: "center" }]}>
              <Ionicons name="add" size={20} color={t.accent} /><Text style={{ color: t.accent, fontWeight: "600" }}>Шинэ таб</Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {canFill && !showTabs && !ask ? (
          <Pressable onPress={fill} style={[styles.fill, { backgroundColor: t.accent }]} accessibilityRole="button">
            <Ionicons name="key" size={16} color="#fff" /><Text style={{ color: "#fff", fontWeight: "600" }}>Хадгалсан нэвтрэлтээр бөглөх</Text>
          </Pressable>
        ) : null}

        {ask ? (
          <View style={[styles.ask, { backgroundColor: t.card, borderColor: t.line }]}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>🔑 «{ask.host}»-ийн нэвтрэх мэдээллийг хадгалах уу?</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{ask.user ? ask.user + " · " : ""}Зөвхөн энэ утасны нууц санд хадгалагдана.</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
              <Pressable onPress={() => setAsk(null)} style={[styles.btn, { borderColor: t.line }]}><Text style={{ color: t.text }}>Үгүй</Text></Pressable>
              <Pressable onPress={async () => { await saveCred(ask.host, { user: ask.user, pass: ask.pass }); setAsk(null); }}
                style={[styles.btn, { backgroundColor: t.accent, borderColor: t.accent }]}><Text style={{ color: "#fff", fontWeight: "600" }}>Хадгалах</Text></Pressable>
            </View>
          </View>
        ) : null}
      </View>
      <TrSheet req={sheet} onClose={closeSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  url: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  count: { minWidth: 24, height: 24, borderWidth: 1.5, borderRadius: 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tabCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  fill: { position: "absolute", alignSelf: "center", bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999,
          shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  ask: { position: "absolute", left: 10, right: 10, bottom: 10, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 4,
         shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  btn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
});
