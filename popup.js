/**
 * Relay is fixed to your Railway app. Change here if you fork / self-host.
 * @type {string}
 */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

const deployerHintEl = document.getElementById("deployerHint");

async function loadDeployerHint() {
  if (!deployerHintEl) return;
  const base = RELAY_ORIGIN.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/api/deploy/info`);
    const j = await r.json().catch(() => ({}));
    if (j.deployerPubkey) {
      deployerHintEl.textContent = `On-chain creator & Pump fees: ${j.deployerPubkey}`;
    } else {
      deployerHintEl.textContent = j.error || "Relay deployer pubkey unavailable.";
    }
  } catch {
    deployerHintEl.textContent = "Could not reach relay /api/deploy/info.";
  }
}
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
  document.body.classList.toggle("extension-locked", false);
  appRootEl.inert = false;
  prepareBtn.disabled = false;

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

  renderHeaderBadge(loggedIn);
  void loadDeployerHint();
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
  const storage = await chrome.storage.local.get([
    "fomoLoggedIn",
    "lastYouFomoHandle",
  ]);
  const loggedInBadge = storage.fomoLoggedIn === true;
  const base = RELAY_ORIGIN.replace(/\/$/, "");
  const fomoHandle = (storage.lastYouFomoHandle || "").trim();
  const name = nameEl.value.trim();
  const symbol = symbolEl.value.trim();
  const image = imageEl.value.trim();
  const description = descriptionEl.value.trim();

  if (!name || !symbol) {
    headerError = true;
    renderHeaderBadge(loggedInBadge);
    showStatus("Enter token name and symbol.", true);
    return;
  }

  prepareBtn.disabled = true;
  showStatus("Deploying (relay signing & broadcasting)…");

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
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      headerError = true;
      renderHeaderBadge(loggedInBadge);
      showStatus(JSON.stringify(data, null, 2) || res.statusText, true);
      return;
    }
    headerError = false;
    renderHeaderBadge(loggedInBadge);
    showStatus(
      [
        data.confirmed ? "Deployed on-chain." : "Submitted — confirm status below.",
        "",
        JSON.stringify(
          {
            signature: data.signature,
            confirmed: data.confirmed,
            mintAddress: data.mintAddress,
            deployerPubkey: data.deployerPubkey,
            metadataUri: data.metadataUri,
            explorerUrl: data.explorerUrl,
            mintExplorerUrl: data.mintExplorerUrl,
            note: data.note,
          },
          null,
          2
        ),
      ].join("\n")
    );
  } catch (e) {
    headerError = true;
    renderHeaderBadge(loggedInBadge);
    showStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    prepareBtn.disabled = false;
  }
});

void refreshFromStorage();
