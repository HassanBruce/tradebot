import { evaluate } from './strategy.js';

/**
 * Replays the exact live strategy over historical candles, with fees.
 * Conservative: if a candle touches both stop and target, assume the stop hit first.
 */
export function simulate(candles, { strategy, feeRate = 0.001, budget = 25, window = 500 }) {
  let cash = budget;
  let pos = null;
  const trades = [];
  let peak = budget, maxDD = 0;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (pos) {
      let exitPrice = null, why = null;
      if (c.low <= pos.stop) { exitPrice = Math.min(pos.stop, c.open); why = 'stop'; }
      else if (c.high >= pos.target) { exitPrice = Math.max(pos.target, c.open); why = 'target'; }
      if (exitPrice == null) {
        const d = evaluate(candles.slice(Math.max(0, i - window + 1), i + 1), pos, strategy);
        if (d.action === 'sell') { exitPrice = c.close; why = 'trend'; }
      }
      if (exitPrice != null) {
        const gross = pos.qty * exitPrice;
        const fee = gross * feeRate;
        cash = gross - fee;
        trades.push({ ...pos, exitTime: c.closeTime, exitPrice, why, pnl: cash - pos.spent });
        pos = null;
      }
    } else {
      const d = evaluate(candles.slice(Math.max(0, i - window + 1), i + 1), null, strategy);
      if (d.action === 'buy') {
        const fee = cash * feeRate;
        pos = { entryTime: c.closeTime, entryPrice: c.close, qty: (cash - fee) / c.close, stop: d.stop, target: d.target, spent: cash };
        cash = 0;
      }
    }
    const equity = pos ? pos.qty * c.close : cash;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
  }

  const last = candles.at(-1);
  const finalEquity = pos ? pos.qty * last.close * (1 - feeRate) : cash;
  const wins = trades.filter(t => t.pnl > 0).length;

  // Month-by-month P&L (by exit month)
  const monthly = {};
  for (const t of trades) {
    const m = new Date(t.exitTime).toISOString().slice(0, 7);
    monthly[m] = (monthly[m] ?? 0) + t.pnl;
  }

  return {
    trades,
    count: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity,
    pnl: finalEquity - budget,
    returnPct: (finalEquity / budget - 1) * 100,
    maxDrawdownPct: maxDD * 100,
    buyHoldPct: (last.close / candles[0].close - 1) * 100,
    monthly,
    openPosition: pos,
  };
}
