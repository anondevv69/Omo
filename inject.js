/**
 * Runs in the page (MAIN world). Intercepts FOMO prod-api JSON and posts to the content script.
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

  function parseUserDetailFromResponse(url, data) {
    try {
      const u = new URL(url);
      const path = u.pathname || "";
      if (!/^\/v2\/users\/[0-9a-f-]{36}$/i.test(path)) return null;
      if (/\/balances/i.test(path)) return null;
      const m = path.match(/^\/v2\/users\/([0-9a-f-]{36})$/i);
      if (!m) return null;
      const ro = data?.responseObject;
      if (!ro || typeof ro !== "object") return null;
      return {
        id: m[1],
        address: typeof ro.address === "string" ? ro.address : null,
        evmAddress: typeof ro.evmAddress === "string" ? ro.evmAddress : null,
      };
    } catch {
      return null;
    }
  }

  function parseBalancesUserId(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/^\/v2\/users\/([0-9a-f-]{36})\/balances$/i);
      return m ? m[1] : null;
    } catch {
      return null;
    }
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
          const { solana: sWalk, evm: eWalk } = extractFromJson(data);
          const balancesUserId = parseBalancesUserId(url);
          const userDetail = parseUserDetailFromResponse(url, data);

          const solana = [...sWalk];
          const evm = [...eWalk];
          if (userDetail?.address && !solana.includes(userDetail.address)) {
            solana.push(userDetail.address);
          }
          if (userDetail?.evmAddress && !evm.includes(userDetail.evmAddress)) {
            evm.push(userDetail.evmAddress);
          }

          if (
            !solana.length &&
            !evm.length &&
            !balancesUserId &&
            !userDetail
          ) {
            return;
          }

          window.postMessage(
            {
              source: SOURCE,
              type: "api-sniff",
              url,
              solana,
              evm,
              balancesUserId,
              userDetail,
            },
            "*"
          );
        })
        .catch(() => {});
    } catch (_) {
      /* ignore */
    }
    return res;
  };
})();
