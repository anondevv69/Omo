/**
 * Relay is fixed to your Railway app. Change here if you fork / self-host.
 * @type {string}
 */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

const nameEl = document.getElementById("name");
const symbolEl = document.getElementById("symbol");
const imageEl = document.getElementById("image");
const descriptionEl = document.getElementById("description");
const websiteEl = document.getElementById("website");
const twitterEl = document.getElementById("twitter");
const telegramEl = document.getElementById("telegram");
const statusEl = document.getElementById("status");
const prepareBtn = document.getElementById("prepare");
const profileViewingLineEl = document.getElementById("profileViewingLine");
const youAccountLineEl = document.getElementById("youAccountLine");
const foreignProfileSectionEl = document.getElementById("foreignProfileSection");
const loginGateEl = document.getElementById("login-gate");
const appRootEl = document.getElementById("app-root");
const headerStatusEl = document.getElementById("headerStatus");

/** When true, header shows Error until a successful Refresh clears it. */
let headerError = false;

function renderHeaderBadge(loggedIn) {
  if (!headerStatusEl) return;
  headerStatusEl.classList.remove("ok", "warn", "err");
  if (headerError) {
    headerStatusEl.textContent = "Error";
    headerStatusEl.classList.add("err");
    return;
  }
  if (loggedIn === true) {
    headerStatusEl.textContent = "Logged in";
    headerStatusEl.classList.add("ok");
  } else {
    headerStatusEl.textContent = "Sign in";
    headerStatusEl.classList.add("warn");
  }
}

function showStatus(text, err = false) {
  statusEl.hidden = false;
  statusEl.replaceChildren();
  statusEl.textContent = text;
  statusEl.style.borderColor = err ? "#f28b82" : "#2d3139";
}

/** Cooldown copy for duplicate-ticker responses (`retryAfterSec` from API). */
function formatRetryHuman(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s >= 86400) return `${Math.ceil(s / 86400)} day(s)`;
  if (s >= 3600) return `${Math.ceil(s / 3600)} hour(s)`;
  if (s >= 60) return `${Math.ceil(s / 60)} minutes`;
  return `${s} seconds`;
}

/** Single clickable FOMO token URL after deploy (plain text = URL only). */
function isSafeFomoFamilyTokenUrl(raw) {
  const u = String(raw || "").trim();
  if (!u) return false;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    const okHost = url.hostname === "fomo.family" || url.hostname === "www.fomo.family";
    return okHost && url.pathname.startsWith("/tokens/solana/");
  } catch {
    return false;
  }
}

/**
 * @param {string} fomoUrl
 * @param {string} [preambleText] — shown above the link (e.g. duplicate-ticker explanation).
 */
function showDeployResultLink(fomoUrl, preambleText) {
  statusEl.hidden = false;
  statusEl.replaceChildren();
  statusEl.style.borderColor = "#2d3139";
  if (preambleText) {
    const pre = document.createElement("div");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.marginBottom = "10px";
    pre.style.lineHeight = "1.45";
    pre.textContent = preambleText;
    statusEl.appendChild(pre);
  }
  const href = String(fomoUrl || "").trim();
  if (!isSafeFomoFamilyTokenUrl(href)) {
    const fallback = document.createElement("div");
    fallback.textContent = href || "Missing token link.";
    statusEl.appendChild(fallback);
    statusEl.style.borderColor = "#f28b82";
    return;
  }
  const a = document.createElement("a");
  a.className = "deploy-result-link";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = href;
  statusEl.appendChild(a);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isFomoUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === "fomo.family" || u.hostname === "www.fomo.family";
  } catch {
    return false;
  }
}

async function findFomoTabId() {
  const active = await getActiveTab();
  if (active?.id && isFomoUrl(active.url)) return active.id;

  const matches = await chrome.tabs.query({
    url: ["https://fomo.family/*", "https://www.fomo.family/*"],
  });
  return matches[0]?.id ?? null;
}

/** Re-sniff fomo tab, then read handle from storage or active /profile URL + wallet match. */
async function resolveFomoHandleForDeploy() {
  const keys = [
    "fomoLoggedIn",
    "lastYouFomoHandle",
    "lastDeployFomoHandle",
    "lastYouSolana",
    "lastYouEvm",
    "lastProfileSolana",
    "lastProfileEvm",
    "lastProfileSlug",
  ];
  const beforeScan = await chrome.storage.local.get(keys);

  const tabId = await findFomoTabId();
  if (tabId) {
    try {
      await chrome.runtime.sendMessage({ type: "INSTALL_MAIN_SNIFFER", tabId });
    } catch {
      /* ignore */
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SCAN" });
    } catch {
      /* ignore */
    }
  }

  const storage = await chrome.storage.local.get(keys);

  let handle =
    String(storage.lastYouFomoHandle || "").trim() ||
    String(storage.lastDeployFomoHandle || "").trim() ||
    String(beforeScan.lastYouFomoHandle || "").trim() ||
    String(beforeScan.lastDeployFomoHandle || "").trim();
  if (handle) return { handle, storage };

  if (storage.fomoLoggedIn !== true) return { handle: "", storage };

  const tab = await getActiveTab();
  const url = tab?.url;
  if (!url || !isFomoUrl(url)) return { handle: "", storage };

  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/profile\/([^/]+)/);
    if (!m) return { handle: "", storage };
    const slug = decodeURIComponent(m[1]).replace(/^@+/, "").trim();
    if (!slug) return { handle: "", storage };

    const youSol = String(storage.lastYouSolana?.[0] || "").trim();
    const profSol = String(storage.lastProfileSolana?.[0] || "").trim();
    const youEvm = String(storage.lastYouEvm?.[0] || "").trim();
    const profEvm = String(storage.lastProfileEvm?.[0] || "").trim();
    const walletMatch =
      (youSol && profSol && youSol === profSol) ||
      (youEvm && profEvm && youEvm === profEvm);
    if (!walletMatch) return { handle: "", storage };

    const storedH =
      String(beforeScan.lastYouFomoHandle || "").trim() ||
      String(storage.lastYouFomoHandle || "").trim();
    const slugOk =
      !storedH ||
      String(slug).toLowerCase() === String(storedH).toLowerCase();
    if (slugOk) return { handle: slug, storage };
  } catch {
    /* ignore */
  }

  return { handle: "", storage };
}

function renderList(el, label, addrs) {
  el.innerHTML =
    !addrs || addrs.length === 0
      ? `<strong>${label}:</strong> —`
      : `<strong>${label}:</strong> ${addrs.map((a) => `<span>${a}</span>`).join(" · ")}`;
}

async function refreshFromStorage() {
  const session = await chrome.storage.local.get([
    "lastScanAt",
    "lastUrl",
    "lastProfileSlug",
    "lastProfileSolana",
    "lastProfileEvm",
    "lastYouSolana",
    "lastYouEvm",
    "fomoLoggedIn",
    "lastYouFomoHandle",
  ]);

  const loggedIn = session.fomoLoggedIn === true;
  loginGateEl.hidden = loggedIn;
  document.body.classList.toggle("extension-locked", false);
  appRootEl.inert = false;
  prepareBtn.disabled = false;

  const slug = session.lastProfileSlug;
  const acct = String(session.lastYouFomoHandle || "").trim();
  const slugNorm = slug ? String(slug).toLowerCase() : "";
  const acctNorm = acct ? String(acct).toLowerCase() : "";

  /** Another user’s profile tab — not your own slug and not “no slug”. */
  const viewingOtherProfile =
    Boolean(slug) && (!acctNorm || slugNorm !== acctNorm);

  if (loggedIn) {
    if (acct) {
      youAccountLineEl.innerHTML = `Your account <strong>@${acct}</strong>`;
      youAccountLineEl.hidden = false;
    } else {
      youAccountLineEl.innerHTML =
        '<span class="muted">Felper hasn’t read your @handle yet — keep using fomo.family until data loads.</span>';
      youAccountLineEl.hidden = false;
    }
  } else {
    youAccountLineEl.innerHTML = "";
    youAccountLineEl.hidden = true;
  }

  if (viewingOtherProfile) {
    foreignProfileSectionEl.hidden = false;
    profileViewingLineEl.innerHTML = `Viewing profile <strong>@${slug}</strong>`;
  } else {
    foreignProfileSectionEl.hidden = true;
    profileViewingLineEl.innerHTML = "";
  }

  renderList(
    document.getElementById("scanYouSol"),
    "Solana",
    session.lastYouSolana ?? []
  );
  renderList(
    document.getElementById("scanYouEvm"),
    "EVM",
    session.lastYouEvm ?? []
  );

  renderList(
    document.getElementById("scanProfileSol"),
    "Solana",
    viewingOtherProfile ? session.lastProfileSolana ?? [] : []
  );
  renderList(
    document.getElementById("scanProfileEvm"),
    "EVM",
    viewingOtherProfile ? session.lastProfileEvm ?? [] : []
  );

  renderHeaderBadge(loggedIn);
}

document.getElementById("rescan").addEventListener("click", async () => {
  const tabId = await findFomoTabId();
  if (!tabId) {
    headerError = true;
    renderHeaderBadge(false);
    showStatus("Open fomo.family in a tab, load a profile or balances, then tap Refresh.", true);
    return;
  }
  showStatus("Attaching…", false);
  try {
    const inj = await chrome.runtime.sendMessage({
      type: "INSTALL_MAIN_SNIFFER",
      tabId,
    });
    if (!inj?.ok) {
      headerError = true;
      renderHeaderBadge(false);
      showStatus(
        `Could not hook this page (${inj?.error || "unknown"}). Try a full reload of the fomo tab.`,
        true
      );
      return;
    }
    const scan = await chrome.tabs.sendMessage(tabId, { type: "SCAN" });
    if (scan && scan.ok === false) {
      headerError = true;
      renderHeaderBadge(false);
      showStatus(scan.error || "Scan failed", true);
      return;
    }
  } catch (e) {
    headerError = true;
    renderHeaderBadge(false);
    showStatus(e instanceof Error ? e.message : String(e), true);
    return;
  }
  headerError = false;
  await refreshFromStorage();
  const s = await chrome.storage.local.get(["fomoLoggedIn"]);
  showStatus(
    s.fomoLoggedIn === true
      ? "Updated. If wallets are still empty, trigger Holders or navigate once, then Refresh again."
      : "Hooked. Use the site until API calls run, then Refresh again.",
    false
  );
});

prepareBtn.addEventListener("click", async () => {
  const name = nameEl.value.trim();
  const symbol = symbolEl.value.trim();
  const image = imageEl.value.trim();
  const description = descriptionEl.value.trim();
  const website = websiteEl.value.trim();
  const twitter = twitterEl.value.trim();
  const telegram = telegramEl.value.trim();

  if (!name || !symbol) {
    const pre = await chrome.storage.local.get(["fomoLoggedIn"]);
    const loggedInBadge = pre.fomoLoggedIn === true;
    headerError = true;
    renderHeaderBadge(loggedInBadge);
    showStatus("Enter token name and symbol.", true);
    return;
  }

  prepareBtn.disabled = true;
  showStatus("Verifying FOMO account…", false);

  const { handle: fomoHandle, storage } = await resolveFomoHandleForDeploy();
  const loggedInBadge = storage.fomoLoggedIn === true;

  /** Hard gate: cannot deploy without identifying the logged-in user. */
  if (!fomoHandle) {
    headerError = true;
    renderHeaderBadge(loggedInBadge);
    prepareBtn.disabled = false;
    showStatus(
      "Cannot deploy: FOMO account not identified. Open fomo.family (any page), ensure you're logged in, then tap Refresh and try again.",
      true
    );
    return;
  }

  const base = RELAY_ORIGIN.replace(/\/$/, "");

  showStatus(
    "Deploying… (instant when fomo mint pool has keys; otherwise you’ll see pool-empty — relay fills in background)"
  );

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 240_000);

  try {
    const dm = await chrome.storage.local.get(["lastYouDeployMetrics"]);
    const raw = dm.lastYouDeployMetrics;
    const deployMetrics =
      raw && typeof raw === "object"
        ? {
            ...(typeof raw.followers === "number" ? { followers: raw.followers } : {}),
            ...(typeof raw.following === "number" ? { following: raw.following } : {}),
            ...(typeof raw.swaps === "number" ? { swaps: raw.swaps } : {}),
            ...(typeof raw.avgHoldSeconds === "number"
              ? { avgHoldSeconds: raw.avgHoldSeconds }
              : {}),
          }
        : {};
    const payload = {
      name,
      symbol,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      ...(website ? { website } : {}),
      ...(twitter ? { twitter } : {}),
      ...(telegram ? { telegram } : {}),
      ...(fomoHandle ? { fomoUsername: fomoHandle } : {}),
      ...(Object.keys(deployMetrics).length ? { deployMetrics } : {}),
    };
    const res = await fetch(`${base}/api/deploy/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      headerError = true;
      renderHeaderBadge(loggedInBadge);
      if (data.code === "VANITY_POOL_EMPTY") {
        showStatus(
          [
            "No fomo mint ready — pool is empty. The relay grinds keys in the background; wait and check GET /api/deploy/info (mintPool.size), import keys, or enable slow on-request grind on the server.",
            "",
            JSON.stringify(data, null, 2),
          ].join("\n"),
          true
        );
        return;
      }
      if (data.code === "DEPLOY_NOT_ELIGIBLE") {
        showStatus(
          [
            "Relay rejected deploy: you need to meet at least one eligibility threshold (followers, swaps, or avg hold time). Use fomo.family until profile/API data loads, tap Refresh in Felper, then try again.",
            "",
            JSON.stringify(data, null, 2),
          ].join("\n"),
          true
        );
        return;
      }
      if (data.code === "DEPLOY_SYMBOL_DUPLICATE") {
        headerError = false;
        renderHeaderBadge(loggedInBadge);
        const orig = data.original || {};
        const link =
          orig.fomoFamilyUrl ||
          (orig.mintAddress
            ? `https://fomo.family/tokens/solana/${orig.mintAddress}`
            : "");
        const symLabel = symbol ? String(symbol).trim().toUpperCase() : "";
        const opener = symLabel
          ? `This ticker (${symLabel}) was already used in the last 24 hours on Felper. Here’s the existing token — open the link below on FOMO.`
          : `This ticker was already used in the last 24 hours on Felper. Here’s the existing token — open the link below on FOMO.`;
        const lines = [
          opener,
          "",
          orig.tokenName ? `Original name: ${orig.tokenName}` : "",
          orig.fomoUsername != null && orig.fomoUsername !== ""
            ? `Deployed by: @${orig.fomoUsername}`
            : "",
          orig.mintAddress ? `Mint: ${orig.mintAddress}` : "",
          typeof data.retryAfterSec === "number"
            ? `You can try this ticker again after the cooldown (~${formatRetryHuman(data.retryAfterSec)}).`
            : "",
        ].filter(Boolean);
        const body = lines.join("\n");
        if (link) {
          showDeployResultLink(link, body);
        } else {
          showStatus(body, false);
        }
        return;
      }
      if (data.code === "DEPLOY_USER_COOLDOWN") {
        const wait =
          typeof data.retryAfterSec === "number"
            ? formatRetryHuman(data.retryAfterSec)
            : "a while";
        showStatus(
          `You've reached your deploy cooldown (daily limit). Try again in ~${wait}.`,
          true
        );
        return;
      }
      const errMsg =
        (typeof data.error === "string" && data.error.trim()) ||
        (typeof data.message === "string" && data.message.trim()) ||
        res.statusText ||
        `Request failed (${res.status})`;
      showStatus(errMsg, true);
      return;
    }
    headerError = false;
    renderHeaderBadge(loggedInBadge);
    const mint = data.mintAddress || "";
    const fomoLink = (
      data.fomoFamilyUrl ||
      (mint ? `https://fomo.family/tokens/solana/${mint}` : "")
    ).trim();
    if (fomoLink) {
      showDeployResultLink(fomoLink);
    } else {
      showStatus("Deployed — no FOMO URL in response.", false);
    }
  } catch (e) {
    headerError = true;
    renderHeaderBadge(loggedInBadge);
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Relay took longer than 4 minutes (grind + RPC). Retry or set SOLANA_RPC_URL to a paid endpoint on Railway."
        : e instanceof Error
          ? e.message
          : String(e);
    showStatus(msg, true);
  } finally {
    clearTimeout(abortTimer);
    prepareBtn.disabled = false;
  }
});

void refreshFromStorage();
