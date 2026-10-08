import { ema, rsi, atr } from './indicators.js';

/**
 * Trend-following, long-only (spot, no leverage, no shorting).
 *
 * ENTRY (on a closed candle): fast EMA crosses above slow EMA, price is above
 *   the long trend EMA, and RSI isn't overheated.
 * EXIT: stop-loss (entry − STOP_ATR × ATR), take-profit (entry + TARGET_ATR × ATR),
 *   or fast EMA crosses back below slow EMA.
 *
 * Few trades on purpose: every round trip costs ~0.2% in fees.
 * Every decision returns a plain-language reason so you can learn from the log.
 */
export function evaluate(candles, position, p) {
  const need = Math.max(p.emaTrend, p.emaSlow, p.atrPeriod, p.rsiPeriod) + 2;
  if (candles.length < need) {
    return { action: 'hold', reason: `Abhi data kam hai (${candles.length}/${need} candles).` };
  }
  const closes = candles.map(c => c.close);
  const fast = ema(closes, p.emaFast);
  const slow = ema(closes, p.emaSlow);
  const trend = ema(closes, p.emaTrend);
  const r = rsi(closes, p.rsiPeriod);
  const a = atr(candles, p.atrPeriod);
  const i = candles.length - 1;
  const close = closes[i];
  const ind = { close, fast: fast[i], slow: slow[i], trend: trend[i], rsi: r[i], atr: a[i] };

  const crossedUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
  const crossedDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];

  if (position) {
    if (crossedDown) {
      return { action: 'sell', reason: `Trend kamzor ho gaya: EMA${p.emaFast} ne EMA${p.emaSlow} ko neeche cross kiya. Position band.`, ind };
    }
    return { action: 'hold', reason: `Position khuli hai. Stop ${fmt(position.stop)}, target ${fmt(position.target)}, price ${fmt(close)}.`, ind };
  }

  if (!crossedUp) {
    const why = fast[i] > slow[i]
      ? 'Trend upar hai lekin entry ka signal (naya cross) pehle guzar chuka. Agle mauqe ka intezar.'
      : 'Short-term trend neeche hai (fast EMA < slow EMA). Intezar.';
    return { action: 'hold', reason: why, ind };
  }
  if (close <= trend[i]) {
    return { action: 'hold', reason: `Cross hua lekin price lambe trend (EMA${p.emaTrend}) se neeche hai. Risky, skip.`, ind };
  }
  if (r[i] >= p.rsiMax) {
    return { action: 'hold', reason: `Cross hua lekin RSI ${r[i].toFixed(0)} hai (bohot garam). Skip.`, ind };
  }
  const stop = close - p.stopAtr * a[i];
  const target = close + p.targetAtr * a[i];
  return {
    action: 'buy', stop, target, ind,
    reason: `BUY: EMA${p.emaFast} ne EMA${p.emaSlow} ko upar cross kiya, price EMA${p.emaTrend} se upar, RSI ${r[i].toFixed(0)}. Stop ${fmt(stop)}, target ${fmt(target)}.`,
  };
}

/** Checked every tick with the live price, between candle closes. */
export function checkExits(position, price) {
  if (price <= position.stop) return { action: 'sell', reason: `STOP-LOSS: price ${fmt(price)} stop ${fmt(position.stop)} tak gir gaya. Nuksan chhota rakhne ke liye bech diya.` };
  if (price >= position.target) return { action: 'sell', reason: `TAKE-PROFIT: price ${fmt(price)} target ${fmt(position.target)} tak pohanch gaya. Munafa pakka.` };
  return null;
}

export const fmt = n => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 6 : 2 }));
