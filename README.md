# FinTerm — personal finance terminal

A terminal-style investing dashboard you run on your own computer: live quotes, charts,
news, rates & macro data, company financials and filings, an ETF overlap calculator, a
portfolio simulator, a FIRE & savings planner, and a dashboard of your own positions.

All market data comes from **free, public, non-paywalled sources** (exchanges, government
agencies and the SEC first). No API keys or accounts are needed. Your positions never leave
your machine.

```
npm start          # then open http://localhost:7777
```

Requires **Node.js 18.17+** (no `npm install` needed; there are no runtime dependencies).

## Screens

Use the function keys (or `Alt+1`…`9`), click the bar, or type commands — start typing
anywhere to use the command line.

| Key | Code | Screen | What's on it |
|-----|------|--------|--------------|
| F1 | `HELP` | Help | Commands, keyboard shortcuts, data sources, methodology |
| F2 | `MKT` | Market monitor | US & world indices, futures/commodities, Treasury yields, FX, crypto, sector heatmap, movers, watchlist, headlines, today's economic & earnings calendar |
| F3 | `AAPL` | Security detail | Real-time quote, interactive chart (1D–MAX, line/candles, SMA 50/200, volume), key stats (P/E, P/S, P/B, yield…), performance & risk (returns, volatility, beta, drawdown, RSI), SEC financials (annual/quarterly, margins, FCF, TTM), profile, filings, news. ETFs show top holdings |
| F4 | `NEWS` | News | Top / markets / economy / Fed / earnings / tech / world / SEC, plus news on *your* holdings; tickers you own are highlighted |
| F5 | `ECO` | Rates & macro | Treasury yield curve (today vs 1M vs 1Y), yield & 2s10s history, 16 FRED indicators (CPI, core PCE, unemployment, payrolls, GDP, spreads, mortgage rates…), economic & earnings calendars by day, Fed press releases |
| F6 | `PORT` | My portfolio | Manual positions/lots, cash accounts, live value, day & unrealized P&L, income estimate, allocation by holding/class/sector/account, 1-year risk (volatility, Sharpe, beta, VaR), long/short-term lots, watchlist, CSV/JSON import & export |
| F7 | `OVLP SPY QQQ` | ETF overlap | Up to 6 funds: overlap matrix, pair detail (common holdings, unique holdings), look-through combined exposure by your allocation |
| F8 | `PSIM` | Portfolio simulator | Expected return, CAGR, standard deviation, Sharpe, Sortino, max drawdown, beta, alpha, VaR/CVaR, risk contribution, correlation matrix, backtest vs benchmark, efficient frontier (max-Sharpe / min-vol), Monte Carlo projection |
| F9 | `FIRE` | FIRE & savings | FI number, years to FI, savings rate, Coast/Lean/Fat FI, Monte Carlo success odds, sensitivity table, year-by-year plan, savings-goal calculator, emergency fund |
| F10 | `THEME` | Colors & display | Color wheel (drag to pick, harmony schemes that generate chart palettes, color-blindness simulation and checks), six presets (incl. light and colorblind-safe), every color editable with contrast checks, font size, time zone for timestamps (ET / WIB / local), export/import |
| F11 | `BOND` | Bonds & yields | Government yield curves (Indonesia, US, euro area, Germany, Japan, Canada), 10-year table & spreads, Indonesian IGSYC curve, PHEI fair prices for FR/PBS/ORI/SR series, corporate yields by rating, bond ETFs, price ↔ yield calculator (accrued, duration, convexity, DV01). Search `SBR015T2`, `FR0108`, a US CUSIP or `US10Y` |

### Indonesia

- **Market monitor:** IHSG (Jakarta Composite), LQ45, Jakarta Islamic Index, USD/IDR, 22 IDX blue chips (sortable, with breadth), current BI-Rate and Indonesian headlines (English / Bahasa filter).
- **Macro & rates:** Bank Indonesia BI-Rate decisions with history, rupiah and IHSG 1-year charts, IMF World Economic Outlook indicators (GDP growth, inflation, unemployment, current account, budget, debt, GDP per capita) with projections, Bank Indonesia press releases, and an Indonesia filter on the economic calendar.
- **News:** an Indonesia tab (CNBC Indonesia, Antara, Detik Finance, Bank Indonesia).
- **Stocks:** type any IDX code with `.JK` (e.g. `BBCA.JK`). Prices are in rupiah.
- **Government bonds (SBN):** `BOND` shows PHEI's yield curve and fair prices; add FR, PBS, ORI, SR, SBR or ST series to PORT with **+ Bond**. Floating SBR/ST coupons follow the BI-Rate (reset every 3 months, with a floor); coupons are shown after the 10% final tax.

More commands: `AAPL N` (news), `AAPL FA` (financials), `AAPL CF` (filings), `WATCH TSLA NVDA`,
`PSIM VTI BND`, `NEWS FED`. Symbols use Yahoo-style notation for non-US instruments:
`^GSPC`, `CL=F`, `EURUSD=X`, `BTC-USD`, `7203.T`, `VOD.L`.

## Data sources

| Data | Source | Notes |
|------|--------|-------|
| US stock & ETF quotes | **Nasdaq** (Nasdaq Last Sale) | Real-time during the session |
| Indices, futures, FX, crypto, international | **Yahoo Finance** public chart API | Fallbacks: CBOE delayed index quotes, Nasdaq index quotes, ECB reference FX rates (Frankfurter), CoinGecko |
| Price history | Yahoo Finance (dividend-adjusted) → Nasdaq (split-adjusted, price only) | |
| Treasury yields | **U.S. Department of the Treasury** daily par yield curve | |
| Macro indicators | **FRED**, Federal Reserve Bank of St. Louis | |
| Company financials, profile, filings | **SEC EDGAR** (XBRL company facts, submissions) | |
| ETF holdings | **State Street** daily holdings files (SPDR funds incl. SPY/DIA/MDY); **SEC Form N-PORT** for every other registered fund | N-PORT is quarterly, published up to 60 days after quarter end |
| CUSIP → ticker | SEC fails-to-deliver data | Used to label N-PORT holdings |
| Calendars, movers, per-symbol news | Nasdaq | |
| Crypto markets | CoinGecko | |
| Headlines | CNBC, MarketWatch, Federal Reserve, SEC (RSS); Nasdaq & Yahoo Finance per-symbol | Links go to the original publisher |
| Indonesia | Bank Indonesia (BI-Rate, press releases); IMF World Economic Outlook (World Bank fallback); CNBC Indonesia, Antara, Detik Finance | IDX quotes via Yahoo Finance (delayed); Detik advertorials filtered out |
| Indonesian bonds | **PHEI** (Indonesia Bond Pricing Agency): IGSYC curve, fair prices & yields, corporate yields by rating | End of day. Non-tradable SBR/ST have no market price: valued at nominal |
| Global yield curves | U.S. Treasury, **ECB** (euro-area AAA curve), **Deutsche Bundesbank**, **Ministry of Finance Japan**, **Bank of Canada** | End of day |
| US Treasury securities | **TreasuryDirect** (search by CUSIP) | Terms and auction results |
| Exchange rate on a past date | **ECB** reference rates via Frankfurter | Used for the purchase-date USD/IDR rate |

Every quote shows its source; delayed or stale values are tagged. If a source is unreachable
the app falls back where it can and otherwise shows "unavailable" rather than made-up numbers.

## Your data & privacy

- Positions, cash, watchlist and calculator inputs are saved to `data/user/portfolio.json`
  (git-ignored) and mirrored in your browser's local storage. Use **PORT → Backup JSON** to keep a copy.
- The server binds to `127.0.0.1` only and rejects cross-site requests. Only ticker symbols are
  sent to the public data sources.
## Importing your positions (CSV)

On **PORT** click **CSV format ?** for the full guide and a downloadable example. The example file is
also in this repository at [`public/examples/portfolio-example.csv`](public/examples/portfolio-example.csv):

```csv
symbol,shares,costBasis,purchaseDate,account,assetClass,notes,fxRate,maturity,coupon,couponType,spread
VTI,25,245.10,2024-03-15,Roth IRA,ETF,US total stock market fund,15618,,,,
AAPL,10,172.30,2023-11-20,Taxable,Equity,,15448,,,,
BBCA.JK,500,9250,2024-02-12,IDX Broker,Equity,5 lots,,,,,
BTC-USD,0.05,42000,2024-01-19,Crypto,Crypto,,15608,,,,
FR0106,50000000,97.5,2025-03-04,Bank (SBN),Bond,,,2040-08-15,7.125,fixed,
SBR015T2,10000000,100,2026-10-28,Bank (SBN),Bond,,,2028-10-10,6.75,floating,1.00
```

| Column | Required? | What to put |
|--------|-----------|-------------|
| `symbol` | yes | Ticker. Indonesian stocks end in `.JK` (`BBCA.JK`); crypto like `BTC-USD` |
| `shares` | yes (or `lots`) | Total shares/units. For IDX, 1 lot = 100 shares (a `lots` column is multiplied by 100) |
| `costBasis` | recommended | Average price paid **per share, in the security's own currency** (rupiah for `.JK`). Or `totalCost` |
| `purchaseDate` | optional | `YYYY-MM-DD` |
| `account` | optional | Any label, e.g. `Roth IRA`, `IDX Broker` |
| `assetClass` | optional | `Equity`, `ETF`, `Fund`, `Bond`, `Crypto`, `Commodity`, `Other` |
| `notes` | optional | Free text |
| `exchange` | optional | `IDX` adds `.JK` to plain codes like `BBCA` |
| `fxRate` | optional | USD/IDR on the purchase date — rupiah per 1 US dollar (e.g. `15618`). Fixes your rupiah cost so P&L includes currency moves. Leave blank and use **Tax Lots → Fill missing FX rates** to look it up |
| `maturity`, `coupon` | bonds | Bond rows: put the **nominal** in `shares` and the price paid **as % of nominal** in `costBasis` (100 = par) |
| `couponType`, `spread`, `floor` | bonds | `fixed` or `floating`; floating coupon = BI-Rate + `spread`, never below `floor` (defaults to `coupon`) |
| `frequency`, `taxRate`, `tradable`, `currency` | bonds | Payments per year (12 monthly, 2 semiannual), coupon tax % (10 for SBN), yes/no, IDR/USD. Indonesian series codes fill sensible defaults |

Common broker headers are recognised too (Ticker, Quantity, Avg Cost, Date Acquired, Kode Saham,
Jumlah Lembar, Lot, Harga Rata-rata…), as are semicolon-separated files and rupiah numbers like `Rp 9.250`.

**Currencies:** choose **Base USD** or **Base IDR** on PORT. Each holding is valued in its own
currency and converted with live exchange rates. With a purchase-date `fxRate`, the cost stays at
the rate you actually paid, and the Holdings table splits P&L into **Price P&L** (the security's
move) and **FX P&L** (the rupiah's move). Without it, cost is converted at today's rate (marked `*`).

## Configuration (optional environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `7777` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (set `0.0.0.0` to use from other devices on your network — your positions become visible to them) |
| `SEC_USER_AGENT` | generic | The SEC asks automated tools to identify themselves: set e.g. `"Your Name your@email"` |
| `FRED_API_KEY` | — | Use the official FRED API instead of the public CSV endpoint (free key from fred.stlouisfed.org) |
| `DISABLE_YAHOO` | — | `1` to never call Yahoo Finance (uses the fallbacks only) |
| `FINTERM_DATA_DIR` | `data/user` | Where your portfolio file is stored |
| `LOG_REQUESTS` | — | `1` to log upstream requests |

## Development

```
npm test        # unit tests: statistics, optimiser, Monte Carlo, FIRE math, overlap, parsers, CSV import, FX
npm run dev     # restart the server on file changes
```

## Updating to a newer version

Your positions live in `data/user/portfolio.json`, which is **not** part of the download. To update:

1. Download the new ZIP and unzip it to a new folder.
2. Copy the `data` folder from your old FinTerm folder into the new one (or use PORT → Backup JSON
   before, and Import CSV/JSON after).
3. Start FinTerm from the new folder as usual (`npm start`).

If you use Git, `git pull` in the FinTerm folder updates the code and leaves `data/` untouched.

```
server/            Node HTTP server (no dependencies)
  providers/       Nasdaq, Yahoo, SEC, Treasury/FRED/CBOE/ECB/CoinGecko clients
  services/        quotes (with fallback chain), history, news, ETF holdings
  lib/             fetch wrapper, caches, CSV/XML/ZIP/XLSX readers, symbol & time helpers
  store.js         local portfolio persistence
public/            the terminal UI (vanilla ES modules, SVG charts, no build step)
  js/lib/          pure math shared with the tests: stats.js, fire.js, overlap.js, bonds.js, color.js
  js/screens/      one module per screen
test/              node:test suites and small fixtures captured from the real sources
```

## Methodology notes

- **Portfolio statistics** use daily simple returns of total-return prices with daily
  rebalancing. Expected return = mean × 252, volatility = σ × √252, Sharpe uses the current
  3-month T-bill as the risk-free rate. The efficient frontier is a long-only mean-variance
  optimisation on historical data — illustrative, since historical means are noisy forecasts.
- **Monte Carlo** uses seeded paths (repeatable) with either lognormal returns or a block
  bootstrap of the portfolio's own monthly history.
- **ETF overlap** = Σ min(weight in A, weight in B), with securities matched across issuers
  by CUSIP, ISIN and ticker.
- **Bonds**: street-convention price ↔ yield, actual/actual accrued interest, Macaulay/modified
  duration, convexity and DV01. Floating SBR/ST coupons = BI-Rate + spread with a floor, reset every
  3 months from the BI-Rate in force just before the reset. Coupon income is after the tax you enter.
- **Color checks** (THEME): OKLab ΔE ×100 between neighbouring chart series — ≥ 15 normal vision,
  ≥ 8 under simulated protanopia/deuteranopia (Machado et al. 2009) — and WCAG contrast.
- **FIRE** projections are in today's dollars using real returns; FI number = retirement
  spending ÷ safe withdrawal rate.

*FinTerm is a personal research tool. Data may be delayed or contain errors. Nothing here is
investment, tax or financial advice.*
