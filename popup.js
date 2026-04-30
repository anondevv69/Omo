const apiBaseEl = document.getElementById("apiBase");
const creatorEl = document.getElementById("creator");
const nameEl = document.getElementById("name");
const symbolEl = document.getElementById("symbol");
const uriEl = document.getElementById("uri");
const statusEl = document.getElementById("status");
const prepareBtn = document.getElementById("prepare");

const STORAGE_API = "relayApiBase";

function showStatus(text, err = false) {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.style.borderColor = err ? "#f28b82" : "#2d3139";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderScanLists(session) {
  const solEl = document.getElementById("scanSol");
  const evmEl = document.getElementById("scanEvm");
  const sol = session.lastSolanaAddresses ?? session.lastAddresses ?? [];
  const evm = session.lastEvmAddresses ?? [];

  solEl.innerHTML =
    sol.length === 0
      ? "<strong>Solana:</strong> —"
      : `<strong>Solana:</strong> ${sol.map((a) => `<span>${a}</span>`).join(" · ")}`;
  evmEl.innerHTML =
    evm.length === 0
      ? "<strong>EVM:</strong> —"
      : `<strong>EVM:</strong> ${evm.map((a) => `<span>${a}</span>`).join(" · ")}`;
}

async function refreshFromStorage() {
  const session = await chrome.storage.session.get([
    "lastScanAt",
    "lastAddresses",
    "lastSolanaAddresses",
    "lastEvmAddresses",
    "lastUrl",
  ]);
  const local = await chrome.storage.local.get([STORAGE_API]);
  if (local[STORAGE_API]) apiBaseEl.value = local[STORAGE_API];

  renderScanLists(session);

  const sol = session.lastSolanaAddresses ?? session.lastAddresses ?? [];
  if (sol.length && !creatorEl.value.trim()) {
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

document.getElementById("useFirstEvm").addEventListener("click", async () => {
  const session = await chrome.storage.session.get(["lastEvmAddresses"]);
  const evm = session.lastEvmAddresses ?? [];
  if (evm[0]) creatorEl.value = evm[0];
});

document.getElementById("rescan").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
  } catch {
    showStatus("Could not reach fomo.family content script. Open a fomo.family tab.", true);
    return;
  }
  await refreshFromStorage();
});

apiBaseEl.addEventListener("change", () => {
  void chrome.storage.local.set({ [STORAGE_API]: apiBaseEl.value.trim() });
});

prepareBtn.addEventListener("click", async () => {
  const base = apiBaseEl.value.trim().replace(/\/$/, "");
  const creatorAddress = creatorEl.value.trim();
  const name = nameEl.value.trim();
  const symbol = symbolEl.value.trim();
  const metadataUri = uriEl.value.trim();

  if (!base) {
    showStatus("Set relay API base URL (e.g. http://localhost:8787)", true);
    return;
  }
  if (!creatorAddress || !name || !symbol || !metadataUri) {
    showStatus("Fill creator wallet, name, symbol, and metadata URI.", true);
    return;
  }

  prepareBtn.disabled = true;
  showStatus("Calling /api/deploy/prepare …");

  try {
    const res = await fetch(`${base}/api/deploy/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorAddress,
        name,
        symbol,
        metadataUri,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showStatus(JSON.stringify(data, null, 2) || res.statusText, true);
      return;
    }
    await chrome.storage.local.set({ [STORAGE_API]: base });
    showStatus(
      JSON.stringify(
        {
          mintAddress: data.mintAddress,
          feePayer: data.feePayer,
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
