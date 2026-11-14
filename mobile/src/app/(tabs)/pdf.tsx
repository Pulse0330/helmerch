// PDF: утсан дээрх PDF-ийг сонгоод хуудас бүрийн доор монгол орчуулгыг харуулна.
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewRef } from "@/web/WebView";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { settings } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Btn, Chip } from "@/components/ui";
import { bridgeJs } from "@/web/inject";
import { pageStore, useBridge } from "@/web/bridge";
import { PDF_VIEWER_HTML } from "@/web/pdfViewer";

const CHUNK = 400_000;   // WebView руу нэг удаад дамжуулах base64 хэмжээ

export default function Pdf() {
  const t = useTheme();
  const web = useRef<WebViewRef>(null);
  const onMessage = useBridge(web);
  const [doc, setDoc] = useState<{ name: string; b64: string; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState({ img: true, src: true });
  const before = useMemo(() => bridgeJs(pageStore(settings.get())), []);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    setBusy(true);
    try {
      const b64 = await new File(r.assets[0].uri).base64();
      setDoc({ name: r.assets[0].name || "PDF", b64, key: Date.now() });
    } catch {
      setDoc(null);
    } finally {
      setBusy(false);
    }
  };

  // үзүүлэгч ачаалагдмагц PDF-ийг хэсэгчлэн дамжуулна
  const send = useCallback(() => {
    if (!doc || !web.current) return;
    for (let i = 0; i < doc.b64.length; i += CHUNK) {
      web.current.injectJavaScript(`window.__pdfChunk(${JSON.stringify(doc.b64.slice(i, i + CHUNK))});true;`);
    }
    web.current.injectJavaScript(`window.__pdfEnd(${JSON.stringify(doc.name)});true;`);
  }, [doc]);

  const toggle = (k: "img" | "src") => {
    const v = { ...view, [k]: !view[k] };
    setView(v);
    web.current?.injectJavaScript(`window.__pdfView(${JSON.stringify(v)});true;`);
  };

  if (!doc) {
    return (
      <View style={[styles.empty, { backgroundColor: t.bg }]}>
        <Text style={[styles.h, { color: t.text }]}>PDF орчуулах</Text>
        <Text style={{ color: t.muted, textAlign: "center", marginBottom: 20 }}>
          Хичээлийн PDF-ээ сонгоход хуудас бүрийн доор монгол орчуулга гарна.{"\n"}Эхлээд хурдан, дараа нь AI-аар (✨) сайжирна.
        </Text>
        {busy ? <ActivityIndicator color={t.accent} /> : <Btn primary label="PDF сонгох" onPress={pick} />}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.bar, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontWeight: "600" }}>{doc.name}</Text>
        <Chip label="Зураг" on={view.img} onPress={() => toggle("img")} />
        <Chip label="Эх текст" on={view.src} onPress={() => toggle("src")} />
        <Chip label="Өөр PDF" on={false} onPress={pick} />
      </View>
      <WebView
        key={doc.key}
        ref={web}
        source={{ html: PDF_VIEWER_HTML, baseUrl: "https://helmerch.local/" }}
        originWhitelist={["*"]}
        injectedJavaScriptBeforeContentLoaded={before}
        onMessage={onMessage}
        onLoadEnd={send}
        style={{ flex: 1, backgroundColor: t.bg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  h: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
