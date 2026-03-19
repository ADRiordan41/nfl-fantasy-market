import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "matchupmarket_access_token";

export async function getAuthToken() {
  return (await SecureStore.getItemAsync(TOKEN_KEY)) ?? "";
}

export async function setAuthToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearAuthToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
