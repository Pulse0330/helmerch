// Хэлмэрчийн өнгө (компьютерын тохиргооны цонхтой ижил) — гэрэлтэй / харанхуй горим
import { useColorScheme } from "react-native";

const light = {
  bg: "#f4f5f8", card: "#ffffff", text: "#1b1f2a", muted: "#6b7385", line: "#e6e8ef",
  accent: "#1565c0", accentSoft: "#e3edfb", ok: "#1f9d55", field: "#f6f7fa", danger: "#c0392b",
};
const dark: typeof light = {
  bg: "#16181d", card: "#1f2229", text: "#eceef3", muted: "#9aa2b2", line: "#2d313b",
  accent: "#5c9bff", accentSoft: "#1c2a44", ok: "#3fbf7f", field: "#272a33", danger: "#ff7b6b",
};
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);
