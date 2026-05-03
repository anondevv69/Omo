/**
 * Relay is fixed to your Railway app. Change here if you fork / self-host.
 * @type {string}
 */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

const nameEl = document.getElementById("name");
const symbolEl = document.getElementById("symbol");
const imageUrlEl = document.getElementById("imageUrl");
const descriptionEl = document.getElementById("description");
const websiteEl = document.getElementById("website");
const twitterEl = document.getElementById("twitter");
const telegramEl = document.getElementById("telegram");
const statusEl = document.getElementById("status");
const prepareBtn = document.getElementById("prepare");
const deployTargetEl = document.getElementById("deployTarget");
const baseRewardRowEl = document.getElementById("baseRewardRow");
const baseRewardDisplayEl = document.getElementById("baseRewardDisplay");
const foldYouLoggedInEl = document.getElementById("foldYouLoggedIn");
const profileViewingLineEl = document.getElementById("profileViewingLine");
const youAccountLineEl = document.getElementById("youAccountLine");
const foreignProfileSectionEl = document.getElementById("foreignProfileSection");
const profileRelayDeploysWrapEl = document.getElementById("profileRelayDeploysWrap");
const profileRelayDeploysListEl = document.getElementById("profileRelayDeploysList");
const loginGateEl = document.getElementById("login-gate");
const appRootEl = document.getElementById("app-root");
const headerStatusEl = document.getElementById("headerStatus");
const imageFileEl = document.getElementById("imageFile");
const recentDeploysListEl = document.getElementById("recentDeploysList");

/** When true, header shows Error until a successful Refresh clears it. */
let headerError = false;

const OMO_RECENT_DEPLOYS_KEY = "omoRecentDeploys";
const RECENT_DEPLOYS_MAX = 30;

/** Merge relay Postgres index with local chrome.storage entries (same token address wins newest `at`). */
function mergeDeployLists(localList, remoteTokens) {
  const map = new Map();
  for (const row of localList) {
    if (row && typeof row === "object" && row.address) {
      map.set(row.address, { ...row });
    }
  }
  for (const t of remoteTokens) {
    const addr = String(t.tokenAddress || "").trim();
    if (!addr) continue;
    const chain = t.chain === "base" ? "base" : "solana";
    const remoteAt = t.deployedAt ? Date.parse(t.deployedAt) : NaN;
    const rt = Number.isFinite(remoteAt) ? remoteAt : Date.now();
    const prev = map.get(addr);
    const defaultFomo =
      chain === "base"
        ? `https://fomo.family/tokens/base/${addr}`
        : `https://fomo.family/tokens/solana/${addr}`;
    map.set(addr, {
      at: Math.max(prev?.at || 0, rt),
      chain,
      name: String(t.name || prev?.name || "—").trim() || "—",
      symbol: String(t.symbol || prev?.symbol || "—").toUpperCase() || "—",
      address: addr,
      fomoFamilyUrl:
        String(t.fomoFamilyUrl || prev?.fomoFamilyUrl || "").trim() || defaultFomo,
      mintExplorerUrl: String(t.mintExplorerUrl || prev?.mintExplorerUrl || "").trim(),
    });
  }
  return [...map.values()]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, RECENT_DEPLOYS_MAX);
}

async function mergeRelayDeployHistoryForHandle(handle) {
  const h = String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!h) return;
  const base = RELAY_ORIGIN.replace(/\/$/, "");
  try {
    const r = await fetch(
      `${base}/api/deploy/tokens?fomoUsername=${encodeURIComponent(h)}&limit=${RECENT_DEPLOYS_MAX}`,
      { cache: "no-store" }
    );
    if (!r.ok) return;
    const j = await r.json().catch(() => ({}));
    const remote = Array.isArray(j.tokens) ? j.tokens : [];
    const prev = await chrome.storage.local.get([OMO_RECENT_DEPLOYS_KEY]);
    const local = Array.isArray(prev[OMO_RECENT_DEPLOYS_KEY])
      ? prev[OMO_RECENT_DEPLOYS_KEY]
      : [];
    const merged = mergeDeployLists(local, remote);
    await chrome.storage.local.set({ [OMO_RECENT_DEPLOYS_KEY]: merged });
  } catch {
    /* ignore — offline or relay has no DATABASE_URL */
  }
}

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

/** Relay gate copy for min avg hold (seconds). */
function formatHoldRequirement(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s >= 3600) {
    const h = Math.round((s / 3600) * 10) / 10;
    return `${h} hours`;
  }
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s)}s`;
}

async function recordRecentDeploy({ name, symbol, data, isClanker, fomoLink }) {
  try {
    const mint = String(data.mintAddress || data.tokenAddress || "").trim();
    if (!mint) return;
    const fomo =
      String(fomoLink || "").trim() ||
      (isClanker
        ? `https://fomo.family/tokens/base/${mint}`
        : `https://fomo.family/tokens/solana/${mint}`);
    const entry = {
      at: Date.now(),
      chain: isClanker ? "base" : "solana",
      name: String(name || "").trim() || "—",
      symbol: String(symbol || "").trim().toUpperCase() || "—",
      address: mint,
      fomoFamilyUrl: fomo,
      mintExplorerUrl: String(data.mintExplorerUrl || "").trim(),
    };
    const prev = await chrome.storage.local.get([OMO_RECENT_DEPLOYS_KEY]);
    const list = Array.isArray(prev[OMO_RECENT_DEPLOYS_KEY])
      ? prev[OMO_RECENT_DEPLOYS_KEY]
      : [];
    const filtered = list.filter((x) => x && x.address !== entry.address);
    const next = [entry, ...filtered].slice(0, RECENT_DEPLOYS_MAX);
    await chrome.storage.local.set({ [OMO_RECENT_DEPLOYS_KEY]: next });
  } catch {
    /* ignore */
  }
}

/**
 * When viewing someone else’s /profile/… tab — load Postgres-backed deploy index for **their** handle.
 * (Your own merged deploys still live under “Your recent deploys”.)
 */
async function renderProfileRelayDeploys(profileSlugRaw) {
  if (!profileRelayDeploysWrapEl || !profileRelayDeploysListEl) return;
  const slug = decodeURIComponent(String(profileSlugRaw || "").trim())
    .replace(/^@+/, "")
    .toLowerCase();
  if (!slug) {
    profileRelayDeploysWrapEl.hidden = true;
    profileRelayDeploysListEl.replaceChildren();
    return;
  }
  profileRelayDeploysWrapEl.hidden = false;
  profileRelayDeploysListEl.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "Loading relay index…";
  profileRelayDeploysListEl.appendChild(loading);

  const base = RELAY_ORIGIN.replace(/\/$/, "");
  try {
    const r = await fetch(
      `${base}/api/deploy/tokens?fomoUsername=${encodeURIComponent(slug)}&limit=30`,
      { cache: "no-store" }
    );
    const j = await r.json().catch(() => ({}));
    profileRelayDeploysListEl.replaceChildren();
    const tokens = Array.isArray(j.tokens) ? j.tokens : [];
    if (!tokens.length) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent =
        j.indexed === false
          ? "Relay has no deploy database — operator sets DATABASE_URL."
          : "No deploys indexed for this handle on this relay yet.";
      profileRelayDeploysListEl.appendChild(p);
      return;
    }
    for (const row of tokens) {
      if (!row || typeof row !== "object") continue;
      const chain = row.chain === "base" ? "Base" : "Solana";
      const sym = String(row.symbol || "—");
      const nm = String(row.name || "");
      const addr = String(row.tokenAddress || "").trim();
      const fomoU = String(row.fomoFamilyUrl || "").trim();
      const el = document.createElement("div");
      el.className = "recent-deploy-item";
      const title = document.createElement("div");
      title.className = "rd-title";
      title.textContent = `${nm} ($${sym}) · ${chain}`;
      const meta = document.createElement("div");
      meta.className = "rd-meta";
      meta.textContent = addr || "";
      const actions = document.createElement("div");
      actions.className = "recent-deploy-actions";
      if (fomoU) {
        const a = document.createElement("a");
        a.href = fomoU;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open on fomo.family";
        actions.appendChild(a);
      }
      el.appendChild(title);
      el.appendChild(meta);
      el.appendChild(actions);
      profileRelayDeploysListEl.appendChild(el);
    }
  } catch {
    profileRelayDeploysListEl.replaceChildren();
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Could not reach relay deploy list.";
    profileRelayDeploysListEl.appendChild(p);
  }
}

async function renderRecentDeploys() {
  if (!recentDeploysListEl) return;
  const prev = await chrome.storage.local.get([OMO_RECENT_DEPLOYS_KEY]);
  const list = Array.isArray(prev[OMO_RECENT_DEPLOYS_KEY])
    ? prev[OMO_RECENT_DEPLOYS_KEY]
    : [];
  recentDeploysListEl.replaceChildren();
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent =
      "No deploys listed yet — deploy from Omo or wait for the relay index if your relay uses Postgres.";
    recentDeploysListEl.appendChild(p);
    return;
  }
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const chain = row.chain === "base" ? "Base" : "Solana";
    const sym = String(row.symbol || "—");
    const nm = String(row.name || "");
    const addr = String(row.address || "");
    const fomoU = String(row.fomoFamilyUrl || "").trim();
    const el = document.createElement("div");
    el.className = "recent-deploy-item";
    const title = document.createElement("div");
    title.className = "rd-title";
    title.textContent = `${nm} ($${sym}) · ${chain}`;
    const meta = document.createElement("div");
    meta.className = "rd-meta";
    meta.textContent = addr || "";
    const actions = document.createElement("div");
    actions.className = "recent-deploy-actions";
    if (fomoU) {
      const a = document.createElement("a");
      a.href = fomoU;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Open on fomo.family";
      actions.appendChild(a);
    }
    if (row.chain === "base" && addr) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary";
      b.textContent = "Claim fees";
      b.dataset.claimBase = addr;
      actions.appendChild(b);
    }
    el.appendChild(title);
    el.appendChild(meta);
    el.appendChild(actions);
    recentDeploysListEl.appendChild(el);
  }
}

async function claimBaseFees(tokenAddress) {
  const base = RELAY_ORIGIN.replace(/\/$/, "");
  showStatus("Checking fees…", false);
  const { handle } = await resolveFomoHandleForDeploy();
  const rewardRecipient = await getClankerRewardRecipientFromStorage();
  if (!handle) {
    showStatus("Cannot claim — FOMO handle missing. Refresh on fomo.family.", true);
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/i.test(rewardRecipient)) {
    showStatus("Cannot claim — Base wallet missing under You (logged in).", true);
    return;
  }
  try {
    const feesUrl = `${base}/api/base/fees?tokenAddress=${encodeURIComponent(tokenAddress)}&rewardRecipient=${encodeURIComponent(rewardRecipient)}`;
    const fr = await fetch(feesUrl, { cache: "no-store" });
    const fj = await fr.json().catch(() => ({}));
    if (!fr.ok) {
      showStatus(
        typeof fj.error === "string" ? fj.error : "Fee check failed.",
        true
      );
      return;
    }
    const weiStr = fj.availableWei != null ? String(fj.availableWei) : "0";
    let wei;
    try {
      wei = BigInt(weiStr);
    } catch {
      wei = 0n;
    }
    if (wei === 0n) {
      showStatus("No accrued fees to claim for this token.", false);
      return;
    }
    showStatus("Claiming fees on Base (relay pays gas)…", false);
    const res = await fetch(`${base}/api/base/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddress,
        rewardRecipient,
        fomoUsername: handle,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showStatus(
        typeof data.error === "string" ? data.error : `Claim failed (${res.status})`,
        true
      );
      return;
    }
    const ex = typeof data.explorerUrl === "string" ? data.explorerUrl : "";
    showStatus(ex ? `Claim submitted. ${ex}` : "Claim transaction sent.", false);
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), true);
  }
}

/** HTTPS links we allow as deploy result / duplicate-token references. */
function isSafeDeployReferenceUrl(raw) {
  const u = String(raw || "").trim();
  if (!u) return false;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "pump.fun" && url.pathname.startsWith("/coin/")) return true;
    const okFomo =
      url.hostname === "fomo.family" || url.hostname === "www.fomo.family";
    if (
      okFomo &&
      (url.pathname.startsWith("/tokens/solana/") ||
        url.pathname.startsWith("/tokens/base/"))
    ) {
      return true;
    }
    if (url.hostname === "basescan.org" && url.pathname.startsWith("/token/")) return true;
    return false;
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
  if (!isSafeDeployReferenceUrl(href)) {
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

/**
 * Duplicate / forever ticker: show Pump.fun + fomo.family when both exist.
 * @param {string} preambleText
 * @param {{ explorerUrl?: string; fomoFamilyUrl?: string; mintAddress?: string }} orig
 */
function showDeployReferenceLinks(preambleText, orig) {
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
  const pump = String(orig.explorerUrl || "").trim();
  const fomoTok = String(orig.fomoFamilyUrl || "").trim();
  const mint = String(orig.mintAddress || "").trim();
  const fomoFallback =
    !fomoTok && mint ? `https://fomo.family/tokens/solana/${mint}` : "";
  /** @type {{ label: string; href: string }[]} */
  const rows = [];
  if (pump && isSafeDeployReferenceUrl(pump)) {
    rows.push({ label: "Pump.fun", href: pump });
  }
  const fomoHref = fomoTok || fomoFallback;
  if (fomoHref && isSafeDeployReferenceUrl(fomoHref)) {
    rows.push({ label: "fomo.family", href: fomoHref });
  }
  if (rows.length === 0) {
    const fb = document.createElement("div");
    fb.textContent = "No safe token link in response.";
    statusEl.appendChild(fb);
    statusEl.style.borderColor = "#f28b82";
    return;
  }
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "10px";
  for (const { label, href } of rows) {
    const row = document.createElement("div");
    const lab = document.createElement("span");
    lab.textContent = `${label}: `;
    row.appendChild(lab);
    const a = document.createElement("a");
    a.className = "deploy-result-link";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = href;
    row.appendChild(a);
    wrap.appendChild(row);
  }
  statusEl.appendChild(wrap);
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

function syncDeployTargetUi() {
  const clanker = deployTargetEl?.value === "clanker";
  if (baseRewardRowEl) baseRewardRowEl.hidden = !clanker;
}

function setBaseRewardDisplayFromEvm(first) {
  if (!baseRewardDisplayEl) return;
  const t = String(first || "").trim();
  if (t && /^0x[a-fA-F0-9]{40}$/i.test(t)) {
    baseRewardDisplayEl.textContent = t;
    baseRewardDisplayEl.classList.remove("is-placeholder");
    return;
  }
  baseRewardDisplayEl.textContent =
    "Waiting for your EVM wallet from fomo.family — open the site, then tap Refresh.";
  baseRewardDisplayEl.classList.add("is-placeholder");
}

async function getClankerRewardRecipientFromStorage() {
  const evmStore = await chrome.storage.local.get(["lastYouEvm"]);
  const first =
    Array.isArray(evmStore.lastYouEvm) && evmStore.lastYouEvm.length
      ? String(evmStore.lastYouEvm[0] || "").trim()
      : "";
  return first;
}

async function fetchRelayDeployInfo() {
  try {
    const base = RELAY_ORIGIN.replace(/\/$/, "");
    const res = await fetch(`${base}/api/deploy/info`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatStatNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

/**
 * When the relay has not set all three gate env vars, we still show these targets in the UI
 * (same numbers as production README / typical relay defaults).
 */
const DEPLOY_DISPLAY_DEFAULTS = {
  minFollowers: 1000,
  minSwaps: 100,
  /** 48 hours */
  minAvgHoldSeconds: 172800,
};

/**
 * Renders Followers / Trades / Avg hold vs thresholds from GET /api/deploy/info, or vs
 * {@link DEPLOY_DISPLAY_DEFAULTS} when the relay does not publish all three mins.
 * Each row gets a ✓ when your stat meets that row’s minimum.
 */
async function renderDeployGateMetrics(loggedIn) {
  const container = document.getElementById("deployGateMetrics");
  if (!container) return;

  container.replaceChildren();

  if (!loggedIn) {
    container.hidden = true;
    return;
  }

  container.hidden = false;

  const store = await chrome.storage.local.get(["lastYouDeployMetrics"]);
  const raw = store.lastYouDeployMetrics;
  const m = raw && typeof raw === "object" ? raw : {};

  const followers =
    typeof m.followers === "number" && Number.isFinite(m.followers) ? m.followers : null;
  const swaps = typeof m.swaps === "number" && Number.isFinite(m.swaps) ? m.swaps : null;
  const hold =
    typeof m.avgHoldSeconds === "number" && Number.isFinite(m.avgHoldSeconds)
      ? m.avgHoldSeconds
      : null;

  const info = await fetchRelayDeployInfo();
  const dg =
    info?.deployGates && typeof info.deployGates === "object" ? info.deployGates : {};

  const minF = Math.max(0, Number(dg.minFollowers) || 0);
  const minS = Math.max(0, Number(dg.minSwaps) || 0);
  const minH = Math.max(0, Number(dg.minAvgHoldSeconds) || 0);
  /** Matches relay eligibility: all three mins positive on server. */
  const relayEnforcesAllThree = minF > 0 && minS > 0 && minH > 0;

  const dispF = relayEnforcesAllThree ? minF : DEPLOY_DISPLAY_DEFAULTS.minFollowers;
  const dispS = relayEnforcesAllThree ? minS : DEPLOY_DISPLAY_DEFAULTS.minSwaps;
  const dispH = relayEnforcesAllThree ? minH : DEPLOY_DISPLAY_DEFAULTS.minAvgHoldSeconds;

  const title = document.createElement("div");
  title.className = "dgm-title";
  title.textContent = "Deploy stats";
  container.appendChild(title);

  function appendRow(label, value, minVal, formatVal, formatMin) {
    const row = document.createElement("div");
    row.className = "dgm-row";

    const lab = document.createElement("span");
    lab.className = "dgm-label";
    lab.textContent = label;

    const valEl = document.createElement("span");
    valEl.className = "dgm-val";
    valEl.textContent = value == null ? "—" : formatVal(value);

    row.appendChild(lab);
    row.appendChild(valEl);

    const minEl = document.createElement("span");
    minEl.className = "dgm-min";
    minEl.textContent =
      minVal > 0 ? `min ${formatMin(minVal)}` : "";

    const ok = value != null && minVal > 0 && value >= minVal;
    const mark = document.createElement("span");
    mark.className = ok ? "dgm-mark dgm-mark-yes" : "dgm-mark dgm-mark-no";
    mark.textContent = ok ? "✓" : "";
    mark.setAttribute("aria-label", ok ? "Meets this threshold" : "Below this threshold");

    row.appendChild(minEl);
    row.appendChild(mark);

    container.appendChild(row);
  }

  appendRow("Followers", followers, dispF, formatStatNumber, formatStatNumber);
  appendRow("Trades / swaps", swaps, dispS, formatStatNumber, formatStatNumber);
  appendRow(
    "Avg hold time",
    hold,
    dispH,
    formatHoldRequirement,
    formatHoldRequirement
  );

  if (followers == null && swaps == null && hold == null) {
    const nodata = document.createElement("div");
    nodata.className = "dgm-nodata";
    nodata.textContent =
      "No stats yet — browse fomo.family (your profile or balances) until data loads, then tap Refresh.";
    container.appendChild(nodata);
  }
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
        '<span class="muted">Omo hasn’t read your @handle yet — keep using fomo.family until data loads.</span>';
      youAccountLineEl.hidden = false;
    }
  } else {
    youAccountLineEl.innerHTML = "";
    youAccountLineEl.hidden = true;
  }

  if (viewingOtherProfile) {
    foreignProfileSectionEl.hidden = false;
    profileViewingLineEl.innerHTML = `Viewing profile <strong>@${slug}</strong>`;
    await renderProfileRelayDeploys(slug);
  } else {
    foreignProfileSectionEl.hidden = true;
    profileViewingLineEl.innerHTML = "";
    if (profileRelayDeploysWrapEl) profileRelayDeploysWrapEl.hidden = true;
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

  if (foldYouLoggedInEl) foldYouLoggedInEl.open = loggedIn;

  try {
    const pref = await chrome.storage.local.get(["omoDeployTarget"]);
    const dt = pref.omoDeployTarget === "clanker" ? "clanker" : "pump";
    if (deployTargetEl) deployTargetEl.value = dt;
    syncDeployTargetUi();
    try {
      const first = await getClankerRewardRecipientFromStorage();
      setBaseRewardDisplayFromEvm(first);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }

  await renderDeployGateMetrics(loggedIn);
  if (loggedIn && acct) {
    await mergeRelayDeployHistoryForHandle(acct);
  }
  await renderRecentDeploys();
}

deployTargetEl?.addEventListener("change", () => {
  syncDeployTargetUi();
  void chrome.storage.local.set({
    omoDeployTarget: deployTargetEl.value === "clanker" ? "clanker" : "pump",
  });
});

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

  const deployTarget = deployTargetEl?.value === "clanker" ? "clanker" : "pump";

  let rewardRecipient = "";
  if (deployTarget === "clanker") {
    rewardRecipient = await getClankerRewardRecipientFromStorage();
    if (!/^0x[a-fA-F0-9]{40}$/i.test(rewardRecipient)) {
      prepareBtn.disabled = false;
      showStatus(
        "Base (Clanker) sends rewards to your FOMO EVM wallet. Open fomo.family until your wallet appears under You (logged in), then tap Refresh.",
        true
      );
      return;
    }
  }

  const urlManual = imageUrlEl ? String(imageUrlEl.value || "").trim() : "";
  const artFile = imageFileEl?.files?.[0];
  if (urlManual && artFile) {
    prepareBtn.disabled = false;
    showStatus("Use either an image link or a file — not both.", true);
    return;
  }

  let image = urlManual;
  if (artFile) {
    showStatus("Uploading artwork…", false);
    try {
      const fd = new FormData();
      fd.append("file", artFile, artFile.name);
      const up = await fetch(`${base}/api/upload/image`, { method: "POST", body: fd });
      const ju = await up.json().catch(() => ({}));
      if (!up.ok) {
        prepareBtn.disabled = false;
        showStatus(
          typeof ju.error === "string" ? ju.error : `Image upload failed (${up.status})`,
          true
        );
        return;
      }
      image = String(ju.gatewayUrl || ju.ipfsUri || "").trim();
      if (!image) {
        prepareBtn.disabled = false;
        showStatus("Upload did not return an artwork URL.", true);
        return;
      }
    } catch (e) {
      prepareBtn.disabled = false;
      showStatus(e instanceof Error ? e.message : String(e), true);
      return;
    }
  }

  showStatus(
    deployTarget === "clanker"
      ? "Deploying on Base (Clanker)…"
      : "Deploying… (instant when the mint pool has keys; otherwise you’ll see pool-empty — relay fills in background)"
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
      description,
      image,
      website,
      twitter,
      telegram,
      fomoUsername: fomoHandle,
      deployTarget,
      ...(deployTarget === "clanker" && rewardRecipient
        ? { rewardRecipient }
        : {}),
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
      if (data.code === "REWARD_RECIPIENT_REQUIRED") {
        showStatus(
          typeof data.error === "string"
            ? data.error
            : "rewardRecipient required — add your 0x Base wallet for Clanker rewards.",
          true
        );
        return;
      }
      if (data.code === "BASE_DEPLOY_NOT_CONFIGURED") {
        showStatus(
          [
            "Base (Clanker) deploy isn’t configured on the relay yet.",
            "Set BASE_DEPLOY_PRIVATE_KEY (0x + 32-byte hex) and BASE_RPC_URL on the server, then redeploy the API.",
            "",
            typeof data.error === "string" ? data.error : "",
          ]
            .filter(Boolean)
            .join("\n"),
          true
        );
        return;
      }
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
        const g = data.deployGates || {};
        const mr = data.metricsReceived;
        const lines = [
          "You can't deploy yet — meet at least one of these:",
          "",
        ];
        if (typeof g.minFollowers === "number" && g.minFollowers > 0) {
          lines.push(`Followers: ${g.minFollowers}+`);
        }
        if (typeof g.minSwaps === "number" && g.minSwaps > 0) {
          lines.push(`Trades: ${g.minSwaps}+`);
        }
        if (typeof g.minAvgHoldSeconds === "number" && g.minAvgHoldSeconds > 0) {
          lines.push(`Avg hold time: ${formatHoldRequirement(g.minAvgHoldSeconds)}+`);
        }
        if (lines.length <= 2) {
          lines.push("(Relay did not return gate details.)");
        }
        if (
          mr &&
          typeof mr === "object" &&
          typeof g.minAvgHoldSeconds === "number" &&
          g.minAvgHoldSeconds > 0 &&
          typeof mr.avgHoldSeconds !== "number"
        ) {
          lines.push(
            "",
            "Omo didn’t send your average hold time to the relay yet. Open fomo.family (your profile or home), wait for stats to load, then tap Refresh in Omo and try again."
          );
        }
        showStatus(lines.join("\n"), true);
        return;
      }
      if (data.code === "DEPLOY_SYMBOL_DUPLICATE" || data.code === "DEPLOY_SYMBOL_FOREVER") {
        headerError = false;
        renderHeaderBadge(loggedInBadge);
        const orig = data.original || {};
        const symLabel = symbol ? String(symbol).trim().toUpperCase() : "";
        const isForever = data.code === "DEPLOY_SYMBOL_FOREVER";
        const pumpRef =
          typeof orig.explorerUrl === "string" &&
          orig.explorerUrl.includes("pump.fun");
        const fomoRef =
          typeof orig.fomoFamilyUrl === "string" &&
          orig.fomoFamilyUrl.includes("fomo.family");
        let opener;
        if (isForever && pumpRef && fomoRef) {
          opener = symLabel
            ? `The ${symLabel} ticker is reserved — canonical coin on Pump.fun & fomo.family:`
            : `This ticker is reserved — canonical coin on Pump.fun & fomo.family:`;
        } else if (isForever && pumpRef) {
          opener = symLabel
            ? `The ${symLabel} ticker is reserved — use this canonical Pump.fun coin:`
            : `This ticker is reserved — use this canonical Pump.fun coin:`;
        } else if (isForever) {
          opener = symLabel
            ? `Ticker ${symLabel} can only be deployed once through Omo. Here’s the original token on FOMO:`
            : `This ticker can only be deployed once through Omo. Here’s the original token on FOMO:`;
        } else {
          opener = symLabel
            ? `This ticker (${symLabel}) was already used in the last 24 hours on Omo. Here’s the existing token — open the link below on FOMO.`
            : `This ticker was already used in the last 24 hours on Omo. Here’s the existing token — open the link below on FOMO:`;
        }
        const lines = [
          opener,
          "",
          orig.tokenName ? `Original name: ${orig.tokenName}` : "",
          orig.fomoUsername != null && orig.fomoUsername !== ""
            ? `Deployed by: @${orig.fomoUsername}`
            : "",
          orig.mintAddress ? `Mint: ${orig.mintAddress}` : "",
          !isForever &&
          typeof data.retryAfterSec === "number" &&
          data.retryAfterSec > 0
            ? `You can try this ticker again after the cooldown (~${formatRetryHuman(data.retryAfterSec)}).`
            : "",
        ].filter(Boolean);
        const body = lines.join("\n");
        showDeployReferenceLinks(body, orig);
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
    const isClanker = data.deployTarget === "clanker" || data.chain === "base";
    const mintEx = String(data.mintExplorerUrl || "").trim();
    const mint = String(data.mintAddress || data.tokenAddress || "").trim();
    const fomoLink = (
      String(data.fomoFamilyUrl || "").trim() ||
      (mint && !isClanker ? `https://fomo.family/tokens/solana/${mint}` : "") ||
      (mint && isClanker ? `https://fomo.family/tokens/base/${mint}` : "")
    ).trim();
    await recordRecentDeploy({
      name: name,
      symbol: symbol,
      data,
      isClanker,
      fomoLink,
    });
    await renderRecentDeploys();
    if (fomoLink && isSafeDeployReferenceUrl(fomoLink)) {
      showDeployResultLink(
        fomoLink,
        isClanker ? "Deployed on Base (Clanker):" : ""
      );
    } else if (isClanker && mintEx && isSafeDeployReferenceUrl(mintEx)) {
      showDeployResultLink(mintEx, "Deployed on Base (Clanker):");
    } else if (fomoLink) {
      showDeployResultLink(fomoLink);
    } else {
      showStatus("Deployed — no token link in response.", false);
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

recentDeploysListEl?.addEventListener("click", (e) => {
  const t = e.target;
  if (!t || typeof t.closest !== "function") return;
  const btn = t.closest("[data-claim-base]");
  if (!btn) return;
  const addr = btn.getAttribute("data-claim-base");
  if (addr) void claimBaseFees(addr);
});

void refreshFromStorage();
