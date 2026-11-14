import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { loadKeys } from "@/lib/store";
import { loadPasswordIndex } from "@/lib/passwords";

export default function RootLayout() {
  // AI түлхүүрүүд, хадгалсан нэвтрэлтийн жагсаалтыг Keychain/Keystore-оос уншина
  useEffect(() => { loadKeys(); loadPasswordIndex(); }, []);
  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
