// Миний үгс: хайсан үгсийн жагсаалт + давтах карт (компьютерын «Миний үгс»-тэй ижил)
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { updateWord, useWords, type Word } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Btn, Seg } from "@/components/ui";

type Filter = "todo" | "done" | "all";

export default function Words() {
  const t = useTheme();
  const { items } = useWords();
  const all = useMemo(() => Object.values(items).sort((a, b) => b.last - a.last), [items]);
  const [filter, setFilter] = useState<Filter>("todo");
  const [deck, setDeck] = useState<Word[] | null>(null);
  const list = all.filter((w) => filter === "all" || (filter === "todo" ? !w.learned : w.learned));
  const todo = all.filter((w) => !w.learned);

  const startCards = () => {
    // олон удаа хайсан (хэцүү) үгс түрүүнд, бусад нь холилдсон
    setDeck([...todo].map((w) => ({ w, r: Math.random() - Math.min(w.n, 5) / 5 })).sort((a, b) => a.r - b.r).map((x) => x.w).slice(0, 20));
  };

  if (deck) return <Cards deck={deck} onExit={() => setDeck(null)} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 12, gap: 10 }}>
        <Btn primary label={todo.length ? `Давтах (${Math.min(20, todo.length)} үг)` : "Давтах үг алга"} onPress={startCards} disabled={!todo.length} />
        <Seg<Filter> value={filter} onChange={setFilter}
          options={[["todo", `Давтах (${todo.length})`], ["done", `Сурсан (${all.length - todo.length})`], ["all", "Бүгд"]]} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(w) => w.k}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
        ListEmptyComponent={
          <Text style={{ color: t.muted, textAlign: "center", marginTop: 40, paddingHorizontal: 20 }}>
            {all.length ? "Энд үг алга" : "Хөтөч дээр «👆 Үг дээр дарах»-ыг асаагаад үг дээр дарах, эсвэл үг сонгоход энд хадгалагдана."}
          </Text>
        }
        renderItem={({ item: w }) => (
          <View style={[styles.item, { backgroundColor: t.card }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: w.learned ? t.muted : t.text, fontWeight: "600", fontSize: 16, textDecorationLine: w.learned ? "line-through" : "none" }}>{w.w}</Text>
              <Text style={{ color: t.muted }} numberOfLines={2}>{w.mn}{w.n > 1 ? ` · ${w.n} удаа` : ""}</Text>
            </View>
            <Pressable onPress={() => updateWord(w.k, { learned: !w.learned })} hitSlop={6}
              accessibilityLabel={w.learned ? "Давтах руу буцаах" : "Сурсан"}
              style={[styles.ic, { borderColor: w.learned ? t.ok : t.line }]}>
              <Text style={{ color: w.learned ? t.ok : t.muted }}>✓</Text>
            </Pressable>
            <Pressable onPress={() => updateWord(w.k, { delete: true })} hitSlop={6} accessibilityLabel="Устгах"
              style={[styles.ic, { borderColor: t.line }]}>
              <Text style={{ color: t.muted }}>×</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

function Cards({ deck: initial, onExit }: { deck: Word[]; onExit: () => void }) {
  const t = useTheme();
  const [deck, setDeck] = useState(initial);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);

  if (i >= deck.length) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ fontSize: 22, color: t.text, fontWeight: "700", marginBottom: 20 }}>Болоо! {initial.length} үг давтлаа 👏</Text>
        <Btn primary label="Жагсаалт руу" onPress={onExit} />
      </View>
    );
  }
  const w = deck[i];
  const next = () => { setI(i + 1); setShown(false); };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: 16 }}>
      <Pressable onPress={() => setShown(true)} style={[styles.card, { backgroundColor: t.card }]} accessibilityRole="button">
        <Text style={{ fontSize: 30, fontWeight: "700", color: t.text }}>{w.w}</Text>
        {shown ? <Text style={{ fontSize: 19, color: t.accent, marginTop: 16, textAlign: "center" }}>{w.mn}</Text>
               : <Text style={{ color: t.muted, marginTop: 16 }}>Утгыг нь санаад, дарж шалгана уу</Text>}
      </Pressable>
      {shown ? (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Btn label="Дахин давтана" style={{ flex: 1 }} onPress={() => { setDeck([...deck, w]); next(); }} />
          <Btn primary label="Мэдэж байна ✓" style={{ flex: 1 }} onPress={() => { updateWord(w.k, { learned: true }); next(); }} />
        </View>
      ) : (
        <Btn primary label="Утгыг харах" style={{ marginTop: 14 }} onPress={() => setShown(true)} />
      )}
      <Text style={{ color: t.muted, textAlign: "center", marginTop: 12 }}>{i + 1} / {deck.length}</Text>
      <Pressable onPress={onExit} style={{ alignSelf: "center", marginTop: 16 }} hitSlop={10}>
        <Text style={{ color: t.muted }}>Дуусгах</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, marginBottom: 8 },
  ic: { width: 34, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { flex: 1, maxHeight: 360, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 24 },
});
