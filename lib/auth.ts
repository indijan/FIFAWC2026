export const ACCESS_COOKIE_NAME = "wc26_access";

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.SITE_PASSWORD || "wc26-local-session";
}

function getConfiguredPassword() {
  return process.env.SITE_PASSWORD?.trim();
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getAccessToken() {
  const password = getConfiguredPassword();

  if (!password) {
    return null;
  }

  const payload = `${password}:${getSessionSecret()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(digest));
}

export function isPasswordConfigured() {
  return Boolean(getConfiguredPassword());
}

export function verifyPassword(password: string) {
  const configuredPassword = getConfiguredPassword();
  return Boolean(configuredPassword && password === configuredPassword);
}

