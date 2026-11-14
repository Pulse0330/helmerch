import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { loadKeys } from "@/lib/store";

export default function RootLayout() {
  useEffect(() => { loadKeys(); }, []);    // AI түлхүүрүүдийг Keychain/Keystore-оос уншина
  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
