import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useTheme } from "@/lib/theme";

type Icon = keyof typeof Ionicons.glyphMap;
const TABS: [string, string, Icon, boolean][] = [
  ["index", "Хөтөч", "globe-outline", false],
  ["video", "Видео", "play-circle-outline", true],
  ["pdf", "PDF", "document-text-outline", true],
  ["camera", "Зураг", "camera-outline", true],
  ["words", "Миний үгс", "book-outline", true],
  ["settings", "Тохиргоо", "settings-outline", true],
];

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: t.accent, tabBarInactiveTintColor: t.muted,
      tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
      headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerShadowVisible: false,
    }}>
      {TABS.map(([name, title, icon, header]) => (
        <Tabs.Screen key={name} name={name} options={{
          title, headerShown: header,
          tabBarIcon: ({ color, size }) => <Ionicons name={icon} size={size} color={color as string} />,
        }} />
      ))}
    </Tabs>
  );
}
