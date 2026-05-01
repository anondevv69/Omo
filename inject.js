/**
 * Runs in the page (MAIN world). Intercepts FOMO prod-api JSON and posts to the content script.
 * Loaded via chrome.scripting.executeScript (CSP blocks extension <script> tags on fomo.family).
 */
(function () {
  const w = /** @type {Window & { __fomoDeploySniffer?: boolean }} */ (window);
  if (w.__fomoDeploySniffer) return;
  w.__fomoDeploySniffer = true;

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
      url.includes("fomo.family") ||
      (url.includes("solana-provider") && url.includes("fomo.family"))
    );
  }

  function isFomoBackendUrl(url) {
    if (!url || typeof url !== "string") return false;
    return (
      url.includes("prod-api.fomo.family") ||
      url.includes("api.fomo.family") ||
      (url.includes("solana-provider") && url.includes("fomo.family"))
    );
  }

  /** FOMO uses several JSON shapes; token / chart pages may omit `success: true`. */
  function inferLoggedInFromJson(data, url) {
    if (!data || typeof data !== "object") return false;
    if (data.success === false) return false;
    if (data.success === true) return true;
    if (data.responseObject != null) return true;
    if (data.statusCode === 200 && data.message) return true;
    if (url.includes("/v2/") && Object.keys(data).length > 0) return true;
    return false;
  }

  /**
   * Returns true when the URL is a "me" / "self" endpoint that FOMO calls for the logged-in viewer.
   * On these endpoints the response ALWAYS belongs to you — never to another user.
   */
  function isSelfUrl(path) {
    return (
      /\/users\/me(?:\/|$)/i.test(path) ||
      /\/v\d+\/me(?:\/|$)/i.test(path) ||
      /\/auth\/me(?:\/|$)/i.test(path) ||
      /\/profile\/me(?:\/|$)/i.test(path) ||
      /\/auth\/status(?:\/|$)/i.test(path) ||
      /\/user\/me(?:\/|$)/i.test(path)
    );
  }

  function extractRoUserDetail(ro, idHint) {
    if (!ro || typeof ro !== "object") return null;
    const id =
      (typeof ro.id === "string" ? ro.id : null) || idHint || null;
    if (!id) return null;
    const profileHandle =
      (typeof ro.profileHandle === "string" && ro.profileHandle.trim()) ||
      (typeof ro.handle === "string" && ro.handle.trim()) ||
      (typeof ro.username === "string" && ro.username.trim()) ||
      (typeof ro.userName === "string" && ro.userName.trim()) ||
      null;
    return {
      id,
      address: typeof ro.address === "string" ? ro.address : null,
      evmAddress: typeof ro.evmAddress === "string" ? ro.evmAddress : null,
      profileHandle,
    };
  }

  function parseUserDetailFromResponse(url, data) {
    try {
      const u = new URL(url);
      const path = u.pathname || "";
      if (/\/balances/i.test(path)) return null;

      /** "me" / self endpoints — ALWAYS the logged-in viewer; mark with isSelf. */
      if (isSelfUrl(path)) {
        const ro = data?.responseObject ?? data;
        const ud = extractRoUserDetail(ro, null);
        if (ud) return { ...ud, isSelf: true };
        return null;
      }

      /** GET …/userHandle/{handle} or …/handle/{handle} — canonical profile wallets on /profile/:handle */
      const byHandle = path.match(/\/v2\/users\/userHandle\/([^/]+)$/i) ||
        path.match(/\/v3\/users\/userHandle\/([^/]+)$/i) ||
        path.match(/\/v2\/users\/handle\/([^/]+)$/i) ||
        path.match(/\/api\/v\d+\/users\/userHandle\/([^/]+)$/i);
      if (byHandle) {
        const ro = data?.responseObject;
        if (!ro || typeof ro !== "object") return null;
        const hid = typeof ro.id === "string" ? ro.id : null;
        if (!hid) return null;
        return {
          id: hid,
          address: typeof ro.address === "string" ? ro.address : null,
          evmAddress: typeof ro.evmAddress === "string" ? ro.evmAddress : null,
          profileHandle: decodeURIComponent(byHandle[1]),
          isSelf: false,
        };
      }

      if (!/\/users\/[0-9a-f-]{36}$/i.test(path)) return null;
      const m =
        path.match(/\/v2\/users\/([0-9a-f-]{36})$/i) ||
        path.match(/\/v3\/users\/([0-9a-f-]{36})$/i) ||
        path.match(/\/api\/v\d+\/users\/([0-9a-f-]{36})$/i);
      if (!m || !m[1]) return null;
      const ro = data?.responseObject;
      if (!ro || typeof ro !== "object") return null;
      const ud = extractRoUserDetail(ro, m[1]);
      if (!ud) return null;
      return { ...ud, isSelf: false };
    } catch {
      return null;
    }
  }

  function parseBalancesUserId(url) {
    try {
      const p = new URL(url).pathname || "";
      const m =
        p.match(/\/v2\/users\/([0-9a-f-]{36})\/balances$/i) ||
        p.match(/\/v3\/users\/([0-9a-f-]{36})\/balances$/i) ||
        p.match(/\/api\/v\d+\/users\/([0-9a-f-]{36})\/balances$/i);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  /** Wallet rows from balances API — authoritative for "whose" balances (vs blind JSON walk). */
  function extractBalancesStructured(data) {
    const solana = [];
    const evm = [];
    const seenS = new Set();
    const seenE = new Set();

    function pushAddr(raw) {
      if (typeof raw !== "string") return;
      const addr = raw.trim();
      if (!addr) return;
      if (/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
        if (!seenE.has(addr)) {
          seenE.add(addr);
          evm.push(addr);
        }
      } else if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(addr)) {
        if (!seenS.has(addr)) {
          seenS.add(addr);
          solana.push(addr);
        }
      }
    }

    try {
      const balances = data?.responseObject?.balances;
      if (!Array.isArray(balances)) return { solana, evm };
      for (const row of balances) {
        if (!row || typeof row !== "object") continue;
        pushAddr(row.address);
        const bal = row.balance;
        if (bal && typeof bal === "object") {
          pushAddr(bal.address);
          pushAddr(bal.evmAddress);
        }
        pushAddr(row.evmAddress);
        const ut = row.userToken;
        if (ut && typeof ut === "object") pushAddr(ut.userAddress);
        const at = row.activeTrade;
        if (at && typeof at === "object") pushAddr(at.userAddress);
      }
    } catch {
      /* ignore */
    }
    return { solana, evm };
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === "string" ? req : req?.url || "";
      if (!shouldSniffUrl(url)) return res;
      const clone = res.clone();
      const isFomoApi = isFomoBackendUrl(url);

      if (isFomoApi && !clone.ok && (clone.status === 401 || clone.status === 403)) {
        window.postMessage(
          { source: SOURCE, type: "fomo-auth", ok: false },
          "*"
        );
        return res;
      }

      const ct = clone.headers.get("content-type") || "";
      if (!ct.includes("json")) return res;
      clone
        .json()
        .then((data) => {
          if (isFomoApi && clone.ok && inferLoggedInFromJson(data, url)) {
            window.postMessage(
              { source: SOURCE, type: "fomo-auth", ok: true },
              "*"
            );
          }

          const { solana: sWalk, evm: eWalk } = extractFromJson(data);
          const balancesUserId = parseBalancesUserId(url);
          const balancesStructured = balancesUserId
            ? extractBalancesStructured(data)
            : { solana: [], evm: [] };
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
              balancesStructuredSolana: balancesStructured.solana,
              balancesStructuredEvm: balancesStructured.evm,
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
