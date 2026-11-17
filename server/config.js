// Runtime configuration. Everything can be overridden with environment variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 7777),
  // Bind to loopback by default: the server stores your personal positions.
  host: process.env.HOST || '127.0.0.1',
  publicDir: path.join(root, 'public'),
  userDataDir: process.env.FINTERM_DATA_DIR || path.join(root, 'data', 'user'),
  cacheDir: path.join(root, 'data', 'cache'),
  // SEC asks automated clients to identify themselves with a name and contact
  // address (https://www.sec.gov/os/accessing-edgar-data). Set your own.
  secUserAgent: process.env.SEC_USER_AGENT || 'FinTerm personal-terminal finterm-user@example.com',
  browserUserAgent:
    process.env.BROWSER_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Optional: FRED API key (free). Without it the public fredgraph CSV endpoint is used.
  fredApiKey: process.env.FRED_API_KEY || '',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
  logRequests: process.env.LOG_REQUESTS === '1',
};
