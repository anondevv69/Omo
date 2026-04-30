/**
 * Injects MAIN-world fetch hook (CSP often blocks <script src="chrome-extension://...">).
 *
 * MV3: Do not use sendResponse + return true here — the service worker can suspend
 * before sendResponse runs ("message channel closed"). Return a Promise instead
 * (Chrome 110+); the resolved value is delivered to sendMessage callers.
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "INSTALL_MAIN_SNIFFER") return;

  const tabId = message.tabId ?? sender.tab?.id;
  if (!tabId) {
    return Promise.resolve({ ok: false, error: "no_tab" });
  }

  return chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      world: "MAIN",
      files: ["inject.js"],
    })
    .then(() => ({ ok: true }))
    .catch((err) => ({
      ok: false,
      error: String(err?.message || err),
    }));
});
