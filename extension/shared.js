/* Values shared by the service worker and the popup. The product name lives here and nowhere else. */

export const NAME = "Tacet";
export const DEFAULT_SERVER = "https://core-production-c5ac.up.railway.app";

/* Storage keys. */
export const SERVER_KEY = "serverUrl";
export const ENABLED_KEY = "enabledOrigins";

/* A "site" is an origin without its port: scheme + hostname. A match pattern for permissions is site + "/*". */
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.protocol + "//" + u.hostname;
  } catch (e) {
    return null;
  }
}

export function patternOf(site) {
  return site + "/*";
}

export function normalizeServer(value) {
  const v = (value || "").trim().replace(/\/+$/, "");
  return v || DEFAULT_SERVER;
}

export async function getSettings() {
  const got = await chrome.storage.local.get([SERVER_KEY, ENABLED_KEY]);
  return {
    serverUrl: normalizeServer(got[SERVER_KEY]),
    enabled: Array.isArray(got[ENABLED_KEY]) ? got[ENABLED_KEY] : [],
  };
}
