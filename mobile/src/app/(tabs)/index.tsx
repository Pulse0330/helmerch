// Хөтөч: апп доторх браузер — компьютерын өргөтгөлийн pagetr.js-ээр хуудсыг орчуулна
// (Эх / 2 хэл / Монгол, 📝 шалгалтын горим, нуугдсан тайлбар, дахин оролдлого — бүгд адилхан).
import { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewRef } from "@/web/WebView";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { settings, useSettings, type PageMode } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Chip, Seg } from "@/components/ui";
import { TrSheet, type SheetReq } from "@/components/TrSheet";
import { bridgeJs, PAGE_JS } from "@/web/inject";
import { pageStore, useBridge, type PageEvent } from "@/web/bridge";

// хаяг эсвэл хайлтын үг → URL
function toUrl(input: string) {
  const s = input.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return "https://" + s;
  return "https://www.google.com/search?q=" + encodeURIComponent(s);
}

export default function Browser() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const web = useRef<WebViewRef>(null);
  const [url, setUrl] = useState(s.home);
  const [input, setInput] = useState(s.home);
  const [nav, setNav] = useState({ back: false, fwd: false, loading: false });
  const [sheet, setSheet] = useState<SheetReq>(null);

  const onEvent = useCallback((e: PageEvent) => {
    if (e.kind === "sel" && typeof e.text === "string") setSheet({ text: e.text, word: false });
    if (e.kind === "word" && typeof e.word === "string") setSheet({ text: e.word, word: true });
  }, []);
  const onMessage = useBridge(web, onEvent);
  const closeSheet = useCallback(() => setSheet(null), []);

  // хуудас ачаалагдахаас өмнө оруулах chrome.* дуураймал (тохиргоо нь дараа нь мессежээр шинэчлэгдэнэ)
  const before = useMemo(() => bridgeJs(pageStore(settings.get())), []);

  // Android-ийн «буцах» товч → хуудасны түүхээр буцна
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (sheet) { setSheet(null); return true; }
      if (nav.back) { web.current?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [nav.back, sheet]));

  const go = () => { const u = toUrl(input); if (u) { setUrl(u); Keyboard.dismiss(); } };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={[styles.top, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <View style={styles.urlRow}>
          <Pressable onPress={() => web.current?.goBack()} disabled={!nav.back} hitSlop={8} accessibilityLabel="Буцах">
            <Ionicons name="chevron-back" size={24} color={nav.back ? t.text : t.line} />
          </Pressable>
          <Pressable onPress={() => web.current?.goForward()} disabled={!nav.fwd} hitSlop={8} accessibilityLabel="Урагшлах">
            <Ionicons name="chevron-forward" size={24} color={nav.fwd ? t.text : t.line} />
          </Pressable>
          <TextInput value={input} onChangeText={setInput} onSubmitEditing={go} selectTextOnFocus
            autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go"
            placeholder="Хаяг эсвэл хайх үг" placeholderTextColor={t.muted}
            style={[styles.url, { backgroundColor: t.field, color: t.text }]} />
          <Pressable onPress={() => (nav.loading ? web.current?.stopLoading() : web.current?.reload())} hitSlop={8}
            accessibilityLabel={nav.loading ? "Зогсоох" : "Дахин ачаалах"}>
            <Ionicons name={nav.loading ? "close" : "refresh"} size={22} color={t.text} />
          </Pressable>
        </View>
        <Seg<PageMode> value={s.pageMode} onChange={(v) => settings.set({ pageMode: v })}
          options={[["off", "Эх"], ["bi", "2 хэл"], ["mo", "Монгол"]]} />
        <View style={styles.chips}>
          <Chip label="📝 Шалгалт" on={s.examMode} onPress={() => settings.set({ examMode: !s.examMode })} />
          <Chip label="👆 Үг дээр дарах" on={s.wordTap} onPress={() => settings.set({ wordTap: !s.wordTap })} />
          <Chip label="🎬 Хадмал" on={s.subs} onPress={() => settings.set({ subs: !s.subs })} />
        </View>
      </View>

      <WebView
        ref={web}
        source={{ uri: url }}
        style={{ flex: 1, backgroundColor: t.bg }}
        injectedJavaScriptBeforeContentLoaded={before}
        injectedJavaScript={PAGE_JS}
        onMessage={onMessage}
        onNavigationStateChange={(n) => {
          setNav({ back: n.canGoBack, fwd: n.canGoForward, loading: n.loading });
          if (n.url && !n.loading) setInput(n.url);
        }}
        setSupportMultipleWindows={false}           // шинэ цонхоор нээх холбоосыг энд нь нээнэ
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        pullToRefreshEnabled={Platform.OS === "ios"}
        decelerationRate="normal"
      />
      <TrSheet req={sheet} onClose={closeSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  url: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
});
