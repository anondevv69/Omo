/**
 * Isolated world: DOM scrape + FOMO API sniff (inject.js).
 * Splits "you" vs "this profile" using GET /v2/users/{id} vs /balances on /profile/… pages.
 *
 * Uses chrome.storage.local (not session): session storage is blocked from content scripts
 * unless setAccessLevel is used; local avoids "Access to storage is not allowed from this context."
 */
const RE_SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const RE_EVM = /\b0x[a-fA-F0-9]{40}\b/g;

const MSG_SOURCE = "fomo-deploy-sniffer";

/** OMO native mint — thesis deploy comments are only honored on this token page. */
const THESIS_WATCH_MINT =
  "9xpmicYqcLM8aRNeTHpBHQZ6qbqx31X397nR9LKqaomo";

/** All API walk addresses */
const apiSeenSol = new Set();
const apiSeenEvm = new Set();
const apiListSol = [];
const apiListEvm = [];

/** Profile page: balances response wallets */
const profSeenSol = new Set();
const profSeenEvm = new Set();
const profListSol = [];
const profListEvm = [];

/** Logged-in viewer: GET /v2/users/{id} where id ≠ profile balances user */
const youSeenSol = new Set();
const youSeenEvm = new Set();
const youListSol = [];
const youListEvm = [];

/** Profile owner canonical from GET /v2/users/{profileUserId} */
const profileCanonSeenSol = new Set();
const profileCanonSeenEvm = new Set();
const profileCanonListSol = [];
const profileCanonListEvm = [];

/** Structured balances rows keyed by path UUID — fixes profile vs viewer when multiple /balances fire */
/** @type {Map<string, { sol: string[]; evm: string[] }>} */
const balancesByUserId = new Map();

/** @type {string | null} */
let lastProfileSlugPublished = null;
/** Last /balances path UUID seen (legacy fallback only; may be viewer after header refresh) */
let profileBuddyId = null;
/** @type {{ id: string; address: string | null; evmAddress: string | null; profileHandle?: string | null } | null} */
let pendingUserDetail = null;

/** FOMO @handle for the logged-in viewer (from user-detail API), for deploy metadata. */
let loggedInFomoHandle = "";

/** Load sticky handle from storage before processing user-detail (apply runs before publish). */
async function rehydrateLoggedInFomoHandleIfNeeded() {
  if (loggedInFomoHandle) return;
  try {
    const r = await chrome.storage.local.get(["fomoLoggedIn", "lastYouFomoHandle"]);
    if (r.fomoLoggedIn !== false) {
      const h = String(r.lastYouFomoHandle || "").trim();
      if (h) loggedInFomoHandle = h;
    }
  } catch {
    /* ignore */
  }
}

function normalizeHandleForDeployMetrics(h) {
  return String(h || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * Store deploy-gate stats only for the logged-in user's row, after `loggedInFomoHandle` is applied.
 */
async function maybePersistDeployMetrics(d) {
  if (!d.deployMetrics || typeof d.deployMetrics !== "object") return;
  let ownerRaw = d.deployMetricsOwnerHandle;
  if (
    (!ownerRaw || !String(ownerRaw).trim()) &&
    d.userDetail &&
    typeof d.userDetail.profileHandle === "string"
  ) {
    ownerRaw = d.userDetail.profileHandle;
  }
  const owner = normalizeHandleForDeployMetrics(ownerRaw);
  let you = normalizeHandleForDeployMetrics(loggedInFomoHandle);
  if (!you) {
    try {
      const r = await chrome.storage.local.get(["lastYouFomoHandle"]);
      you = normalizeHandleForDeployMetrics(r.lastYouFomoHandle);
    } catch {
      /* ignore */
    }
  }
  if (!owner || !you || owner !== you) return;

  let merged = { ...d.deployMetrics };
  try {
    const prev = await chrome.storage.local.get(["lastYouDeployMetrics"]);
    const p = prev.lastYouDeployMetrics;
    if (p && typeof p === "object") {
      merged = { ...p, ...merged };
    }
  } catch {
    /* ignore */
  }

  await chrome.storage.local.set({
    lastYouDeployMetrics: merged,
    lastYouDeployMetricsAt: Date.now(),
  });
}

function requestMainWorldSniffer() {
  chrome.runtime.sendMessage({ type: "INSTALL_MAIN_SNIFFER" }, () => {
    void chrome.runtime.lastError;
  });
}

requestMainWorldSniffer();

function currentProfileSlug() {
  const m = location.pathname.match(/^\/profile\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Same relay as popup / background — indexed deploys for profile overlay. */
const RELAY_ORIGIN = "https://fomofam-production.up.railway.app";

let omoDeployPanelTimer = 0;

function scheduleOmoDeployProfilePanel() {
  clearTimeout(omoDeployPanelTimer);
  omoDeployPanelTimer = setTimeout(() => void renderOmoDeployProfilePanel(), 400);
}

/**
 * Floating panel on /profile/:handle — tokens this user deployed via Omo (relay Postgres index).
 */
async function renderOmoDeployProfilePanel() {
  const rootId = "omo-deployed-tokens-root";
  const slug = currentProfileSlug();
  if (!slug) {
    document.getElementById(rootId)?.remove();
    return;
  }
  const handle = decodeURIComponent(slug).replace(/^@+/, "").trim().toLowerCase();
  if (!handle) {
    document.getElementById(rootId)?.remove();
    return;
  }

  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement("aside");
    root.id = rootId;
    root.setAttribute("data-omo", "deploy-panel");
    Object.assign(root.style, {
      position: "fixed",
      bottom: "12px",
      right: "12px",
      maxWidth: "300px",
      maxHeight: "min(40vh, 220px)",
      overflowY: "auto",
      zIndex: "2147483646",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "12px",
      lineHeight: "1.35",
      background: "rgba(15, 17, 21, 0.94)",
      color: "#e8eaed",
      borderRadius: "10px",
      padding: "10px 12px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      border: "1px solid rgba(255,255,255,0.08)",
    });
    document.body.appendChild(root);
  }

  const title = document.createElement("div");
  title.style.cssText = "opacity:0.9;font-weight:600;margin-bottom:8px;";
  title.textContent = `Omo deploys · @${handle}`;

  const loading = document.createElement("div");
  loading.style.opacity = "0.65";
  loading.textContent = "Loading…";

  root.replaceChildren(title, loading);

  try {
    const base = RELAY_ORIGIN.replace(/\/$/, "");
    const res = await fetch(
      `${base}/api/deploy/tokens?fomoUsername=${encodeURIComponent(handle)}&limit=25`,
      { cache: "no-store" }
    );
    const j = await res.json().catch(() => ({}));
    const tokens = Array.isArray(j.tokens) ? j.tokens : [];
    if (!tokens.length) {
      root.remove();
      return;
    }

    const frag = document.createDocumentFragment();
    frag.appendChild(title);
    for (const t of tokens) {
      const chain = t.chain === "base" ? "Base" : "Solana";
      const sym = String(t.symbol || "—").toUpperCase();
      const nm = String(t.name || "").trim() || "—";
      const fu = String(t.fomoFamilyUrl || "").trim();
      const row = document.createElement("div");
      row.style.margin = "6px 0";
      if (fu) {
        const a = document.createElement("a");
        a.href = fu;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.cssText = "color:#8ab4f8;text-decoration:none;";
        a.textContent = `${nm} ($${sym}) · ${chain}`;
        row.appendChild(a);
      } else {
        row.textContent = `${nm} ($${sym}) · ${chain}`;
      }
      frag.appendChild(row);
    }
    root.replaceChildren(frag);
  } catch {
    root.remove();
  }
}

function isProfileBalancesUrl(url) {
  if (!url || typeof url !== "string") return false;
  return (
    /\/v2\/users\/[^/]+\/balances/i.test(url) &&
    (url.includes("prod-api.fomo.family") || url.includes("api.fomo.family"))
  );
}

/** Viewer UUID: balances row addresses overlap YOU buckets */
function inferViewerBalancesUserId() {
  const youS = new Set(youListSol);
  const youE = new Set(youListEvm);
  if (!youS.size && !youE.size) return null;
  for (const [uid, pack] of balancesByUserId) {
    const hit =
      pack.sol.some((s) => youS.has(s)) || pack.evm.some((e) => youE.has(e));
    if (hit) return uid;
  }
  return null;
}

/** Profile owner UUID on /profile/… : not the inferred viewer when ≥2 balance fetches exist */
function ownerUuidForProfileCanon() {
  const slug = currentProfileSlug();
  if (!slug) return profileBuddyId;

  const vid = inferViewerBalancesUserId();
  const ids = [...balancesByUserId.keys()];
  if (ids.length === 0) return profileBuddyId;

  if (vid) {
    const others = ids.filter((id) => id !== vid);
    if (others.length >= 1) return others[0];
    return null;
  }

  if (ids.length === 1) {
    const pack = balancesByUserId.get(ids[0]);
    const youS = new Set(youListSol);
    const youE = new Set(youListEvm);
    const looksViewer =
      pack &&
      (pack.sol.some((s) => youS.has(s)) || pack.evm.some((e) => youE.has(e)));
    if (looksViewer) return null;
    return ids[0];
  }

  /** Multiple UUIDs before YOU list filled: same uniqueness rule as profileSolFromStructured */
  const entries = [...balancesByUserId.entries()];
  for (const [uid, pack] of entries) {
    for (const s of pack.sol) {
      let owners = 0;
      for (const [, p] of entries) {
        if (p.sol.includes(s)) owners++;
      }
      if (owners === 1) return uid;
    }
  }

  return ids[0];
}

function profileSolFromStructured() {
  const slug = currentProfileSlug();
  if (!slug) return null;

  const entries = [...balancesByUserId.entries()];
  if (!entries.length) return null;

  const vid = inferViewerBalancesUserId();
  if (vid) {
    const candidates = entries.filter(([uid]) => uid !== vid);
    for (const [, pack] of candidates) {
      if (pack.sol.length || pack.evm.length) return pack;
    }
    /**
     * Own profile often has only one /balances UUID (the viewer). Every other pack was filtered
     * out as "viewer" — use that pack for the profile row when URL handle matches logged-in you.
     */
    const vpack = balancesByUserId.get(vid);
    const ownProfile =
      loggedInFomoHandle &&
      String(slug).toLowerCase() === String(loggedInFomoHandle).toLowerCase();
    if (vpack && (vpack.sol.length || vpack.evm.length) && ownProfile) {
      return vpack;
    }
    return null;
  }

  const youS = new Set(youListSol);
  const youE = new Set(youListEvm);

  /** Pack has at least one wallet not attributed to YOU */
  function packLooksLikeOtherProfile(pack) {
    const nonYouSol = pack.sol.some((s) => !youS.has(s));
    const nonYouEvm = pack.evm.some((e) => !youE.has(e));
    return nonYouSol || nonYouEvm;
  }

  if (youS.size || youE.size) {
    for (const [, pack] of entries) {
      if (packLooksLikeOtherProfile(pack)) return pack;
    }
    return null;
  }

  if (entries.length === 1) {
    const [, pack] = entries[0];
    return pack.sol.length || pack.evm.length ? pack : null;
  }

  /** Two /balances calls before YOU is known: pick pack with a Sol row unique to that UUID */
  for (const [, pack] of entries) {
    for (const s of pack.sol) {
      let owners = 0;
      for (const [, p] of entries) {
        if (p.sol.includes(s)) owners++;
      }
      if (owners === 1) return pack;
    }
  }

  const [, first] = entries[0];
  return first.sol.length || first.evm.length ? first : null;
}

function tryFlushPendingUserDetail() {
  if (!pendingUserDetail) return;
  const ownerId = ownerUuidForProfileCanon();
  if (!ownerId) return;
  const ud = pendingUserDetail;
  pendingUserDetail = null;
  applyUserDetailToBuckets(ud);
}

/**
 * Only set deploy @handle when this user-detail is plausibly the logged-in viewer — not the last
 * random /profile/{other} API response (that caused wrong @FlippingProfits tags).
 * Must be evaluated **before** addCanon(..., youListSol, ...) for the same `ud`, otherwise
 * `alreadyYou` is trivially true for any address we just inserted.
 */
function shouldTrustUserDetailForLoggedInHandle(ud) {
  if (!ud || !ud.id) return false;
  if (ud.isSelf === true) return true;
  const alreadyYou =
    (ud.address && youSeenSol.has(ud.address)) ||
    (ud.evmAddress && youSeenEvm.has(ud.evmAddress));
  const viewerUuid = inferViewerBalancesUserId();
  const uuidMatchesViewer = Boolean(viewerUuid && ud.id === viewerUuid);
  return alreadyYou || uuidMatchesViewer;
}

/** On /profile/You, profile row wallets appear in the viewer's structured balances pack (you viewing your own page). */
function viewerOwnsProfilePageUserDetail(ud) {
  const vid = inferViewerBalancesUserId();
  if (!vid || !ud) return false;
  const pack = balancesByUserId.get(vid);
  if (!pack) return false;
  return (
    (ud.address && pack.sol.includes(ud.address)) ||
    (ud.evmAddress && pack.evm.includes(ud.evmAddress))
  );
}

function applyUserDetailToBuckets(ud) {
  const slug = currentProfileSlug();
  const id = ud.id;
  if (!id) return;

  function addCanon(solArr, evmArr, seenS, seenE, addr, evmA) {
    if (addr && !seenS.has(addr)) {
      seenS.add(addr);
      solArr.push(addr);
    }
    if (evmA && !seenE.has(evmA)) {
      seenE.add(evmA);
      evmArr.push(evmA);
    }
  }

  if (slug) {
    const ph = ud.profileHandle;
    /**
     * On `/profile/SomeoneElse`, FOMO still loads **your** user row (nav / session). `ph` is your
     * handle; URL `slug` is who you're viewing — add to YOU only, do not touch their profile row.
     */
    if (
      typeof ph === "string" &&
      ph.trim() &&
      loggedInFomoHandle &&
      String(ph).toLowerCase() === String(loggedInFomoHandle).toLowerCase() &&
      String(slug).toLowerCase() !== String(ph).toLowerCase()
    ) {
      addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
      return;
    }
    if (
      ph &&
      String(ph).toLowerCase() === String(slug).toLowerCase()
    ) {
      profileCanonSeenSol.clear();
      profileCanonSeenEvm.clear();
      profileCanonListSol.length = 0;
      profileCanonListEvm.length = 0;
      addCanon(
        profileCanonListSol,
        profileCanonListEvm,
        profileCanonSeenSol,
        profileCanonSeenEvm,
        ud.address,
        ud.evmAddress
      );
      if (
        typeof ph === "string" &&
        ph.trim() &&
        (shouldTrustUserDetailForLoggedInHandle(ud) || viewerOwnsProfilePageUserDetail(ud))
      ) {
        loggedInFomoHandle = ph.trim();
        pushYouFromDetail(ud);
      }
      pendingUserDetail = null;
      return;
    }

    const ownerId = ownerUuidForProfileCanon();
    if (ownerId && id === ownerId) {
      addCanon(
        profileCanonListSol,
        profileCanonListEvm,
        profileCanonSeenSol,
        profileCanonSeenEvm,
        ud.address,
        ud.evmAddress
      );
      pendingUserDetail = null;
      return;
    }
    if (!ownerId) {
      pendingUserDetail = ud;
      return;
    }
    const trustYou = shouldTrustUserDetailForLoggedInHandle(ud);
    if (trustYou) {
      addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
      if (typeof ud.profileHandle === "string" && ud.profileHandle.trim()) {
        loggedInFomoHandle = ud.profileHandle.trim();
      }
    }
    return;
  }

  /**
   * Non-profile pages (home, token, etc.): trust viewer correlation, `isSelf`, OR the first
   * user-detail that has both id + profileHandle (nav/session fetch is always the logged-in user).
   * We rehydrated loggedInFomoHandle already; if still empty, this first detail is safe to trust.
   */
  const hasHandle = typeof ud.profileHandle === "string" && ud.profileHandle.trim();
  const trustGlobal =
    shouldTrustUserDetailForLoggedInHandle(ud) ||
    (hasHandle && !loggedInFomoHandle && ud.id && (ud.address || ud.evmAddress));
  if (trustGlobal) {
    addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
    if (hasHandle) {
      loggedInFomoHandle = ud.profileHandle.trim();
    }
  }
}

function pushYouFromDetail(ud) {
  if (ud.address && !youSeenSol.has(ud.address)) {
    youSeenSol.add(ud.address);
    youListSol.push(ud.address);
  }
  if (ud.evmAddress && !youSeenEvm.has(ud.evmAddress)) {
    youSeenEvm.add(ud.evmAddress);
    youListEvm.push(ud.evmAddress);
  }
}

/**
 * When `responseObject.address` is missing but the JSON walk found wallets, still fill profile canon
 * for this slug (profile pages skip blind walks into apiList).
 */
function supplementProfileCanonFromSniffIfSlugMatches(slug, d) {
  const ud = d.userDetail;
  const ph = ud && ud.profileHandle;
  if (!slug || !ph || String(ph).toLowerCase() !== String(slug).toLowerCase()) return;

  const reSol = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
  const reEvm = /^0x[a-fA-F0-9]{40}$/i;
  let added = 0;
  const max = 12;
  for (const a of d.solana || []) {
    if (added >= max) break;
    if (typeof a !== "string" || !reSol.test(a)) continue;
    if (profileCanonSeenSol.has(a)) continue;
    profileCanonSeenSol.add(a);
    profileCanonListSol.push(a);
    added++;
  }
  for (const a of d.evm || []) {
    if (added >= max) break;
    if (typeof a !== "string" || !reEvm.test(a)) continue;
    if (profileCanonSeenEvm.has(a)) continue;
    profileCanonSeenEvm.add(a);
    profileCanonListEvm.push(a);
    added++;
  }
}

function recordBalancesStructured(d) {
  const uid = d.balancesUserId;
  if (!uid) return;

  const sol = Array.isArray(d.balancesStructuredSolana)
    ? [...d.balancesStructuredSolana]
    : [];
  const evm = Array.isArray(d.balancesStructuredEvm)
    ? [...d.balancesStructuredEvm]
    : [];

  if (!sol.length && !evm.length) return;

  balancesByUserId.set(uid, { sol, evm });
  profileBuddyId = uid;

  tryFlushPendingUserDetail();
}

function handleThesisComments(d) {
  try {
    const path = location.pathname || "";
    if (!path.includes(`/tokens/solana/${THESIS_WATCH_MINT}`)) return;

    const comments = Array.isArray(d.comments) ? d.comments : [];
    for (const c of comments) {
      const handle = c?._omoResolvedHandle;
      const id = c?.id;
      const name = c?._omoThesisName;
      const symbol = c?._omoThesisSymbol;
      if (!handle || id == null || !name || !symbol) continue;

      chrome.runtime.sendMessage({
        type: "THESIS_DEPLOY_REQUEST",
        payload: {
          commentId: String(id),
          name: String(name).trim(),
          symbol: String(symbol).trim(),
          fomoUsername: String(handle).trim(),
          deployMetrics: c._omoDeployMetrics || undefined,
        },
      });
    }
  } catch {
    /* ignore */
  }
}

window.addEventListener("message", (event) => {
  const d = event.data;
  if (d?.source === MSG_SOURCE && d.type === "fomo-auth") {
    const ok = d.ok === true;
    void chrome.storage.local.set({
      fomoLoggedIn: ok,
      fomoAuthAt: Date.now(),
      ...(ok
        ? {}
        : {
            lastYouFomoHandle: "",
            lastDeployFomoHandle: "",
          }),
    });
    if (!ok) loggedInFomoHandle = "";
    return;
  }
  if (d?.source === MSG_SOURCE && d.type === "thesis-comments") {
    handleThesisComments(d);
    return;
  }
  if (!d || d.source !== MSG_SOURCE || d.type !== "api-sniff") return;

  const hasWalletPayload =
    (d.solana && d.solana.length > 0) ||
    (d.evm && d.evm.length > 0) ||
    !!d.balancesUserId ||
    !!d.userDetail;
  if (hasWalletPayload) {
    void chrome.storage.local.set({ fomoLoggedIn: true, fomoAuthAt: Date.now() });
  }

  if (
    d.balancesUserId &&
    (d.balancesStructuredSolana?.length || d.balancesStructuredEvm?.length)
  ) {
    recordBalancesStructured(d);
  }

  const slug = currentProfileSlug();
  /** On /profile/* skip blind JSON walk — it pulls every mint/program ID into "all wallets". */
  if (!slug) {
    for (const a of d.solana || []) {
      if (!apiSeenSol.has(a)) {
        apiSeenSol.add(a);
        apiListSol.push(a);
      }
    }
    for (const a of d.evm || []) {
      if (!apiSeenEvm.has(a)) {
        apiSeenEvm.add(a);
        apiListEvm.push(a);
      }
    }
  }

  const hasBalancesStruct =
    (d.balancesStructuredSolana?.length ?? 0) > 0 ||
    (d.balancesStructuredEvm?.length ?? 0) > 0;
  if (
    slug &&
    d.balancesUserId &&
    isProfileBalancesUrl(d.url) &&
    !hasBalancesStruct
  ) {
    const vid = inferViewerBalancesUserId();
    const skipProfWalk =
      vid && d.balancesUserId === vid && balancesByUserId.size > 1;
    if (!skipProfWalk) {
      for (const a of d.solana || []) {
        if (!profSeenSol.has(a)) {
          profSeenSol.add(a);
          profListSol.push(a);
        }
      }
      for (const a of d.evm || []) {
        if (!profSeenEvm.has(a)) {
          profSeenEvm.add(a);
          profListEvm.push(a);
        }
      }
    }
  }

  if (d.userDetail) {
    void (async () => {
      await rehydrateLoggedInFomoHandleIfNeeded();
      applyUserDetailToBuckets(d.userDetail);
      tryFlushPendingUserDetail();
      supplementProfileCanonFromSniffIfSlugMatches(slug, d);
      await maybePersistDeployMetrics(d);
      await publish();
    })();
  } else {
    void (async () => {
      await rehydrateLoggedInFomoHandleIfNeeded();
      await maybePersistDeployMetrics(d);
      await publish();
    })();
  }
});

function collectText(el) {
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const t = node.nodeValue;
      if (!t || !t.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) out.push(n.nodeValue);
  return out.join("\n");
}

function uniqPush(seen, list, addr) {
  if (seen.has(addr)) return;
  seen.add(addr);
  list.push(addr);
}

function extractAddresses(root = document.body) {
  if (!root) return { solana: [], evm: [] };

  const haystack = [
    collectText(root),
    ...[...root.querySelectorAll("[title],[aria-label],[data-address],[href]")].map((el) =>
      [
        el.getAttribute("title"),
        el.getAttribute("aria-label"),
        el.getAttribute("data-address"),
        el.getAttribute("href"),
      ]
        .filter(Boolean)
        .join(" ")
    ),
  ].join("\n");

  const seenSol = new Set();
  const seenEvm = new Set();
  const solana = [];
  const evm = [];

  let m;
  const reSol = new RegExp(RE_SOLANA.source, "g");
  while ((m = reSol.exec(haystack))) uniqPush(seenSol, solana, m[0]);

  const reEvm = new RegExp(RE_EVM.source, "g");
  while ((m = reEvm.exec(haystack))) uniqPush(seenEvm, evm, m[0]);

  return { solana, evm };
}

function mergeUnique(primary, secondary) {
  const seen = new Set(primary);
  const out = [...primary];
  for (const x of secondary) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** One primary wallet per bucket for UI (same as YOU: single Sol + single EVM). */
function primaryWallet(list) {
  const first = list?.find((x) => typeof x === "string" && x.trim());
  return first ? [first] : [];
}

function pageScanSolanaEvm(slug, dom) {
  if (slug) {
    return {
      solana: mergeUnique(primaryWallet(youListSol), primaryWallet(profileDisplaySol())),
      evm: mergeUnique(primaryWallet(youListEvm), primaryWallet(profileDisplayEvm())),
    };
  }
  return {
    solana: mergeUnique(apiListSol, dom.solana),
    evm: mergeUnique(apiListEvm, dom.evm),
  };
}

/** Prefer structured balances (wallet per row), then GET /users/{owner} canon, then DOM/walk */
function profileDisplaySol() {
  const fromBal = profileSolFromStructured();
  if (fromBal?.sol?.length) return [...fromBal.sol];
  if (profileCanonListSol.length) return [...profileCanonListSol];
  return [...profListSol];
}

function profileDisplayEvm() {
  const fromBal = profileSolFromStructured();
  if (fromBal?.evm?.length) return [...fromBal.evm];
  if (profileCanonListEvm.length) return [...profileCanonListEvm];
  return [...profListEvm];
}

async function publish() {
  await rehydrateLoggedInFomoHandleIfNeeded();

  const slug = currentProfileSlug();
  /** Do not clear the viewer handle when URL is another profile — we only set it via trusted user-detail / own-wallet rules. */

  if (slug !== lastProfileSlugPublished) {
    profSeenSol.clear();
    profSeenEvm.clear();
    profListSol.length = 0;
    profListEvm.length = 0;
    profileCanonSeenSol.clear();
    profileCanonSeenEvm.clear();
    profileCanonListSol.length = 0;
    profileCanonListEvm.length = 0;
    balancesByUserId.clear();
    profileBuddyId = null;
    pendingUserDetail = null;
    lastProfileSlugPublished = slug;
  }

  const dom = extractAddresses();
  const { solana, evm } = pageScanSolanaEvm(slug, dom);

  /**
   * When @handle isn’t inferred yet, still tag deploys if viewer’s wallet matches this profile row.
   * Use URL `slug` only when: no handle yet (own-profile wallet match) **or** slug matches the
   * handle we already trust — so visiting someone else’s `/profile/them` never sets `them`.
   */
  let lastDeployFomoHandle = loggedInFomoHandle || "";
  if (!lastDeployFomoHandle && slug) {
    const youSol = primaryWallet(youListSol)[0];
    const profSol = primaryWallet(profileDisplaySol())[0];
    const youEvm = primaryWallet(youListEvm)[0];
    const profEvm = primaryWallet(profileDisplayEvm())[0];
    const walletMatch =
      (youSol && profSol && youSol === profSol) ||
      (youEvm && profEvm && youEvm === profEvm);
    const slugMatchesLoggedIn =
      Boolean(loggedInFomoHandle) &&
      String(slug).toLowerCase() === String(loggedInFomoHandle).toLowerCase();
    if (walletMatch && (!loggedInFomoHandle || slugMatchesLoggedIn)) {
      lastDeployFomoHandle = slug;
    }
  }

  let lastYouSolForStorage = primaryWallet(youListSol);
  let lastYouEvmForStorage = primaryWallet(youListEvm);
  /**
   * Popup "You" reads lastYouSolana — only filled from youListSol above. Handle often comes from
   * storage merge while wallets stay empty when /leaderboard returned 304 or user-detail raced.
   * On non-profile pages, fall back to API-sniffed wallets (then full merged scan).
   */
  if (
    !lastYouSolForStorage[0] &&
    !lastYouEvmForStorage[0] &&
    !slug &&
    loggedInFomoHandle
  ) {
    lastYouSolForStorage = primaryWallet(apiListSol);
    lastYouEvmForStorage = primaryWallet(apiListEvm);
    if (!lastYouSolForStorage[0] && !lastYouEvmForStorage[0]) {
      lastYouSolForStorage = primaryWallet(solana);
      lastYouEvmForStorage = primaryWallet(evm);
    }
  }
  if (
    !lastYouSolForStorage[0] &&
    !lastYouEvmForStorage[0] &&
    slug &&
    loggedInFomoHandle &&
    String(slug).toLowerCase() === String(loggedInFomoHandle).toLowerCase()
  ) {
    lastYouSolForStorage = primaryWallet(profileDisplaySol());
    lastYouEvmForStorage = primaryWallet(profileDisplayEvm());
  }

  let prevSnap = { fomoLoggedIn: undefined, lastYouFomoHandle: "", lastDeployFomoHandle: "" };
  try {
    prevSnap = await chrome.storage.local.get([
      "fomoLoggedIn",
      "lastYouFomoHandle",
      "lastDeployFomoHandle",
    ]);
  } catch {
    /* ignore */
  }
  const loggedOut = prevSnap.fomoLoggedIn === false;
  const prevYouH = loggedOut ? "" : String(prevSnap.lastYouFomoHandle || "").trim();
  const prevDepH = loggedOut ? "" : String(prevSnap.lastDeployFomoHandle || "").trim();
  const nextYouHandle = (loggedInFomoHandle || "").trim() || prevYouH;
  const nextDepH = (lastDeployFomoHandle || "").trim() || prevDepH;

  await chrome.storage.local.set({
    lastScanAt: Date.now(),
    lastSolanaAddresses: solana,
    lastEvmAddresses: evm,
    lastAddresses: solana,
    lastUrl: location.href,
    lastProfileSlug: slug,
    lastProfileSolana: primaryWallet(profileDisplaySol()),
    lastProfileEvm: primaryWallet(profileDisplayEvm()),
    lastYouSolana: lastYouSolForStorage,
    lastYouEvm: lastYouEvmForStorage,
    lastYouFomoHandle: nextYouHandle,
    lastDeployFomoHandle: nextDepH,
  });

  scheduleOmoDeployProfilePanel();
}

/** MV3 popup awaits this — use Promise return, not sendResponse + return true (channel closes). */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "SCAN") return;

  return publish()
    .then(() => {
      const dom = extractAddresses();
      const slug = currentProfileSlug();
      const { solana, evm } = pageScanSolanaEvm(slug, dom);
      return {
        ok: true,
        solana: solana.length,
        evm: evm.length,
      };
    })
    .catch((err) => ({
      ok: false,
      error: String(err?.message || err),
    }));
});

/**
 * fomo.family is a SPA: pathname can change without reload. MutationObserver alone may not run
 * when navigation is cheap — hook history so profile wallets / slug update without tapping Refresh.
 */
function hookSpaNavigationForPublish() {
  const notify = () => {
    void publish();
  };
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function pushStateWrapped(...args) {
    const r = origPush.apply(this, args);
    notify();
    return r;
  };
  history.replaceState = function replaceStateWrapped(...args) {
    const r = origReplace.apply(this, args);
    notify();
    return r;
  };
  window.addEventListener("popstate", notify);
}

function startObservers() {
  hookSpaNavigationForPublish();
  void publish();
  const mo = new MutationObserver(() => {
    void publish();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startObservers);
} else {
  startObservers();
}
