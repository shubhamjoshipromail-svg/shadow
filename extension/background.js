/* Tacet service worker — decides where Mira is allowed to appear and injects the
 * companion + observer into those pages (MAIN world).
 *
 * Why MAIN world: the observer (observe.js) and the companion (capture.js) must see the
 * page's real DOM and share the page's window, the same way an observed app loads them.
 *
 * Why the service worker injects instead of a declarative content script: host access is
 * opt-in per site, so there is no `content_scripts` block to register for the whole web.
 * The worker mirrors the injection on real navigations, SPA route changes and reloads.
 */

import { NAME, ENABLED_KEY, SERVER_KEY, siteOf, patternOf, normalizeServer } from "./shared.js";

/* Injected in order. The companion owns watch mode and pins observer events to
 * its session. wire.js only requests that connection; it never bypasses it. */
const INJECT_FILES = [
  "injected/loader.js",
  "vendor/capture.js",
  "vendor/observe.js",
  "injected/wire.js",
];

async function settings() {
  const got = await chrome.storage.local.get([SERVER_KEY, ENABLED_KEY]);
  return {
    serverUrl: normalizeServer(got[SERVER_KEY]),
    enabled: Array.isArray(got[ENABLED_KEY]) ? got[ENABLED_KEY] : [],
  };
}

async function canScript(site) {
  try {
    return await chrome.permissions.contains({ origins: [patternOf(site)] });
  } catch (e) {
    return false;
  }
}

async function inject(tabId, serverUrl) {
  const target = { tabId, frameIds: [0] };

  // The companion derives its API origin from window.SHADOW_API; set it before the bundle runs.
  await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (api, name) => {
      window.SHADOW_API = api;
      window.SHADOW_NAME = name;
    },
    args: [serverUrl, "Mira"],  // the companion on the page is Mira; the product is Tacet
  });

  // One file per call guarantees the companion is ready before observer wiring.
  for (const file of INJECT_FILES) {
    await chrome.scripting.executeScript({ target, world: "MAIN", files: [file] });
  }
}

/* Injects only when the user has turned Mira on for this site and Chrome has granted access. */
async function maybeInject(tabId, url) {
  const site = siteOf(url);
  if (!site) return false;
  const { serverUrl, enabled } = await settings();
  if (!enabled.includes(site)) return false;
  if (!(await canScript(site))) return false;
  try {
    await inject(tabId, serverUrl);
    return true;
  } catch (e) {
    // The tab may have gone away mid-navigation; the next navigation tries again.
    return false;
  }
}

/* Re-inject on navigations, SPA route changes and reloads. In-page guards make repeats cheap. */
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab && tab.url) maybeInject(tabId, tab.url);
});

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0 && d.url) maybeInject(d.tabId, d.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId === 0 && d.url) maybeInject(d.tabId, d.url);
});

/* The popup asks for an immediate injection right after a site is turned on. */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "inject" && typeof msg.tabId === "number") {
    maybeInject(msg.tabId, msg.url || "").then(
      (ok) => sendResponse({ ok }),
      (e) => sendResponse({ ok: false, error: String(e) })
    );
    return true; // async response
  }
  return false;
});
