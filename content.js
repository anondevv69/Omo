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

/** @type {string | null} */
let lastProfileSlugPublished = null;
/** User id from latest /balances on this profile tab */
let profileBuddyId = null;
/** @type {{ id: string; address: string | null; evmAddress: string | null } | null} */
let pendingUserDetail = null;

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
  return /\/v2\/users\/[^/]+\/balances/i.test(url) && url.includes("prod-api.fomo.family");
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
    if (profileBuddyId && id === profileBuddyId) {
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
    if (!profileBuddyId) {
      pendingUserDetail = ud;
      return;
    }
    addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
    return;
  }

  addCanon(youListSol, youListEvm, youSeenSol, youSeenEvm, ud.address, ud.evmAddress);
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

function onBalancesSniff(balancesUserId) {
  const slug = currentProfileSlug();
  if (!slug || !balancesUserId) return;
  profileBuddyId = balancesUserId;
  if (pendingUserDetail) {
    if (pendingUserDetail.id === profileBuddyId) {
      applyUserDetailToBuckets(pendingUserDetail);
    } else {
      pushYouFromDetail(pendingUserDetail);
    }
    pendingUserDetail = null;
  }
}

window.addEventListener("message", (event) => {
  const d = event.data;
  if (d?.source === MSG_SOURCE && d.type === "fomo-auth") {
    void chrome.storage.local.set({
      fomoLoggedIn: d.ok === true,
      fomoAuthAt: Date.now(),
    });
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

  if (d.balancesUserId) {
    onBalancesSniff(d.balancesUserId);
  }

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

  const slug = currentProfileSlug();
  if (slug && d.balancesUserId && isProfileBalancesUrl(d.url)) {
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

  if (d.userDetail) {
    applyUserDetailToBuckets(d.userDetail);
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

/** Prefer canonical profile wallets when present */
function profileDisplaySol() {
  return profileCanonListSol.length ? [...profileCanonListSol] : [...profListSol];
}

function profileDisplayEvm() {
  return profileCanonListEvm.length ? [...profileCanonListEvm] : [...profListEvm];
}

async function publish() {
  const slug = currentProfileSlug();
  if (slug !== lastProfileSlugPublished) {
    profSeenSol.clear();
    profSeenEvm.clear();
    profListSol.length = 0;
    profListEvm.length = 0;
    profileCanonSeenSol.clear();
    profileCanonSeenEvm.clear();
    profileCanonListSol.length = 0;
    profileCanonListEvm.length = 0;
    profileBuddyId = null;
    pendingUserDetail = null;
    lastProfileSlugPublished = slug;
  }

  const dom = extractAddresses();
  const solana = mergeUnique(apiListSol, dom.solana);
  const evm = mergeUnique(apiListEvm, dom.evm);

  await chrome.storage.local.set({
    lastScanAt: Date.now(),
    lastSolanaAddresses: solana,
    lastEvmAddresses: evm,
    lastAddresses: solana,
    lastUrl: location.href,
    lastProfileSlug: slug,
    lastProfileSolana: profileDisplaySol(),
    lastProfileEvm: profileDisplayEvm(),
    lastYouSolana: [...youListSol],
    lastYouEvm: [...youListEvm],
  });
}

/** MV3 popup awaits this — use Promise return, not sendResponse + return true (channel closes). */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "SCAN") return;

  return publish()
    .then(() => {
      const dom = extractAddresses();
      const solana = mergeUnique(apiListSol, dom.solana);
      return {
        ok: true,
        solana: solana.length,
        evm: mergeUnique(apiListEvm, dom.evm).length,
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
