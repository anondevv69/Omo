/**
 * Relay is fixed to your Railway app. Change here if you fork / self-host.
 * @type {string}
 */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

const creatorEl = document.getElementById("creator");
const nameEl = document.getElementById("name");
const symbolEl = document.getElementById("symbol");
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
  const session = await chrome.storage.session.get([
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
  if (youSol.length && !creatorEl.value.trim()) {
    creatorEl.value = youSol[0];
  } else if (sol.length && !creatorEl.value.trim()) {
    creatorEl.value = sol[0];
  }
}

document.getElementById("useFirstSol").addEventListener("click", async () => {
  const session = await chrome.storage.session.get([
    "lastSolanaAddresses",
    "lastAddresses",
  ]);
  const sol = session.lastSolanaAddresses ?? session.lastAddresses ?? [];
  if (sol[0]) creatorEl.value = sol[0];
});

document.getElementById("useYourSol").addEventListener("click", async () => {
  const session = await chrome.storage.session.get(["lastYouSolana"]);
  const sol = session.lastYouSolana ?? [];
  if (sol[0]) creatorEl.value = sol[0];
});

document.getElementById("useProfileSol").addEventListener("click", async () => {
  const session = await chrome.storage.session.get(["lastProfileSolana"]);
  const sol = session.lastProfileSolana ?? [];
  if (sol[0]) creatorEl.value = sol[0];
});

document.getElementById("useFirstEvm").addEventListener("click", async () => {
  const session = await chrome.storage.session.get(["lastEvmAddresses"]);
  const evm = session.lastEvmAddresses ?? [];
  if (evm[0]) creatorEl.value = evm[0];
});

document.getElementById("rescan").addEventListener("click", async () => {
  const tabId = await findFomoTabId();
  if (!tabId) {
    showStatus("Open fomo.family in a tab, load a profile or balances, then tap Refresh.", true);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SCAN" });
  } catch {
    showStatus("On your fomo tab press ⌘⇧R, then Refresh again.", true);
    return;
  }
  await refreshFromStorage();
});

prepareBtn.addEventListener("click", async () => {
  const session = await chrome.storage.session.get(["fomoLoggedIn"]);
  if (session.fomoLoggedIn !== true) {
    showStatus("Sign in to fomo.family first, then Refresh.", true);
    return;
  }

  const base = RELAY_ORIGIN.replace(/\/$/, "");
  const creatorAddress = creatorEl.value.trim();
  const name = nameEl.value.trim();
  const symbol = symbolEl.value.trim();

  if (!creatorAddress || !name || !symbol) {
    showStatus("Choose a Solana creator wallet and enter name + symbol.", true);
    return;
  }

  prepareBtn.disabled = true;
  showStatus("Preparing…");

  try {
    const res = await fetch(`${base}/api/deploy/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorAddress,
        name,
        symbol,
      }),
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
