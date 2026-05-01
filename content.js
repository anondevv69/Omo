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
 */
function shouldTrustUserDetailForLoggedInHandle(ud) {
  if (!ud || !ud.id) return false;
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
    addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
    if (typeof ud.profileHandle === "string" && ud.profileHandle.trim() && trustYou) {
      loggedInFomoHandle = ud.profileHandle.trim();
    }
    return;
  }

  const trustGlobal = shouldTrustUserDetailForLoggedInHandle(ud);
  addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
  if (typeof ud.profileHandle === "string" && ud.profileHandle.trim() && trustGlobal) {
    loggedInFomoHandle = ud.profileHandle.trim();
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
    applyUserDetailToBuckets(d.userDetail);
    tryFlushPendingUserDetail();
  }

  void publish();
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
  if (!loggedInFomoHandle) {
    try {
      const r = await chrome.storage.local.get([
        "fomoLoggedIn",
        "lastYouFomoHandle",
      ]);
      if (r.fomoLoggedIn === true) {
        const h = String(r.lastYouFomoHandle || "").trim();
        if (h) loggedInFomoHandle = h;
      }
    } catch {
      /* ignore */
    }
  }

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

  /** When @handle isn’t inferred yet, still tag deploys if viewer’s wallet matches this profile row. */
  let lastDeployFomoHandle = loggedInFomoHandle || "";
  if (!lastDeployFomoHandle && slug) {
    const youSol = primaryWallet(youListSol)[0];
    const profSol = primaryWallet(profileDisplaySol())[0];
    const youEvm = primaryWallet(youListEvm)[0];
    const profEvm = primaryWallet(profileDisplayEvm())[0];
    if (
      (youSol && profSol && youSol === profSol) ||
      (youEvm && profEvm && youEvm === profEvm)
    ) {
      lastDeployFomoHandle = slug;
    }
  }

  await chrome.storage.local.set({
    lastScanAt: Date.now(),
    lastSolanaAddresses: solana,
    lastEvmAddresses: evm,
    lastAddresses: solana,
    lastUrl: location.href,
    lastProfileSlug: slug,
    lastProfileSolana: primaryWallet(profileDisplaySol()),
    lastProfileEvm: primaryWallet(profileDisplayEvm()),
    lastYouSolana: primaryWallet(youListSol),
    lastYouEvm: primaryWallet(youListEvm),
    lastYouFomoHandle: loggedInFomoHandle || "",
    lastDeployFomoHandle: lastDeployFomoHandle || "",
  });
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

function startObservers() {
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
