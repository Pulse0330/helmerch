// Сонгосон текст / дарсан үгийн орчуулгыг дэлгэцийн доод хэсэгт харуулна.
// Алдаа харуулахгүй: бүтэлгүйтвэл «Орчуулж байна…» хэвээр дахин оролдоод, болохгүй бол чимээгүй хаагдана.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/lib/theme";
import { rememberWord, type Alt } from "@/lib/store";
import { translateQuiet } from "@/web/bridge";

export type SheetReq = { text: string; word: boolean } | null;

// хүсэлт бүрд дотоод хэсгийг шинээр үүсгэнэ (key) — өмнөх үгийн төлөв үлдэхгүй
export function TrSheet({ req, onClose }: { req: SheetReq; onClose: () => void }) {
  if (!req) return null;
  return <Sheet key={(req.word ? "w:" : "t:") + req.text} req={req} onClose={onClose} />;
}

function Sheet({ req, onClose }: { req: NonNullable<SheetReq>; onClose: () => void }) {
  const t = useTheme();
  const [mn, setMn] = useState("");
  const [alts, setAlts] = useState<Alt[]>([]);
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const single = req.word || (!/\s/.test(req.text) && req.text.length < 40);

  useEffect(() => {
    let alive = true;
    (async () => {
      // үг: толь бичгийн утгууд; өгүүлбэр: эхлээд хурдан, дараа нь AI (мэргэжлийн)
      const r = await translateQuiet({ kind: single ? "word" : "text", texts: [req.text], quality: false, remember: single });
      if (!alive) return;
      const res = r.results?.[0];
      if (!res?.mn) { setBusy(false); onClose(); return; }
      setMn(res.mn); setAlts(res.alts || []); setBusy(false); setSaved(single);
      if (!single && !r.ai) {
        const q = await translateQuiet({ kind: "text", texts: [req.text], quality: true }, 1);
        if (alive && q.results?.[0]?.mn) setMn(q.results[0].mn);
      }
    })();
    return () => { alive = false; };
  }, [req, onClose, single]);

  return (
    <View style={[styles.sheet, { backgroundColor: t.card, borderColor: t.line }]}>
      <ScrollView style={{ maxHeight: 260 }}>
        <Text style={[styles.src, { color: t.muted }]} numberOfLines={single ? 1 : 4}>{req.text}</Text>
        {busy ? (
          <View style={styles.row}><ActivityIndicator color={t.accent} /><Text style={{ color: t.muted }}>  Орчуулж байна…</Text></View>
        ) : (
          <Text selectable style={[styles.mn, { color: t.text }]}>{mn}</Text>
        )}
        {alts.slice(0, 4).map((a) => (
          <Text key={a.pos} style={{ color: t.muted, marginTop: 4, fontSize: 13 }}>
            <Text style={{ color: t.accent }}>{a.pos} </Text>{a.terms.join(", ")}
          </Text>
        ))}
      </ScrollView>
      <View style={styles.bar}>
        <Pressable onPress={async () => { await Clipboard.setStringAsync(mn); setCopied(true); }} disabled={!mn}>
          <Text style={[styles.link, { color: t.accent }]}>{copied ? "Хууллаа ✓" : "Хуулах"}</Text>
        </Pressable>
        {single && mn ? (
          <Pressable onPress={() => { if (!saved) { rememberWord(req.text, mn); setSaved(true); } }}>
            <Text style={[styles.link, { color: saved ? t.ok : t.accent }]}>{saved ? "★ Миний үгсэд" : "☆ Хадгалах"}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} hitSlop={10}><Text style={[styles.link, { color: t.muted }]}>Хаах</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 10, right: 10, bottom: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14,
           shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  src: { fontSize: 13, marginBottom: 6 },
  mn: { fontSize: 17, lineHeight: 24 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  bar: { flexDirection: "row", gap: 18, marginTop: 12, alignItems: "center" },
  link: { fontSize: 14, fontWeight: "600" },
});
