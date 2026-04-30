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
const pageContextEl = document.getElementById("pageContext");
const loginGateEl = document.getElementById("login-gate");
const appRootEl = document.getElementById("app-root");

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
    "lastAddresses",
    "lastSolanaAddresses",
    "lastEvmAddresses",
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
    pageContextEl.hidden = false;
    pageContextEl.innerHTML = `Viewing profile: <strong>@${slug}</strong>`;
  } else {
    pageContextEl.hidden = true;
    pageContextEl.textContent = "";
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

  const sol = session.lastSolanaAddresses ?? session.lastAddresses ?? [];
  const evm = session.lastEvmAddresses ?? [];
  renderList(document.getElementById("scanSol"), "Solana", sol);
  renderList(document.getElementById("scanEvm"), "EVM", evm);

  const youSol = session.lastYouSolana ?? [];
  creatorEl.value = youSol[0] ? youSol[0] : "";
  creatorEl.placeholder = youSol.length
    ? ""
    : "Refresh after sign-in — your Solana wallet not detected yet";
}

async function copyToClipboard(text, label) {
  if (!text) {
    showStatus(`No ${label} on page scan yet.`, true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showStatus(`${label} copied.`, false);
  } catch {
    showStatus("Could not copy — select and copy manually.", true);
  }
}

document.getElementById("copyPageSol").addEventListener("click", async () => {
  const session = await chrome.storage.local.get([
    "lastSolanaAddresses",
    "lastAddresses",
  ]);
  const sol = session.lastSolanaAddresses ?? session.lastAddresses ?? [];
  await copyToClipboard(sol[0], "Solana address");
});

document.getElementById("copyPageEvm").addEventListener("click", async () => {
  const session = await chrome.storage.local.get(["lastEvmAddresses"]);
  const evm = session.lastEvmAddresses ?? [];
  await copyToClipboard(evm[0], "EVM address");
});

document.getElementById("rescan").addEventListener("click", async () => {
  const tabId = await findFomoTabId();
  if (!tabId) {
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
      showStatus(
        `Could not hook this page (${inj?.error || "unknown"}). Try a full reload of the fomo tab.`,
        true
      );
      return;
    }
    const scan = await chrome.tabs.sendMessage(tabId, { type: "SCAN" });
    if (scan && scan.ok === false) {
      showStatus(scan.error || "Scan failed", true);
      return;
    }
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), true);
    return;
  }
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
    showStatus("Sign in to fomo.family first, then Refresh.", true);
    return;
  }

  const base = RELAY_ORIGIN.replace(/\/$/, "");
  const sessionKeys = await chrome.storage.local.get(["lastYouSolana"]);
  const youSol = sessionKeys.lastYouSolana ?? [];
  const creatorAddress = (youSol[0] || creatorEl.value || "").trim();
  const name = nameEl.value.trim();
  const symbol = symbolEl.value.trim();
  const image = imageEl.value.trim();
  const description = descriptionEl.value.trim();

  if (!creatorAddress || !name || !symbol) {
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
    };
    const res = await fetch(`${base}/api/deploy/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showStatus(JSON.stringify(data, null, 2) || res.statusText, true);
      return;
    }
    showStatus(
      JSON.stringify(
        {
          mintAddress: data.mintAddress,
          feePayer: data.feePayer,
          metadataUri: data.metadataUri,
          transactionBase64: data.transactionBase64,
          next: data.hint,
        },
        null,
        2
      )
    );
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    prepareBtn.disabled = false;
  }
});

void refreshFromStorage();
