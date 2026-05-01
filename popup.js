/**
 * Relay is fixed to your Railway app. Change here if you fork / self-host.
 * @type {string}
 */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

const creatorEl = document.getElementById("creator");
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
  statusEl.textContent = text;
  statusEl.style.borderColor = err ? "#f28b82" : "#2d3139";
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
  ]);

  const loggedIn = session.fomoLoggedIn === true;
  loginGateEl.hidden = loggedIn;
  document.body.classList.toggle("extension-locked", !loggedIn);
  appRootEl.inert = !loggedIn;
  prepareBtn.disabled = !loggedIn;

  const slug = session.lastProfileSlug;
  if (slug) {
    profileViewingLineEl.hidden = false;
    profileViewingLineEl.innerHTML = `Viewing profile <strong>@${slug}</strong>`;
  } else {
    profileViewingLineEl.hidden = false;
    profileViewingLineEl.innerHTML =
      'Viewing profile <span class="muted">— open a profile on fomo.family</span>';
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

  const youSol = session.lastYouSolana ?? [];
  creatorEl.value = youSol[0] ? youSol[0] : "";
  creatorEl.placeholder = youSol.length
    ? ""
    : "Refresh after sign-in — your Solana wallet not detected yet";

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
  const session = await chrome.storage.local.get(["fomoLoggedIn"]);
  if (session.fomoLoggedIn !== true) {
    headerError = true;
    renderHeaderBadge(false);
    showStatus("Sign in to fomo.family first, then Refresh.", true);
    return;
  }

  const base = RELAY_ORIGIN.replace(/\/$/, "");
  const sessionKeys = await chrome.storage.local.get([
    "lastYouSolana",
    "lastYouFomoHandle",
  ]);
  const youSol = sessionKeys.lastYouSolana ?? [];
  const fomoHandle = (sessionKeys.lastYouFomoHandle || "").trim();
  const creatorAddress = (youSol[0] || creatorEl.value || "").trim();
  const name = nameEl.value.trim();
  const symbol = symbolEl.value.trim();
  const image = imageEl.value.trim();
  const description = descriptionEl.value.trim();

  if (!creatorAddress || !name || !symbol) {
    headerError = true;
    renderHeaderBadge(true);
    showStatus(
      !creatorAddress
        ? "Your wallet wasn’t detected. Stay signed in on fomo.family and tap Refresh."
        : "Enter token name and symbol.",
      true
    );
    return;
  }

  prepareBtn.disabled = true;
  showStatus("Preparing deployment…");

  try {
    const payload = {
      creatorAddress,
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
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      headerError = true;
      renderHeaderBadge(true);
      showStatus(JSON.stringify(data, null, 2) || res.statusText, true);
      return;
    }
    const summary = {
      mintAddress: data.mintAddress,
      feePayer: data.feePayer,
      creatorFeeRecipient: data.creatorFeeRecipient,
      metadataUri: data.metadataUri,
      transactionBase64: data.transactionBase64,
      next: data.hint,
      deployNote: data.deployNote,
    };
    headerError = false;
    renderHeaderBadge(true);
    showStatus(
      [
        "Prepare succeeded — Felper’s relay pays deployment fees; creator trading fees go to creatorFeeRecipient (your logged-in Solana address).",
        "",
        "Solana still requires one signature from that creator wallet, then POST the signed tx:",
        `  POST ${base}/api/deploy/submit`,
        '  body: { "transactionBase64": "<same field after signing>" }',
        "",
        "— Response —",
        JSON.stringify(summary, null, 2),
      ].join("\n")
    );
  } catch (e) {
    headerError = true;
    renderHeaderBadge(true);
    showStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    prepareBtn.disabled = false;
  }
});

void refreshFromStorage();
