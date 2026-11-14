// Видео: YouTube (эсвэл бусад сайтын) холбоосыг буулгахад видео апп дотор монгол хадмалтай тоглоно.
// YouTube апп → Share → Copy link → энд «Буулгах».
import { useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { settings } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Btn, Chip } from "@/components/ui";
import { WebView, type WebViewRef } from "@/web/WebView";
import { bridgeJs, PAGE_JS } from "@/web/inject";
import { pageStore, useBridge, type PageEvent } from "@/web/bridge";
import { VIDEO_BEFORE_JS, videoBothJs, videoSubsJs, youtubeId } from "@/web/video";

function toVideoUrl(link: string): string | null {
  const s = link.trim();
  const id = youtubeId(s);
  if (id) return `https://m.youtube.com/watch?v=${id}`;     // утасны YouTube — хадмалыг барьж чадна
  const m = s.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

export default function Video() {
  const t = useTheme();
  const web = useRef<WebViewRef>(null);
  const [input, setInput] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [both, setBoth] = useState(false);
  const [subsOn, setSubsOn] = useState(true);
  const [note, setNote] = useState("");

  const onEvent = useCallback((e: PageEvent) => {
    if (e.kind === "vstatus") setStatus(String(e.text || ""));
    if (e.kind === "vready") {
      setStatus(`✓ Хадмал бэлэн (${e.count} мөр)`);
      setTimeout(() => setStatus((s) => (s.startsWith("✓") ? "" : s)), 2500);
    }
    if (e.kind === "vnone") {
      // YouTube-д ч хадмал байхгүй видео (хадмалгүйгээр орчуулах арга алга)
      setStatus("Энэ видеонд хадмал олдсонгүй. Хадмалтай (CC) видео сонгоно уу.");
    }
  }, []);
  const onMessage = useBridge(web, onEvent, false);
  // видеоны хуудсыг өөрийг нь орчуулахгүй (pageMode: off), зөвхөн хадмал
  const before = useMemo(() => bridgeJs({ ...pageStore(settings.get()), pageMode: "off", subs: false }) + VIDEO_BEFORE_JS, []);

  const open = (link: string) => {
    const u = toVideoUrl(link);
    if (!u) { setNote("Видеоны холбоос олдсонгүй. YouTube → Share → Copy link хийгээд дахин оролдоно уу."); return; }
    Keyboard.dismiss();
    setNote(""); setStatus("Видео ачаалж байна… ▶ дарж тоглуулна уу.");
    setUrl(u);
  };
  const paste = async () => {
    const s = await Clipboard.getStringAsync();
    setInput(s);
    open(s);
  };

  if (!url) {
    return (
      <View style={[styles.wrap, { backgroundColor: t.bg }]}>
        <Text style={[styles.h, { color: t.text }]}>Видеог монгол хадмалтай үзэх</Text>
        <Text style={{ color: t.muted, marginBottom: 16, lineHeight: 20 }}>
          YouTube апп → <Text style={{ fontWeight: "700" }}>Share</Text> → <Text style={{ fontWeight: "700" }}>Copy link</Text> хийгээд доорх товчийг дарна.
        </Text>
        <Btn primary label="📋 Хуулсан холбоосыг нээх" onPress={paste} />
        <Text style={{ color: t.muted, textAlign: "center", marginVertical: 14 }}>эсвэл</Text>
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => open(input)}
          placeholder="https://youtu.be/…" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" returnKeyType="go"
          style={[styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.line }]} />
        <Btn label="Нээх" onPress={() => open(input)} style={{ marginTop: 10 }} disabled={!input.trim()} />
        {note ? <Text style={{ color: t.muted, marginTop: 14 }}>{note}</Text> : null}
        <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 24, lineHeight: 18 }}>
          Видеог бүтэн дэлгэцээр биш, апп дотор нь үзнэ үү — бүтэн дэлгэцэд iPhone өөрийн тоглуулагч руу шилжиж монгол хадмал харагдахгүй.
        </Text>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={[styles.bar, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <Chip label="← Өөр видео" on={false} onPress={() => { setUrl(null); setStatus(""); setSubsOn(true); setBoth(false); }} />
        <Chip label={subsOn ? "МН хадмал: асаалттай" : "МН хадмал асаах"} on={subsOn}
          onPress={() => { setSubsOn(!subsOn); web.current?.injectJavaScript(videoSubsJs(!subsOn)); }} />
        {subsOn ? <Chip label="Англи хамт" on={both} onPress={() => { setBoth(!both); web.current?.injectJavaScript(videoBothJs(!both)); }} /> : null}
      </View>
      {status ? <Text style={[styles.status, { backgroundColor: t.accentSoft, color: t.text }]}>{status}</Text> : null}
      <WebView
        ref={web}
        source={{ uri: url }}
        style={{ flex: 1, backgroundColor: "#000" }}
        injectedJavaScriptBeforeContentLoaded={before}
        injectedJavaScript={PAGE_JS}
        onMessage={onMessage}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, justifyContent: "center" },
  h: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  bar: { flexDirection: "row", gap: 8, padding: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  status: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 6 },
});
