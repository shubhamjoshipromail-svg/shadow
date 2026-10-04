/* Tacet popup logic — server URL, the per-site switch, and the list of sites Mira is on for. */

import { SERVER_KEY, ENABLED_KEY, siteOf, patternOf, normalizeServer } from "../shared.js";

const $ = (id) => document.getElementById(id);
const state = { site: null, tab: null, enabled: [], serverUrl: "", busy: false };

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  state.site = siteOf(tab && tab.url);

  const got = await chrome.storage.local.get([SERVER_KEY, ENABLED_KEY]);
  state.serverUrl = normalizeServer(got[SERVER_KEY]);
  state.enabled = Array.isArray(got[ENABLED_KEY]) ? got[ENABLED_KEY] : [];

  $("server").value = state.serverUrl;
  $("version").textContent = "v" + chrome.runtime.getManifest().version;
  $("notebook").href = state.serverUrl + "/";
  render();
}

function render() {
  renderSite();
  renderSites();
}

function renderSite() {
  const on = !!state.site && state.enabled.includes(state.site);
  $("site").textContent = state.site || "Not a web page";
  $("toggle").disabled = !state.site;
  $("toggle").setAttribute("aria-checked", String(on));
  $("tglabel").textContent = on ? "Mira is on for this site" : "Turn on Mira for this site";
  $("note").textContent = state.site
    ? (on ? "Reload the page if Mira has not appeared yet." : "Mira stays off here until you turn her on.")
    : "Open an http(s) page to turn Mira on.";
}

function renderSites() {
  const list = $("sites");
  list.textContent = "";
  $("empty").hidden = state.enabled.length > 0;
  for (const site of state.enabled) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = site;
    host.title = site;
    const off = document.createElement("button");
    off.className = "remove";
    off.type = "button";
    off.textContent = "Turn off";
    off.addEventListener("click", () => turnOff(site, off));
    li.append(dot, host, off);
    list.append(li);
  }
}

async function persist() {
  await chrome.storage.local.set({ [ENABLED_KEY]: state.enabled });
}

async function turnOff(site, btn) {
  if (state.busy) return;
  state.busy = true;
  if (btn) btn.disabled = true;
  state.enabled = state.enabled.filter((s) => s !== site);
  await persist();
  try { await chrome.permissions.remove({ origins: [patternOf(site)] }); } catch (e) { /* required origins cannot be removed */ }
  state.busy = false;
  render();
}

async function toggle() {
  if (!state.site || !state.tab || state.busy) return;
  const site = state.site;
  if (state.enabled.includes(site)) {
    await turnOff(site);
    return;
  }
  // Called in the click task, before any await, so Chrome treats it as the user's gesture.
  const granted = await chrome.permissions.request({ origins: [patternOf(site)] });
  if (!granted) {
    $("note").textContent = "Chrome did not grant access to this site.";
    return;
  }
  state.enabled = state.enabled.concat(site);
  await persist();
  render();
  try {
    await chrome.runtime.sendMessage({ type: "inject", tabId: state.tab.id, url: state.tab.url });
  } catch (e) { /* the worker retries on the next navigation */ }
}

async function saveServer() {
  state.serverUrl = normalizeServer($("server").value);
  $("server").value = state.serverUrl;
  await chrome.storage.local.set({ [SERVER_KEY]: state.serverUrl });
  $("notebook").href = state.serverUrl + "/";
  const saved = $("saved");
  saved.hidden = false;
  clearTimeout(saveServer._t);
  saveServer._t = setTimeout(() => { saved.hidden = true; }, 1400);
}

$("toggle").addEventListener("click", toggle);
$("save").addEventListener("click", saveServer);
$("server").addEventListener("keydown", (e) => { if (e.key === "Enter") saveServer(); });

load();
