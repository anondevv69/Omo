# Omo — Chrome extension for fomo.family

<p align="center">
  <img src="icons/icon128.png" alt="Omo" width="128" height="128">
</p>

Omo reads wallet addresses from **[fomo.family](https://fomo.family)** while you browse and can deploy tokens through a **relay**: either **Solana (Pump.fun)** or **Base (Clanker)** — your choice in the popup.

---

## Install in Google Chrome

1. Download or clone this repository.
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
| **You (logged in)** | Your **@handle**, **deploy stats** (followers, trades/swaps, avg hold time vs relay gates when enforced), and Solana / EVM addresses from FOMO’s APIs for *your* session. |
| **This profile** | Only when you’re viewing **someone else’s** profile URL (`/profile/…`). Shows that profile’s wallets. |

Navigating between pages usually updates storage automatically; if something looks stale, open the popup and tap **Refresh**.

---

## Deploying a token

### Choose chain: Solana (Pump) or Base (Clanker)

In **Deploy token**, use **Deploy on**:

| Option | Chain | What happens |
|--------|--------|----------------|
| **Solana · Pump** *(default)* | Solana | Pump.fun–style deploy via the relay; mint on Solana; links point to **fomo.family** Solana token URLs / Solscan as returned by the relay. |
| **Base · Clanker** | Base | Clanker v4 deploy on **Base**; success shows **`fomo.family/tokens/base/0x…`** (and Basescan URLs in the relay payload). The relay pays gas from its Base wallet. |

Your choice is remembered for next time (stored in the extension).

### Fees / rewards

| Chain | Summary |
|--------|---------|
| **Solana · Pump** | Pump tokens use **cashback** to traders. |
| **Base · Clanker** | **Fee rewards** go back to your **FOMO-linked EVM** wallet (shown read-only in the popup when you pick Base). You can’t redirect fees in the extension. |

### Fields (both modes)

1. Stay logged in on **fomo.family** and confirm **You (logged in)** shows your account.
2. Open Omo → expand **Deploy token**.
3. Pick **Solana · Pump** or **Base · Clanker**.
4. Fill **Coin name** and **Ticker** (required). Optionally add **description**, **image URL**, and **social links** (website, X, Telegram).

### Base (Clanker) only — reward wallet

For **Base · Clanker**, **fee rewards** use your **FOMO-linked EVM `0x…` wallet** (the same address shown under **You (logged in)**). The popup shows it **read-only** — you can’t change it there; the relay applies its reward split (e.g. majority to you, small interface fee) to that address.

### Metadata

Deploy goes through the **relay** configured in this build. The relay signs on your behalf. Token metadata can include **Deployed on Omo** and your **FOMO profile link**, plus your optional description and social links — same idea on **Solana** and **Base**, with chain-appropriate metadata formats.

---

## Deployment restrictions (what you might see)

The relay applies the limits below (production defaults; the operator may change them).

### Account identity

- Deploy **requires** knowing **your FOMO @handle**. If Omo can’t resolve it, fix login / refresh on fomo.family until **You (logged in)** shows your handle.

### Eligibility gates (meet **any one** — OR)

You qualify if **any** of these metrics from your FOMO profile meets the threshold:

| Gate | Meaning | Minimum |
|------|---------|---------|
| **Followers** | Minimum follower count | **1,000** |
| **Trades** | Minimum swap/trade count | **100** |
| **Avg hold time** | Minimum average hold duration | **172,800 seconds (48 hours)** |

If deploy fails with an eligibility message, your stats may still be loading — use the site, then **Refresh** in Omo.

### Cooldowns

Cooldowns apply **per chain**: you can deploy on **Solana** and on **Base** according to the relay rules (same ticker may exist on both chains separately).

| Limit | Typical behavior |
|-------|------------------|
| **Per account** | Wait between deploys for the same user *(often **24 hours** per chain)* |
| **Same ticker** | Wait before reusing that symbol on **that chain** *(often **24 hours**)*; duplicates may show a link to the **original** token |

---

## Credits

**made by rayblancoeth <3**
