import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Token storage, per platform.
 *
 * expo-secure-store does NOT work on web in SDK 57 — calling getItemAsync
 * there throws `getValueWithKeyAsync is not a function`. mobile/CLAUDE.md
 * claimed it "falls back to localStorage"; it does not, and that claim had
 * never been exercised because the app had never actually been run. The web
 * preview hung on the splash spinner forever as a result.
 *
 * Native keeps SecureStore (keychain/keystore — a bearer token should not sit
 * in plain storage on a real device). Web uses localStorage, which is the
 * right call there precisely because web is a preview surface, not a shipped
 * target: no real customer token lives in a browser.
 *
 * Every call is failure-tolerant. A read that throws returns null and a write
 * that throws is swallowed, because the alternative — seen live — is an
 * unhandled rejection inside the auth bootstrap that leaves the app on a
 * spinner with no error and no way to sign in.
 */
const webStore = {
  async getItemAsync(k: string) {
    try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; }
  },
  async setItemAsync(k: string, v: string) {
    try { globalThis.localStorage?.setItem(k, v); } catch {}
  },
  async deleteItemAsync(k: string) {
    try { globalThis.localStorage?.removeItem(k); } catch {}
  },
};

const nativeStore = {
  async getItemAsync(k: string) {
    try { return await SecureStore.getItemAsync(k); } catch { return null; }
  },
  async setItemAsync(k: string, v: string) {
    try { await SecureStore.setItemAsync(k, v); } catch {}
  },
  async deleteItemAsync(k: string) {
    try { await SecureStore.deleteItemAsync(k); } catch {}
  },
};

export const tokenStore = Platform.OS === "web" ? webStore : nativeStore;
