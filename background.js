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

const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

function normalizeDeployMetricsRaw(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    ...(typeof raw.followers === "number" ? { followers: raw.followers } : {}),
    ...(typeof raw.following === "number" ? { following: raw.following } : {}),
    ...(typeof raw.swaps === "number" ? { swaps: raw.swaps } : {}),
    ...(typeof raw.avgHoldSeconds === "number"
      ? { avgHoldSeconds: raw.avgHoldSeconds }
      : {}),
  };
}

chrome.runtime.onMessage.addListener((message, sendResponse) => {
  if (message?.type !== "THESIS_DEPLOY_REQUEST") return;

  void (async () => {
    try {
      const p = message.payload || {};
      const commentId = String(p.commentId || "").trim();
      if (!commentId) {
        sendResponse({ ok: false, error: "no_comment_id" });
        return;
      }

      const store = await chrome.storage.local.get([
        "thesisProcessedCommentIds",
        "lastYouDeployMetrics",
      ]);
      const ids = Array.isArray(store.thesisProcessedCommentIds)
        ? store.thesisProcessedCommentIds
        : [];
      if (ids.includes(commentId)) {
        sendResponse({ ok: true, skipped: "already_processed" });
        return;
      }

      const name = String(p.name || "").trim().slice(0, 64);
      const symbol = String(p.symbol || "").trim().toUpperCase().slice(0, 10);
      const fomoUsername = String(p.fomoUsername || "")
        .trim()
        .replace(/^@+/, "");
      if (!name || !symbol || !fomoUsername) {
        sendResponse({ ok: false, error: "missing_fields" });
        return;
      }

      let dm = normalizeDeployMetricsRaw(p.deployMetrics);
      if (!Object.keys(dm).length) {
        dm = normalizeDeployMetricsRaw(store.lastYouDeployMetrics);
      }

      const base = RELAY_ORIGIN.replace(/\/$/, "");
      const payload = {
        name,
        symbol,
        description: "",
        image: "",
        website: "",
        twitter: "",
        telegram: "",
        fomoUsername,
        ...(Object.keys(dm).length ? { deployMetrics: dm } : {}),
      };

      const res = await fetch(`${base}/api/deploy/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        sendResponse({
          ok: false,
          status: res.status,
          code: data?.code,
          error: data?.message || "prepare_failed",
        });
        return;
      }

      const nextIds = [...ids, commentId];
      if (nextIds.length > 500) nextIds.splice(0, nextIds.length - 500);
      await chrome.storage.local.set({ thesisProcessedCommentIds: nextIds });

      sendResponse({ ok: true, result: data });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});
