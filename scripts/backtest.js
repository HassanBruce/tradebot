// Replays the strategy over real past prices (no API key needed).
// Usage: npm run backtest -- --days 365 --symbol BTCUSDT --interval 1h --budget 25
import { config } from '../src/config.js';
import { simulate } from '../src/backtest-core.js';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const days = Number(arg('days', 365));
const symbol = arg('symbol', config.symbol);
const interval = arg('interval', config.interval);
const budget = Number(arg('budget', config.budgetUsdt));
const DATA = 'https://data-api.binance.vision'; // public real-market data

async function fetchHistory() {
  const out = [];
  let start = Date.now() - days * 86400_000;
  while (true) {
    const url = `${DATA}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = await res.json();
    if (!rows.length) break;
    for (const r of rows) out.push({ openTime: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], closeTime: r[6] });
    start = rows.at(-1)[6] + 1;
    if (rows.length < 1000) break;
  }
  return out.filter(c => c.closeTime < Date.now());
}

const candles = await fetchHistory();
console.log(`\n${symbol} ${interval} — ${candles.length} candles (~${days} days), budget ${budget} USDT, fee ${config.feeRate * 100}%/side\n`);
const r = simulate(candles, { strategy: config.strategy, feeRate: config.feeRate, budget });

const sign = n => (n >= 0 ? '+' : '') + n.toFixed(2);
console.log(`Trades:          ${r.count}  (wins ${r.wins}, win rate ${(r.winRate * 100).toFixed(0)}%)`);
console.log(`Final:           ${r.finalEquity.toFixed(2)} USDT  (${sign(r.pnl)} USDT, ${sign(r.returnPct)}%)`);
console.log(`Max drawdown:    ${r.maxDrawdownPct.toFixed(1)}%   (worst fall from a high)`);
console.log(`Buy & hold:      ${sign(r.buyHoldPct)}%   (just buying and waiting, for comparison)`);
console.log(`\nMonth by month (USDT):`);
for (const [m, v] of Object.entries(r.monthly)) console.log(`  ${m}  ${sign(v).padStart(8)}`);
if (r.openPosition) console.log(`\n(Still holding one position at the end.)`);
console.log(`\nYaad rahe: purane data pe acha nateeja future ki guarantee nahi.\n`);
