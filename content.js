/**
 * Isolated world: DOM scrape + merge addresses sniffed from FOMO API (via inject.js).
 */
const RE_SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const RE_EVM = /\b0x[a-fA-F0-9]{40}\b/g;

const MSG_SOURCE = "fomo-deploy-sniffer";

/** @type {Set<string>} */
const apiSeenSol = new Set();
/** @type {Set<string>} */
const apiSeenEvm = new Set();
/** @type {string[]} */
const apiListSol = [];
/** @type {string[]} */
const apiListEvm = [];

/** Wallets from balances API while URL is /profile/:slug */
const profSeenSol = new Set();
const profSeenEvm = new Set();
const profListSol = [];
const profListEvm = [];
/** @type {string | null} */
let lastProfileSlugPublished = null;

function injectPageScript() {
  try {
    const el = document.createElement("script");
    el.src = chrome.runtime.getURL("inject.js");
    el.onload = () => el.remove();
    (document.head || document.documentElement).appendChild(el);
  } catch (_) {
    /* ignore */
  }
}

injectPageScript();

function currentProfileSlug() {
  const m = location.pathname.match(/^\/profile\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isProfileBalancesUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /\/v2\/users\/[^/]+\/balances/.test(url) && url.includes("prod-api.fomo.family");
}

window.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.source !== MSG_SOURCE || d.type !== "api-sniff") return;

  const slug = currentProfileSlug();

  for (const a of d.solana || []) {
    if (!apiSeenSol.has(a)) {
      apiSeenSol.add(a);
      apiListSol.push(a);
    }
    if (slug && isProfileBalancesUrl(d.url)) {
      if (!profSeenSol.has(a)) {
        profSeenSol.add(a);
        profListSol.push(a);
      }
    }
  }
  for (const a of d.evm || []) {
    if (!apiSeenEvm.has(a)) {
      apiSeenEvm.add(a);
      apiListEvm.push(a);
    }
    if (slug && isProfileBalancesUrl(d.url)) {
      if (!profSeenEvm.has(a)) {
        profSeenEvm.add(a);
        profListEvm.push(a);
      }
    }
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

async function publish() {
  const slug = currentProfileSlug();
  if (slug !== lastProfileSlugPublished) {
    profSeenSol.clear();
    profSeenEvm.clear();
    profListSol.length = 0;
    profListEvm.length = 0;
    lastProfileSlugPublished = slug;
  }

  const dom = extractAddresses();
  const solana = mergeUnique(apiListSol, dom.solana);
  const evm = mergeUnique(apiListEvm, dom.evm);

  await chrome.storage.session.set({
    lastScanAt: Date.now(),
    lastSolanaAddresses: solana,
    lastEvmAddresses: evm,
    lastAddresses: solana,
    lastUrl: location.href,
    lastProfileSlug: slug,
    lastProfileSolana: [...profListSol],
    lastProfileEvm: [...profListEvm],
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SCAN") {
    void publish().then(() => {
      const dom = extractAddresses();
      const solana = mergeUnique(apiListSol, dom.solana);
      const evm = mergeUnique(apiListEvm, dom.evm);
      sendResponse({ ok: true, solana: solana.length, evm: evm.length });
    });
    return true;
  }
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
