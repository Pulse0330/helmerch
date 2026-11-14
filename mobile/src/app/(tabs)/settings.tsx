// Тохиргоо: AI түлхүүрүүд (алхам алхмаар заавартай), орчуулгын сонголтууд
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { saveKey, settings, useKeys, useSettings, type KeyName } from "@/lib/store";
import { useTheme, type Theme } from "@/lib/theme";
import { testProvider } from "@/lib/translator";
import { Btn, Card } from "@/components/ui";
import { EXTENSION_VERSION } from "@/web/extension.generated";

const GUIDES: Record<KeyName, { title: string; url: string; open: string; steps: string[] }> = {
  gemini: {
    title: "Gemini түлхүүр (үнэгүй)", url: "https://aistudio.google.com/apikey", open: "Google AI Studio-г нээх",
    steps: [
      "Доорх товчоор Google AI Studio-г нээж, Google (Gmail) бүртгэлээрээ нэвтэрнэ.",
      "Анх удаа бол нөхцөлийг зөвшөөрөөд (☑) Continue дарна.",
      "Create API key товчийг дарна. Төсөл сонгох цонх гарвал Create key.",
      "Гарч ирсэн AIza… гэж эхэлсэн түлхүүрийг Copy дарж хуулна.",
      "Энд буцаж ирээд доорх нүдэнд буулгаж Хадгалах, дараа нь Шалгах дарна.",
    ],
  },
  github: {
    title: "Copilot (GitHub) токен", url: "https://github.com/settings/personal-access-tokens/new", open: "GitHub-ийг нээх",
    steps: [
      "Доорх товчоор GitHub-ийг нээж нэвтэрнэ (бүртгэлгүй бол Sign up — үнэгүй).",
      "Token name хэсэгт Helmerch гэж бичнэ. Expiration — хамгийн урт хугацааг сонгоно.",
      "Permissions хэсгээс Models-ийг олж Read-only болгоно (харагдахгүй бол Add permissions → Models).",
      "Хамгийн доор Generate token → дахин Generate token дарна.",
      "github_pat_… токеныг хуулна (зөвхөн нэг удаа харагдана!), энд буулгаж Хадгалах → Шалгах.",
    ],
  },
};

function KeyBox({ name, t }: { name: KeyName; t: Theme }) {
  const k = useKeys();
  const g = GUIDES[name];
  const [val, setVal] = useState("");
  const [open, setOpen] = useState(!k[name]);
  const [busy, setBusy] = useState(false);
  const set = !!k[name];

  const test = async () => {
    setBusy(true);
    const r = await testProvider(name === "github" ? "Copilot" : "Gemini");
    setBusy(false);
    Alert.alert(r.ok ? "Ажиллаж байна ✓" : "Ажиллахгүй байна", r.msg);
  };
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: t.text, fontWeight: "600", fontSize: 15 }}>{g.title}</Text>
        <Text style={{ color: set ? t.ok : t.muted, fontSize: 13 }}>{set ? "✓ хадгалсан" : "оруулаагүй"}</Text>
      </View>
      <Pressable onPress={() => setOpen(!open)}>
        <Text style={{ color: t.accent, fontWeight: "600" }}>{open ? "▾ Заавар нуух" : "▸ Хэрхэн авах вэ (алхам алхмаар)"}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 6 }}>
          {g.steps.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={[styles.n, { backgroundColor: t.accent }]}>{i + 1}</Text>
              <Text style={{ flex: 1, color: t.text, lineHeight: 20 }}>{s}</Text>
            </View>
          ))}
          <Btn label={g.open + " →"} onPress={() => Linking.openURL(g.url)} />
        </View>
      ) : null}
      <TextInput value={val} onChangeText={setVal} secureTextEntry autoCapitalize="none" autoCorrect={false}
        placeholder={set ? "•••••••• (хадгалсан) — солих бол шинээр оруулна" : name === "gemini" ? "AIza…" : "github_pat_…"}
        placeholderTextColor={t.muted} style={[styles.input, { backgroundColor: t.field, color: t.text, borderColor: t.line }]} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn primary label="Хадгалах" style={{ flex: 1 }} disabled={!val.trim()}
          onPress={async () => { await saveKey(name, val); setVal(""); setOpen(false); }} />
        {busy ? <ActivityIndicator color={t.accent} style={{ paddingHorizontal: 18 }} />
              : <Btn label="Шалгах" onPress={test} disabled={!set} />}
        {set ? <Btn label="Устгах" onPress={() => Alert.alert("Түлхүүрийг устгах уу?", "", [
          { text: "Болих", style: "cancel" }, { text: "Устгах", style: "destructive", onPress: () => saveKey(name, "") }])} /> : null}
      </View>
    </Card>
  );
}

function Row({ title, sub, value, onChange, t }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void; t: Theme }) {
  return (
    <View style={[styles.row, { borderTopColor: t.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 15 }}>{title}</Text>
        {sub ? <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent }} />
    </View>
  );
}

export default function SettingsScreen() {
  const t = useTheme();
  const s = useSettings();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Text style={[styles.h2, { color: t.muted }]}>AI ТҮЛХҮҮРҮҮД</Text>
      <Text style={{ color: t.muted, marginTop: -6 }}>
        Заавал биш, гэхдээ орчуулга маш их сайжирна. Түлхүүрүүд зөвхөн таны утасны нууц санд (Keychain) хадгалагдана.
      </Text>
      <KeyBox name="gemini" t={t} />
      <KeyBox name="github" t={t} />

      <Text style={[styles.h2, { color: t.muted }]}>ОРЧУУЛГА</Text>
      <Card style={{ paddingVertical: 4 }}>
        <Row t={t} title="Мэргэжлийн (AI) орчуулга" sub="Copilot эсвэл Gemini — PMP гэх мэт мэргэжлийн текстэд"
          value={s.quality} onChange={(v) => settings.set({ quality: v })} />
        <Row t={t} title="Нэр томьёог хаалтанд англиар" sub="жишээ нь: оролцогч тал (stakeholder)"
          value={s.proTerms} onChange={(v) => settings.set({ proTerms: v })} />
        <Row t={t} title="Цэс, товчийг ч орчуулах" sub="«2 хэл» горимд жижиг үсгээр"
          value={s.uiTr} onChange={(v) => settings.set({ uiTr: v })} />
      </Card>

      <Text style={[styles.h2, { color: t.muted }]}>SAFARI-Д ОРЧУУЛАХ</Text>
      <Card style={{ gap: 6 }}>
        {[
          "iPhone-ий Тохиргоо → Апп → Safari → Өргөтгөлүүд (Extensions) → Хэлмэрч → асаана.",
          "Мөн тэнд «Бүх вэб сайт» (All Websites) → Зөвшөөрөх.",
          "Safari-д хаягийн мөрний «аА» (эсвэл 🧩) товч → Хэлмэрч → 2 хэл / Монгол.",
          "Сайн чанарын орчуулгад өргөтгөлийн цэсний «AI түлхүүрүүд»-д түлхүүрээ тусад нь оруулна.",
        ].map((s, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8 }}>
            <Text style={[styles.n, { backgroundColor: t.accent }]}>{i + 1}</Text>
            <Text style={{ flex: 1, color: t.text, lineHeight: 20 }}>{s}</Text>
          </View>
        ))}
        <Text style={{ color: t.muted, fontSize: 12.5 }}>Текстийг удаан дарж сонгоход доод хэсэгт орчуулга гарна. (Expo Go-д биш, суулгасан Хэлмэрч апп дээр ажиллана.)</Text>
      </Card>

      <Text style={{ color: t.muted, textAlign: "center", fontSize: 12, marginTop: 8 }}>
        Хэлмэрч {Constants.expoConfig?.version} · хуудас орчуулагч v{EXTENSION_VERSION}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, marginTop: 6 },
  n: { color: "#fff", width: 22, height: 22, borderRadius: 11, textAlign: "center", lineHeight: 22, fontSize: 12, overflow: "hidden" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
