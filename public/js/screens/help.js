// HELP — commands, keys, data sources and methodology.
import { h, panel } from '../dom.js';

const SOURCES = [
  ['US stock & ETF quotes', 'Nasdaq (api.nasdaq.com) — Nasdaq Last Sale, real-time during the session', 'Real-time; falls back to Yahoo Finance'],
  ['Indices, futures, FX, crypto, global', 'Yahoo Finance public chart API', 'Real-time to ~15-min delayed depending on exchange; fallbacks: CBOE delayed index quotes, Nasdaq index quotes, ECB reference FX rates, CoinGecko'],
  ['Price history', 'Yahoo Finance (dividend-adjusted closes) → Nasdaq historical (split-adjusted, price only)', 'Daily; intraday for 1D/5D'],
  ['Treasury yields', 'U.S. Department of the Treasury — Daily Par Yield Curve Rates', 'Published each business day after the close'],
  ['Economic indicators', 'FRED®, Federal Reserve Bank of St. Louis', 'As released (monthly/weekly/daily series)'],
  ['Economic & earnings calendars, movers', 'Nasdaq', 'Intraday'],
  ['Company filings, profiles, financials', 'SEC EDGAR — submissions & XBRL company facts', 'As filed'],
  ['ETF holdings', 'State Street (SSGA) daily holdings files; SEC Form N-PORT for all other registered funds', 'SSGA daily; N-PORT quarterly with up to 60-day lag'],
  ['CUSIP → ticker mapping', 'SEC fails-to-deliver data files', 'Twice monthly'],
  ['Crypto market data', 'CoinGecko public API', '~1 minute'],
  ['News', 'CNBC, MarketWatch (Dow Jones), Federal Reserve, SEC press releases (RSS); Nasdaq & Yahoo Finance per-symbol news', 'Every few minutes; links go to the original publisher'],
  ['Indonesia — markets', 'Yahoo Finance: Jakarta Composite (IHSG), LQ45, Jakarta Islamic Index, USD/IDR, IDX stocks (.JK)', 'Delayed (not real-time) per exchange rules; IDX session 09:00–16:00 WIB'],
  ['Indonesia — policy rate & releases', 'Bank Indonesia (bi.go.id): BI-Rate decisions and official press releases', 'After each Board of Governors meeting'],
  ['Indonesia — economy', 'IMF World Economic Outlook (DataMapper); World Bank as fallback', 'Annual, with IMF projections for the current and next years'],
  ['Indonesia — news', 'CNBC Indonesia, Antara (Bahasa & English), Detik Finance (paid advertorials filtered out)', 'Every few minutes'],
  ['Currency conversion', 'Yahoo Finance FX (USD/IDR etc.), ECB reference rates as fallback', 'Live; portfolio cost is converted at today’s rate'],
];

export default {
  id: 'help',
  title: 'Help',
  async mount(root) {
    const grid = h('div', { class: 'grid help' });
    root.append(h('div', { class: 'screen-title' }, h('h1', {}, 'HELP · FINTERM')), grid);
    const P = (title, c) => {
      const p = panel({ title });
      p.el.classList.add(c);
      grid.append(p.el);
      return p;
    };
    const cmd = P('Command Line', 'c6');
    cmd.body.innerHTML = `<p class="prose">Start typing anywhere (or press <kbd>/</kbd>) to use the command line. Press <kbd>Enter</kbd> or <b>GO</b>.</p><dl>
      <dt>AAPL</dt><dd>Security screen: quote, chart, stats, financials, filings, news. Works for ETFs (holdings), indices (^GSPC), futures (CL=F), FX (EURUSD=X), crypto (BTC-USD) and international listings (7203.T, VOD.L).</dd>
      <dt>AAPL N · AAPL FA · AAPL CF</dt><dd>Jump to the news, financials or filings section.</dd>
      <dt>MKT</dt><dd>Market monitor.</dd>
      <dt>NEWS · NEWS FED · TOP</dt><dd>Headlines by category (top, markets, economy, fed, earnings, tech, world, regulatory, mine).</dd>
      <dt>ECO</dt><dd>Treasury curve, macro indicators, economic & earnings calendars.</dd>
      <dt>PORT</dt><dd>Your positions dashboard.</dd>
      <dt>WATCH TSLA NVDA</dt><dd>Add symbols to your watchlist.</dd>
      <dt>OVLP SPY QQQ VTI</dt><dd>ETF overlap and look-through exposure (up to 6 funds).</dd>
      <dt>PSIM VTI BND · PSIM</dt><dd>Portfolio simulator (statistics, frontier, Monte Carlo).</dd>
      <dt>FIRE</dt><dd>FIRE, savings-goal and emergency-fund planner.</dd>
      <dt>THEME</dt><dd>Customize every color, font size and the time zone used for timestamps.</dd>
      <dt>IHSG · BBCA.JK · INDO</dt><dd>Jakarta Composite, an IDX stock (add .JK), Indonesian news.</dd>
    </dl>`;
    const keys = P('Keyboard', 'c6');
    keys.body.innerHTML = `<dl>
      <dt><kbd>F1</kbd>–<kbd>F10</kbd></dt><dd>Switch screens (HELP, MKT, EQ, NEWS, ECO, PORT, OVLP, PSIM, FIRE, THEME). <kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>0</kbd> also works.</dd>
      <dt><kbd>/</kbd> or any letter</dt><dd>Focus the command line.</dd>
      <dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd></dt><dd>Pick an autocomplete suggestion.</dd>
      <dt><kbd>Esc</kbd></dt><dd>Clear the command line / close dialogs.</dd>
      <dt>Click a row</dt><dd>Any ticker row opens that security.</dd>
      <dt>Hover a chart</dt><dd>Crosshair with values; table views accompany every chart.</dd>
    </dl>
    <hr class="sep"><p class="prose"><b class="amber">Your data</b> — positions, watchlist and calculator inputs are saved to <code>data/user/portfolio.json</code> on this computer (mirrored in browser storage). Nothing is sent anywhere except symbol lookups to the public data sources below. Use PORT → Backup JSON to keep a copy.</p>
    <p class="prose"><b class="amber">Currencies</b> — enter each holding's cost in the currency it trades in (rupiah for .JK stocks, dollars for US). Choose USD or IDR as the base currency on PORT; totals, P&amp;L, FIRE and PSIM amounts follow it.</p>`;
    const src = P('Data Sources', 'c12');
    src.body.innerHTML = `<table class="t"><thead><tr><th>Data</th><th>Source</th><th>Timeliness / notes</th></tr></thead><tbody>${SOURCES.map(([a, b, c]) => `<tr><td class="amber">${a}</td><td class="wrap">${b}</td><td class="wrap dim">${c}</td></tr>`).join('')}</tbody></table>`;
    src.setFoot('All sources are free and public, no API keys required. Tags: <span class="tag live">REAL-TIME</span> live exchange data · <span class="tag delayed">D</span> delayed/reference rate · <span class="tag delayed">S</span> last good value (source temporarily unavailable).');
    const meth = P('Methodology', 'c12');
    meth.body.innerHTML = `<div class="prose">
      <p><b class="amber">Portfolio statistics (PSIM, PORT risk)</b> — daily simple returns of total-return prices, portfolio rebalanced daily to target weights. Expected return = mean daily return × 252; standard deviation = daily σ × √252; Sharpe = (expected return − risk-free) ÷ σ with the 3-month T-bill as risk-free; Sortino uses downside deviation; beta/alpha vs the benchmark; VaR/CVaR are historical 95% one-day figures. The efficient frontier is a long-only mean-variance optimisation on the same history (illustrative: historical means are noisy forecasts).</p>
      <p><b class="amber">Monte Carlo</b> — 1,000–5,000 seeded paths of monthly returns, either lognormal with the portfolio's mean and volatility or a block bootstrap (6-month blocks) of the portfolio's own historical monthly returns; contributions added monthly.</p>
      <p><b class="amber">ETF overlap</b> — weight overlap = Σ min(wᴬ, wᴮ) over securities held by both funds, matched by CUSIP, ISIN and ticker. Look-through exposure aggregates each fund's holdings by your allocation.</p>
      <p><b class="amber">FIRE</b> — FI number = annual retirement spending ÷ safe withdrawal rate. Projections use real returns ((1 + nominal) ÷ (1 + inflation) − 1) so values are in today's dollars; FI is reached when assets cover spending net of other income. Monte Carlo success = share of 2,000 lognormal paths that do not run out before the plan's end age.</p>
      <p class="warn">FinTerm is a personal research tool. Data may be delayed or contain errors; nothing here is investment, tax or financial advice.</p></div>`;
  },
};
