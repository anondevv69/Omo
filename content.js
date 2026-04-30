/**
 * Solana pubkeys: base58, typically 43–44 chars.
 * EVM addresses: 0x + 40 hex (checksum optional in UI).
 */
const RE_SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const RE_EVM = /\b0x[a-fA-F0-9]{40}\b/g;

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
  const key = addr;
  if (seen.has(key)) return;
  seen.add(key);
  list.push(addr);
}

function extractAddresses(root = document.body) {
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

async function publish() {
  const { solana, evm } = extractAddresses();
  await chrome.storage.session.set({
    lastScanAt: Date.now(),
    lastSolanaAddresses: solana,
    lastEvmAddresses: evm,
    /** @deprecated prefer lastSolanaAddresses — kept for older popup logic */
    lastAddresses: solana,
    lastUrl: location.href,
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SCAN") {
    publish().then(() => {
      const { solana, evm } = extractAddresses();
      sendResponse({ ok: true, solana: solana.length, evm: evm.length });
    });
    return true;
  }
});

void publish();

const mo = new MutationObserver(() => {
  void publish();
});
mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
