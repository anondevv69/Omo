# Omo — Chrome extension for fomo.family

Omo reads wallet addresses from **[fomo.family](https://fomo.family)** while you browse and can prepare **Pump.fun** token deploys through a relay server.

> **Publishing this repo:** Put **everything in this folder** at the **root** of your GitHub repo (so `manifest.json` sits next to this `README.md`). This folder is the entire extension — no API server code is included here.

---

## Install in Google Chrome

1. Download or clone this repository (extension files only).
2. Open Chrome and go to **`chrome://extensions`**.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the folder that contains **`manifest.json`** (the extension root folder).

Optional: click the puzzle icon → **pin** Omo so it stays on the toolbar.

---

## Sign in and first-time setup

1. Open **[fomo.family](https://fomo.family)** and **log in** with your normal account (same browser session Chrome uses).
2. Use the site so data loads: scroll charts, open **Holders**, visit **home** or **balances**, or open a **profile** page.
3. Click the **Omo** icon in the toolbar.
4. Click **Refresh** (top right of the popup).

When session data is picked up, the header shows **Logged in** and **You (logged in)** fills with your **@handle** (when available) and wallets.

If wallets stay empty, reload the fomo tab and tap **Refresh** again after FOMO’s API has run.

---

## Finding wallets

The popup has two sections:

| Section | What it shows |
|--------|----------------|
| **You (logged in)** | Your Solana and EVM addresses sniffed from FOMO’s APIs for *your* session. |
| **This profile** | Only when you’re viewing **someone else’s** profile URL (`/profile/…`). Shows that profile’s wallets. |

Navigating between pages usually updates storage automatically; if something looks stale, open the popup and tap **Refresh**.

---

## Deploying a token

1. Stay logged in on **fomo.family** and confirm **You (logged in)** shows your account.
2. Open Omo → expand **Deploy token**.
3. Fill **Coin name** and **Ticker** (required). Optionally add description, image URL, and **social links** (website, X, Telegram).
4. Click **Deploy**.

Deploy goes through the **relay** configured in this build (see **Forking / custom relay** below). The relay pays deployment fees and signs on your behalf; metadata can include **Deployed on Omo** and your FOMO profile link.

---

## Deployment restrictions (what you might see)

The relay operator configures limits. Typical behavior:

### Account identity

- Deploy **requires** knowing **your FOMO @handle**. If Omo can’t resolve it, fix login / refresh on fomo.family until **You (logged in)** shows your handle.

### Eligibility gates

The relay may require you to meet **at least one** of (examples):

- **Followers** — minimum follower count  
- **Trades** — minimum swap/trade count  
- **Avg hold time** — minimum average hold duration  

If deploy fails with an eligibility message, your stats may still be loading — use the site, then **Refresh** in Omo. Thresholds are set on the server, not in the extension.

### Cooldowns

- **Per-account cooldown** — only one deploy per user within a window (often described as a “daily limit”).
- **Same ticker** — deploying the **same symbol** again may be blocked for a period; you may get a link to the **original** token instead.

### Reserved tickers

Some symbols (for example the **`OMO`** ticker) may be limited to **one deploy ever** for the whole product.

### Mint pool / vanity

If the relay uses a **vanity mint pool** (e.g. addresses ending in `omo`) and the pool is empty, deploy may fail until keys are available — wait or contact the operator.

---

## Forking / custom relay

Developers can point Omo at another relay by editing **`RELAY_ORIGIN`** in `popup.js` (near the top), then reloading the extension in `chrome://extensions`.

---

## Credits

**made by rayblancoeth &lt;3**
