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

Every quote shows its source; delayed or stale values are tagged. If a source is unreachable
the app falls back where it can and otherwise shows "unavailable" rather than made-up numbers.

## Your data & privacy

- Positions, cash, watchlist and calculator inputs are saved to `data/user/portfolio.json`
  (git-ignored) and mirrored in your browser's local storage. Use **PORT → Backup JSON** to keep a copy.
- The server binds to `127.0.0.1` only and rejects cross-site requests. Only ticker symbols are
  sent to the public data sources.
- CSV import recognises common broker headers (`Symbol/Ticker`, `Quantity/Shares`,
  `Avg Cost/Cost Basis/Price`, `Total Cost`, `Date Acquired/Purchase Date`, `Account`).

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
npm test        # unit tests: statistics, optimiser, Monte Carlo, FIRE math, overlap, parsers
npm run dev     # restart the server on file changes
```

```
server/            Node HTTP server (no dependencies)
  providers/       Nasdaq, Yahoo, SEC, Treasury/FRED/CBOE/ECB/CoinGecko clients
  services/        quotes (with fallback chain), history, news, ETF holdings
  lib/             fetch wrapper, caches, CSV/XML/ZIP/XLSX readers, symbol & time helpers
  store.js         local portfolio persistence
public/            the terminal UI (vanilla ES modules, SVG charts, no build step)
  js/lib/          pure math shared with the tests: stats.js, fire.js, overlap.js
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
- **FIRE** projections are in today's dollars using real returns; FI number = retirement
  spending ÷ safe withdrawal rate.

*FinTerm is a personal research tool. Data may be delayed or contain errors. Nothing here is
investment, tax or financial advice.*
