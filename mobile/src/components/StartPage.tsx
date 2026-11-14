// Шинэ табын нүүр хуудас: хайх, хадгалсан хуудаснууд (★), сүүлд үзсэн түүх
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { clearHistory, hostOf, toUrl, useBrowser } from "@/lib/browser";
import { useTheme } from "@/lib/theme";

export function StartPage({ onOpen }: { onOpen: (url: string) => void }) {
  const t = useTheme();
  const { bookmarks, history } = useBrowser();
  const [q, setQ] = useState("");
  const go = () => { const u = toUrl(q); if (u) onOpen(u); };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 18, gap: 18 }} keyboardShouldPersistTaps="handled">
      <TextInput value={q} onChangeText={setQ} onSubmitEditing={go} placeholder="Хайх эсвэл хаяг бичих" placeholderTextColor={t.muted}
        autoCapitalize="none" autoCorrect={false} keyboardType="web-search" returnKeyType="go"
        style={[styles.search, { backgroundColor: t.card, color: t.text, borderColor: t.line }]} />
      <Text style={[styles.h, { color: t.muted }]}>ХАДГАЛСАН ХУУДАС</Text>
      <View style={styles.grid}>
        {bookmarks.map((b) => (
          <Pressable key={b.url} onPress={() => onOpen(b.url)} style={styles.bm} accessibilityRole="link">
            <View style={[styles.tile, { backgroundColor: t.accentSoft }]}>
              <Text style={{ color: t.accent, fontSize: 22, fontWeight: "700" }}>{(b.title || hostOf(b.url)).slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 12, textAlign: "center" }}>{b.title || hostOf(b.url)}</Text>
          </Pressable>
        ))}
      </View>
      {history.length ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[styles.h, { color: t.muted, flex: 1 }]}>СҮҮЛД ҮЗСЭН</Text>
            <Pressable onPress={clearHistory} hitSlop={8}><Text style={{ color: t.accent, fontSize: 13 }}>Цэвэрлэх</Text></Pressable>
          </View>
          <View style={[styles.list, { backgroundColor: t.card }]}>
            {history.slice(0, 12).map((h, i) => (
              <Pressable key={h.url} onPress={() => onOpen(h.url)} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 15 }}>{h.title}</Text>
                <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{hostOf(h.url)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  search: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  h: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  bm: { width: 72, alignItems: "center", gap: 6 },
  tile: { width: 60, height: 60, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  list: { borderRadius: 14, overflow: "hidden" },
  row: { paddingHorizontal: 14, paddingVertical: 11, gap: 2 },
});
