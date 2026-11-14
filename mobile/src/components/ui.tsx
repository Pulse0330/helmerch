// Жижиг дахин ашиглагдах UI хэсгүүд
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";

export function Seg<T extends string>({ value, options, onChange, style }:
  { value: T; options: [T, string][]; onChange: (v: T) => void; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: t.field }, style]}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={[styles.segBtn, on && { backgroundColor: t.card, shadowOpacity: 0.12 }]}>
            <Text style={{ color: on ? t.text : t.muted, fontWeight: on ? "600" : "400", fontSize: 13 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}
      style={[styles.chip, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accentSoft : "transparent" }]}>
      <Text style={{ color: on ? t.accent : t.muted, fontSize: 12.5, fontWeight: on ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

export function Btn({ label, onPress, primary, disabled, style }:
  { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [styles.btn, {
        backgroundColor: primary ? t.accent : t.card, borderColor: primary ? t.accent : t.line,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      }, style]}>
      <Text style={{ color: primary ? "#fff" : t.text, fontWeight: "600", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  seg: { flexDirection: "row", borderRadius: 10, padding: 3, gap: 2 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 8, shadowColor: "#000", shadowOpacity: 0, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  btn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  card: { borderRadius: 14, padding: 14 },
});
