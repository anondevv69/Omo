# Omo — Chrome extension for fomo.family

<p align="center">
  <img src="icons/icon128.png" alt="Omo" width="128" height="128">
</p>

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

Deploy goes through the **relay** configured in this build. The relay pays deployment fees and signs on your behalf; metadata can include **Deployed on Omo** and your FOMO profile link.

---

## Deployment restrictions (what you might see)

The relay applies limits below. Values mirror production relay env (operator tunable).

### Account identity

- Deploy **requires** knowing **your FOMO @handle**. If Omo can’t resolve it, fix login / refresh on fomo.family until **You (logged in)** shows your handle.

### Eligibility gates (meet **any one** — OR)

You qualify if **any** of these metrics from your FOMO profile meets the threshold:

| Gate | Meaning | Current minimum |
|------|---------|-----------------|
| **Followers** | Minimum follower count | **1,000** (`FELPER_DEPLOY_MIN_FOLLOWERS`) |
| **Trades** | Minimum swap/trade count | **100** (`FELPER_DEPLOY_MIN_SWAPS`) |
| **Avg hold time** | Minimum average hold duration | **172,800 seconds (48 hours)** (`FELPER_DEPLOY_MIN_AVG_HOLD_SECONDS`) |

If deploy fails with an eligibility message, your stats may still be loading — use the site, then **Refresh** in Omo.

### Cooldowns

| Limit | Current value |
|-------|----------------|
| **Per account** — wait between deploys for the same user | **24 hours** (`FELPER_DEPLOY_USER_COOLDOWN_HOURS` = `24`) |
| **Same ticker** — wait before deploying that symbol again | **24 hours** (`FELPER_DEPLOY_SYMBOL_COOLDOWN_HOURS` = `24`); you may get a link to the **original** token instead |

---

## Credits

**made by rayblancoeth &lt;3**
