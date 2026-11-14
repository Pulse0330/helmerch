// Сайтын нэвтрэх мэдээлэл: зөвхөн энэ утасны нууц санд (iOS Keychain / Android Keystore) хадгалагдана.
// Хэзээ ч өөр газар илгээгдэхгүй, JSON файлд бичигдэхгүй. Хэрэглэгч «Хадгалах» гэж зөвшөөрсөн үед л.
import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { createStore } from "./store";

export type Cred = { user: string; pass: string };
const INDEX = "helmerch_pw_index";
// SecureStore-ийн түлхүүрт зөвхөн үсэг, тоо, «.», «-», «_» зөвшөөрөгдөнө
const keyOf = (host: string) => "helmerch_pw_" + host.toLowerCase().replace(/[^a-z0-9.\-_]/g, "_");

export const savedHosts = createStore<{ hosts: string[] }>({ hosts: [] });
export const useSavedHosts = () => useSyncExternalStore(savedHosts.subscribe, savedHosts.get);

export async function loadPasswordIndex() {
  try { savedHosts.set({ hosts: JSON.parse((await SecureStore.getItemAsync(INDEX)) || "[]") }); } catch { /* хоосон */ }
}
async function writeIndex(hosts: string[]) {
  savedHosts.set({ hosts });
  await SecureStore.setItemAsync(INDEX, JSON.stringify(hosts));
}

export async function getCred(host: string): Promise<Cred | null> {
  if (!savedHosts.get().hosts.includes(host)) return null;
  try { return JSON.parse((await SecureStore.getItemAsync(keyOf(host))) || "null"); } catch { return null; }
}

export async function saveCred(host: string, cred: Cred) {
  await SecureStore.setItemAsync(keyOf(host), JSON.stringify(cred));
  const hosts = savedHosts.get().hosts;
  if (!hosts.includes(host)) await writeIndex([...hosts, host].sort());
}

export async function deleteCred(host: string) {
  await SecureStore.deleteItemAsync(keyOf(host)).catch(() => {});
  await writeIndex(savedHosts.get().hosts.filter((h) => h !== host));
}
