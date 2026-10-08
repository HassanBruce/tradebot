import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => Number(env(k, d));

const mode = env('MODE', 'testnet');
const BASES = { testnet: 'https://testnet.binance.vision', live: 'https://api.binance.com' };

export const config = {
  mode,
  baseUrl: env('BINANCE_BASE_URL', BASES[mode] ?? BASES.testnet),
  apiKey: env('BINANCE_API_KEY', ''),
  apiSecret: env('BINANCE_API_SECRET', ''),
  // Live trading needs a second, explicit switch so it can't happen by accident.
  liveConfirmed: env('LIVE_TRADING_CONFIRM', '') === 'yes',

  symbol: env('SYMBOL', 'BTCUSDT'),
  interval: env('INTERVAL', '1h'),
  budgetUsdt: num('BUDGET_USDT', 25),          // max money the bot may use
  maxDailyLossUsdt: num('MAX_DAILY_LOSS_USDT', 3), // stop new trades for the day after this loss
  feeRate: num('FEE_RATE', 0.001),              // 0.1% per side (used for estimates/backtest)
  tickSeconds: num('TICK_SECONDS', 60),

  strategy: {
    emaFast: num('EMA_FAST', 20),
    emaSlow: num('EMA_SLOW', 50),
    emaTrend: num('EMA_TREND', 200),
    rsiPeriod: num('RSI_PERIOD', 14),
    rsiMax: num('RSI_MAX', 70),
    atrPeriod: num('ATR_PERIOD', 14),
    stopAtr: num('STOP_ATR', 2),
    targetAtr: num('TARGET_ATR', 3),
  },

  port: num('PORT', 3100),
  dataDir: env('DATA_DIR', './data'),
  adminPassword: env('ADMIN_PASSWORD', ''),
};

export function assertSafeToTrade() {
  if (config.mode === 'live' && !config.liveConfirmed) {
    throw new Error('MODE=live but LIVE_TRADING_CONFIRM is not "yes". Refusing to trade real money.');
  }
  if (config.mode === 'testnet' && /api\.binance\.com/.test(config.baseUrl)) {
    throw new Error('MODE=testnet but BINANCE_BASE_URL points to the real exchange.');
  }
  if (!config.apiKey || !config.apiSecret) throw new Error('BINANCE_API_KEY / BINANCE_API_SECRET missing in .env');
}
