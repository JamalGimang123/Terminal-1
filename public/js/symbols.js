// Display names and the instrument universes used on the market monitor.
export const NAMES = {
  '^GSPC': 'S&P 500', '^DJI': 'Dow Jones Industrial', '^IXIC': 'Nasdaq Composite', '^NDX': 'Nasdaq-100', '^RUT': 'Russell 2000', '^VIX': 'CBOE Volatility (VIX)',
  '^FTSE': 'FTSE 100', '^GDAXI': 'DAX', '^FCHI': 'CAC 40', '^STOXX50E': 'Euro Stoxx 50', '^N225': 'Nikkei 225', '^HSI': 'Hang Seng', '000001.SS': 'Shanghai Composite', '^KS11': 'KOSPI', '^GSPTSE': 'S&P/TSX', '^BSESN': 'BSE Sensex', '^AXJO': 'S&P/ASX 200',
  'ES=F': 'S&P 500 E-mini', 'NQ=F': 'Nasdaq-100 E-mini', 'YM=F': 'Dow E-mini', 'RTY=F': 'Russell 2000 E-mini',
  'CL=F': 'WTI Crude Oil', 'BZ=F': 'Brent Crude', 'NG=F': 'Natural Gas', 'GC=F': 'Gold', 'SI=F': 'Silver', 'HG=F': 'Copper', 'ZC=F': 'Corn', 'ZW=F': 'Wheat',
  'DX-Y.NYB': 'US Dollar Index', 'EURUSD=X': 'EUR/USD', 'JPY=X': 'USD/JPY', 'GBPUSD=X': 'GBP/USD', 'CNY=X': 'USD/CNY', 'CAD=X': 'USD/CAD', 'AUDUSD=X': 'AUD/USD', 'CHF=X': 'USD/CHF', 'MXN=X': 'USD/MXN',
  'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum', 'SOL-USD': 'Solana',
  '^TNX': 'US 10Y Yield', '^IRX': 'US 13W Bill', '^FVX': 'US 5Y Yield', '^TYX': 'US 30Y Yield',
  // Indonesia
  '^JKSE': 'Jakarta Composite (IHSG)', '^JKLQ45': 'LQ45 Index', '^JKII': 'Jakarta Islamic Index', 'IDR=X': 'USD/IDR (Rupiah)', EIDO: 'iShares MSCI Indonesia ETF (US$)',
};

export const SHORT = {
  '^GSPC': 'SPX', '^DJI': 'INDU', '^IXIC': 'CCMP', '^NDX': 'NDX', '^RUT': 'RTY', '^VIX': 'VIX', '^FTSE': 'UKX', '^GDAXI': 'DAX', '^FCHI': 'CAC', '^STOXX50E': 'SX5E', '^N225': 'NKY', '^HSI': 'HSI', '000001.SS': 'SHCOMP', '^KS11': 'KOSPI', '^GSPTSE': 'TSX', '^BSESN': 'SENSEX', '^AXJO': 'AS51',
  'ES=F': 'ES1', 'NQ=F': 'NQ1', 'YM=F': 'YM1', 'RTY=F': 'RTY1', 'CL=F': 'CL1', 'BZ=F': 'CO1', 'NG=F': 'NG1', 'GC=F': 'GC1', 'SI=F': 'SI1', 'HG=F': 'HG1', 'ZC=F': 'C1', 'ZW=F': 'W1',
  'DX-Y.NYB': 'DXY', 'EURUSD=X': 'EURUSD', 'JPY=X': 'USDJPY', 'GBPUSD=X': 'GBPUSD', 'CNY=X': 'USDCNY', 'CAD=X': 'USDCAD', 'AUDUSD=X': 'AUDUSD', 'CHF=X': 'USDCHF', 'MXN=X': 'USDMXN',
  'BTC-USD': 'BTC', 'ETH-USD': 'ETH', 'SOL-USD': 'SOL',
  '^JKSE': 'JCI', '^JKLQ45': 'LQ45', '^JKII': 'JII', 'IDR=X': 'USDIDR',
};

// Indonesian large caps (IDX, prices in IDR). Order ≈ market capitalisation.
export const ID_STOCKS = [
  ['BBCA.JK', 'Bank Central Asia'], ['BBRI.JK', 'Bank Rakyat Indonesia'], ['BMRI.JK', 'Bank Mandiri'], ['TLKM.JK', 'Telkom Indonesia'],
  ['ASII.JK', 'Astra International'], ['BBNI.JK', 'Bank Negara Indonesia'], ['AMMN.JK', 'Amman Mineral'], ['BREN.JK', 'Barito Renewables'],
  ['TPIA.JK', 'Chandra Asri Pacific'], ['DSSA.JK', 'Dian Swastatika Sentosa'], ['ICBP.JK', 'Indofood CBP'], ['UNTR.JK', 'United Tractors'],
  ['AMRT.JK', 'Sumber Alfaria (Alfamart)'], ['ADRO.JK', 'AlamTri Resources'], ['ANTM.JK', 'Aneka Tambang'], ['INDF.JK', 'Indofood Sukses Makmur'],
  ['KLBF.JK', 'Kalbe Farma'], ['CPIN.JK', 'Charoen Pokphand Indonesia'], ['UNVR.JK', 'Unilever Indonesia'], ['PGAS.JK', 'Perusahaan Gas Negara'],
  ['MDKA.JK', 'Merdeka Copper Gold'], ['GOTO.JK', 'GoTo Gojek Tokopedia'],
];
for (const [s, n] of ID_STOCKS) NAMES[s] = n;
export const ID_MARKET = ['^JKSE', '^JKLQ45', '^JKII', 'IDR=X', 'EIDO'];

export const shortSym = (s) => SHORT[s] || s.replace(/\.JK$/, '');
export const nameOf = (s, fallback) => NAMES[s] || fallback || s;

export const US_INDICES = ['^GSPC', '^DJI', '^IXIC', '^NDX', '^RUT', '^VIX'];
export const FUTURES = ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'BZ=F', 'NG=F', 'GC=F', 'SI=F', 'HG=F'];
export const WORLD = ['^FTSE', '^GDAXI', '^FCHI', '^STOXX50E', '^N225', '^HSI', '000001.SS', '^KS11', '^GSPTSE', '^AXJO'];
export const FX = ['DX-Y.NYB', 'EURUSD=X', 'JPY=X', 'GBPUSD=X', 'CNY=X', 'CAD=X', 'AUDUSD=X', 'CHF=X'];
export const TAPE = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX', '^JKSE', 'IDR=X', 'ES=F', 'NQ=F', 'CL=F', 'GC=F', 'EURUSD=X', 'JPY=X', 'BTC-USD', 'ETH-USD'];

export const SECTORS = [
  ['XLK', 'Technology'], ['XLF', 'Financials'], ['XLV', 'Health Care'], ['XLY', 'Cons. Discretionary'], ['XLC', 'Communication'], ['XLI', 'Industrials'],
  ['XLP', 'Cons. Staples'], ['XLE', 'Energy'], ['XLU', 'Utilities'], ['XLRE', 'Real Estate'], ['XLB', 'Materials'], ['SPY', 'S&P 500 (SPY)'],
];

export const isIndexLike = (s) => /^\^|=F$|=X$|^DX-Y/.test(s);
