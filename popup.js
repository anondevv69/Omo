/**
 * Relay is fixed to your Railway app. Change here if you fork / self-host.
 * @type {string}
 */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

const nameEl = document.getElementById("name");
const symbolEl = document.getElementById("symbol");
const imageEl = document.getElementById("image");
const descriptionEl = document.getElementById("description");
const statusEl = document.getElementById("status");
const prepareBtn = document.getElementById("prepare");
const profileViewingLineEl = document.getElementById("profileViewingLine");
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

function showDeployResultLink(fomoUrl) {
  statusEl.hidden = false;
  statusEl.replaceChildren();
  statusEl.style.borderColor = "#2d3139";
  const href = String(fomoUrl || "").trim();
  if (!isSafeFomoFamilyTokenUrl(href)) {
    statusEl.textContent = href || "Missing token link.";
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
  profileViewingLineEl.hidden = false;
  if (slug) {
    let html = `Viewing profile <strong>@${slug}</strong>`;
    if (acct && String(slug).toLowerCase() !== acct.toLowerCase()) {
      html += ` <span class="muted">· Your account <strong>@${acct}</strong></span>`;
    } else if (acct && String(slug).toLowerCase() === acct.toLowerCase()) {
      html += ` <span class="muted">(your profile)</span>`;
    }
    profileViewingLineEl.innerHTML = html;
  } else if (acct) {
    profileViewingLineEl.innerHTML = `Logged in as <strong>@${acct}</strong> <span class="muted">(not on /profile/…)</span>`;
  } else {
    profileViewingLineEl.innerHTML =
      'Viewing profile <span class="muted">— open fomo.family until Felper picks up your @handle</span>';
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
    session.lastProfileSolana ?? []
  );
  renderList(
    document.getElementById("scanProfileEvm"),
    "EVM",
    session.lastProfileEvm ?? []
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

  if (!name || !symbol) {
    const pre = await chrome.storage.local.get(["fomoLoggedIn"]);
    const loggedInBadge = pre.fomoLoggedIn === true;
    headerError = true;
    renderHeaderBadge(loggedInBadge);
    showStatus("Enter token name and symbol.", true);
    return;
  }

  prepareBtn.disabled = true;
  showStatus("Syncing FOMO profile…", false);

  const { handle: fomoHandle, storage } = await resolveFomoHandleForDeploy();
  const loggedInBadge = storage.fomoLoggedIn === true;
  const base = RELAY_ORIGIN.replace(/\/$/, "");

  const deployHint =
    loggedInBadge && !fomoHandle
      ? "No FOMO @handle for metadata — open your profile on fomo.family and tap Refresh, then deploy again. "
      : "";

  showStatus(
    `${deployHint}Deploying… (instant when fomo mint pool has keys; otherwise you’ll see pool-empty — relay fills in background)`
  );

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 240_000);

  try {
    const payload = {
      name,
      symbol,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      ...(fomoHandle ? { fomoUsername: fomoHandle } : {}),
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
      showStatus(JSON.stringify(data, null, 2) || res.statusText, true);
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
