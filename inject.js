/**
 * Runs in the page (MAIN world). Intercepts JSON from FOMO APIs and posts wallet-like
 * strings to the content script via window.postMessage.
 */
(function () {
  const SOURCE = "fomo-deploy-sniffer";
  const RE_SOL = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
  const RE_EVM = /\b0x[a-fA-F0-9]{40}\b/g;

  function addMatches(str, sol, evm, seenS, seenE) {
    if (typeof str !== "string" || str.length < 40) return;
    let m;
    const rs = new RegExp(RE_SOL.source, "g");
    while ((m = rs.exec(str))) {
      if (!seenS.has(m[0])) {
        seenS.add(m[0]);
        sol.push(m[0]);
      }
    }
    const re = new RegExp(RE_EVM.source, "g");
    while ((m = re.exec(str))) {
      if (!seenE.has(m[0])) {
        seenE.add(m[0]);
        evm.push(m[0]);
      }
    }
  }

  function walk(val, sol, evm, seenS, seenE) {
    if (val === null || val === undefined) return;
    if (typeof val === "string") {
      addMatches(val, sol, evm, seenS, seenE);
      return;
    }
    if (typeof val !== "object") return;
    if (Array.isArray(val)) {
      for (const item of val) walk(item, sol, evm, seenS, seenE);
      return;
    }
    for (const k of Object.keys(val)) walk(val[k], sol, evm, seenS, seenE);
  }

  function extractFromJson(data) {
    const sol = [];
    const evm = [];
    const seenS = new Set();
    const seenE = new Set();
    walk(data, sol, evm, seenS, seenE);
    return { solana: sol, evm };
  }

  function shouldSniffUrl(url) {
    if (!url || typeof url !== "string") return false;
    return (
      url.includes("prod-api.fomo.family") ||
      url.includes("api.fomo.family") ||
      (url.includes("solana-provider") && url.includes("fomo.family"))
    );
  }

  function emit(url, solana, evm) {
    if (!solana.length && !evm.length) return;
    window.postMessage(
      { source: SOURCE, type: "api-sniff", url, solana, evm },
      "*"
    );
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === "string" ? req : req?.url || "";
      if (!shouldSniffUrl(url)) return res;
      const clone = res.clone();
      const ct = clone.headers.get("content-type") || "";
      if (!ct.includes("json")) return res;
      clone
        .json()
        .then((data) => {
          const { solana, evm } = extractFromJson(data);
          emit(url, solana, evm);
        })
        .catch(() => {});
    } catch (_) {
      /* ignore */
    }
    return res;
  };
})();
