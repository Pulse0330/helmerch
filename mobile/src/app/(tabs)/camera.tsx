// Зураг: ном, дэлгэцийн зураг, скан PDF-ийг камераар авах эсвэл сангаас сонгоход Gemini уншиж орчуулна
// (компьютерын Ctrl+Alt+T-тэй ижил).
import { useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useKeys } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { ocrImage } from "@/lib/translator";
import { Btn, Card } from "@/components/ui";

type Res = { original: string; mongolian: string };

export default function Camera() {
  const t = useTheme();
  const k = useKeys();
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setNote(camera ? "Камерын зөвшөөрөл хэрэгтэй (утасны Тохиргоо → Хэлмэрч)." : "Зургийн сангийн зөвшөөрөл хэрэгтэй."); return; }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true, quality: 0.6 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.[0]?.base64) return;
    const a = r.assets[0];
    setImg(a.uri); setRes(null); setNote(""); setCopied(false); setBusy(true);
    const out = await ocrImage(a.base64!, a.mimeType || "image/jpeg");
    setBusy(false);
    if ("error" in out) setNote("Одоогоор уншиж чадсангүй — хэсэг хүлээгээд дахин оролдоно уу.");
    else if (!out.mongolian && !out.original) setNote("Зурган дээр текст олдсонгүй.");
    else setRes(out);
  };

  if (!k.gemini) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={[styles.h, { color: t.text }]}>Зургаас орчуулах</Text>
        <Text style={{ color: t.muted, textAlign: "center", marginBottom: 18 }}>
          Үүнд үнэгүй Gemini түлхүүр хэрэгтэй. Тохиргоо хэсэгт алхам алхмаар заавартай.
        </Text>
        <Btn primary label="Тохиргоо руу" onPress={() => router.navigate("/settings")} />
      </View>
    );
  }
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn primary label="📷 Зураг авах" onPress={() => run(true)} style={{ flex: 1 }} disabled={busy} />
        <Btn label="🖼 Сангаас" onPress={() => run(false)} style={{ flex: 1 }} disabled={busy} />
      </View>
      {!img && !note ? (
        <Text style={{ color: t.muted, textAlign: "center", marginTop: 24 }}>
          Ном, дэвтэр, дэлгэцийн зураг, скан PDF — зурган дээрх англи текстийг уншиж монгол руу орчуулна.
        </Text>
      ) : null}
      {img ? <Image source={{ uri: img }} style={styles.img} resizeMode="contain" /> : null}
      {busy ? (
        <View style={styles.row}><ActivityIndicator color={t.accent} /><Text style={{ color: t.muted }}>  Уншиж орчуулж байна… (5–20 сек)</Text></View>
      ) : null}
      {note ? <Text style={{ color: t.muted, textAlign: "center" }}>{note}</Text> : null}
      {res ? (
        <>
          <Card>
            <Text style={[styles.label, { color: t.muted }]}>МОНГОЛ</Text>
            <Text selectable style={{ color: t.text, fontSize: 16, lineHeight: 24 }}>{res.mongolian}</Text>
            <Btn label={copied ? "Хууллаа ✓" : "Хуулах"} style={{ marginTop: 12 }}
              onPress={async () => { await Clipboard.setStringAsync(res.mongolian); setCopied(true); }} />
          </Card>
          {res.original ? (
            <Card>
              <Text style={[styles.label, { color: t.muted }]}>ЭХ ТЕКСТ</Text>
              <Text selectable style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>{res.original}</Text>
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  h: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  img: { width: "100%", height: 220, borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 8 },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, marginBottom: 6 },
});
