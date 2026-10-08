import { config } from './config.js';
import * as bx from './binance.js';
import * as db from './db.js';
import { evaluate, checkExits, fmt } from './strategy.js';

let rules = null;
let busy = false;

async function getRules() {
  rules ??= await bx.symbolRules(config.symbol);
  return rules;
}

export const isPaused = () => db.kvGet('paused', '0') === '1';
export const setPaused = p => { db.kvSet('paused', p ? '1' : '0'); db.log('info', p ? '⏸ Bot paused (new trades band).' : '▶️ Bot resumed.'); };

/** One heartbeat. Safe to call repeatedly; never throws. */
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    const r = await getRules();
    const position = db.openTrade();
    const price = await bx.price(config.symbol);
    db.kvSet('last_price', price);
    db.kvSet('last_tick', new Date().toISOString());

    // 1) Protect an open position every tick
    if (position) {
      const exit = checkExits(position, price);
      if (exit) return await sell(position, exit.reason, r);
    }

    // 2) Strategy only on a newly closed candle
    const candles = await bx.klines(config.symbol, config.interval, 300);
    const last = candles.at(-1);
    if (!last || String(last.closeTime) === db.kvGet('last_candle')) return;
    db.kvSet('last_candle', last.closeTime);

    const decision = evaluate(candles, position, config.strategy);
    db.kvSet('last_decision', JSON.stringify({ ...decision, at: new Date().toISOString() }));

    if (decision.action === 'sell' && position) return await sell(position, decision.reason, r);

    if (decision.action === 'buy' && !position) {
      if (isPaused()) return db.log('info', `Signal aaya lekin bot paused hai. (${decision.reason})`);
      const today = db.realizedToday();
      if (today <= -config.maxDailyLossUsdt) {
        return db.log('warn', `Aaj ka nuksan ${fmt(today)} USDT limit (${config.maxDailyLossUsdt}) tak pohanch gaya. Aaj aur trade nahi.`);
      }
      return await buy(decision, r);
    }

    db.log('info', decision.reason);
  } catch (e) {
    db.log('error', `Tick failed: ${e.message}`);
  } finally {
    busy = false;
  }
}

async function buy(decision, r) {
  const bal = await bx.balances();
  const free = bal[r.quote] ?? 0;
  const spend = Math.min(config.budgetUsdt, free) * 0.995; // small buffer for rounding
  if (spend < r.minNotional) {
    return db.log('warn', `BUY signal, lekin ${r.quote} balance ${fmt(free)} minimum order (${r.minNotional}) se kam hai.`);
  }
  const order = await bx.marketBuy(config.symbol, spend);
  const s = bx.fillSummary(order, r.base, r.quote, config.feeRate);
  const qty = s.qty - s.feeBase; // fee taken in coin reduces what we hold
  // Keep the same stop/target distance relative to the real fill price
  const stop = s.avg - (decision.ind.close - decision.stop);
  const target = s.avg + (decision.target - decision.ind.close);
  db.insertTrade({
    mode: config.mode, symbol: config.symbol, qty, entry_price: s.avg, entry_quote: s.quote,
    entry_fee: s.feeTotalQuote, stop, target, entry_reason: decision.reason,
  });
  db.log('trade', `🟢 BUY ${fmt(qty)} ${r.base} @ ${fmt(s.avg)} (${fmt(s.quote)} ${r.quote}). ${decision.reason}`);
}

async function sell(position, reason, r) {
  const bal = await bx.balances();
  const held = Math.min(position.qty, bal[r.base] ?? 0);
  const qty = bx.floorToStep(held, r.stepSize);
  const price = Number(db.kvGet('last_price', position.entry_price));
  if (qty < r.minQty || qty * price < r.minNotional) {
    db.closeTrade(position.id, { exit_price: price, exit_quote: 0, exit_fee: 0, exit_reason: `Position too small to sell (${qty}). ${reason}`, pnl: -position.entry_quote - position.entry_fee });
    return db.log('error', `SELL nahi ho saka: quantity ${qty} minimum se kam. Binance pe manually check karein.`);
  }
  const order = await bx.marketSell(config.symbol, qty);
  const s = bx.fillSummary(order, r.base, r.quote, config.feeRate);
  // P&L in quote: what we got back minus what we paid, minus all fees
  const pnl = s.quote - s.feeTotalQuote - position.entry_quote - position.entry_fee;
  db.closeTrade(position.id, { exit_price: s.avg, exit_quote: s.quote, exit_fee: s.feeTotalQuote, exit_reason: reason, pnl });
  db.log('trade', `${pnl >= 0 ? '✅' : '🔻'} SELL ${fmt(s.qty)} ${r.base} @ ${fmt(s.avg)} → P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} ${r.quote}. ${reason}`);
}

/** Manual "close now" from the dashboard. */
export async function closeNow() {
  const position = db.openTrade();
  if (!position) return db.log('info', 'Close now: koi open position nahi.');
  await sell(position, 'Manual close from dashboard.', await getRules());
}

export function startLoop() {
  db.log('info', `Bot started — mode ${config.mode.toUpperCase()}, ${config.symbol} ${config.interval}, budget ${config.budgetUsdt} USDT.`);
  tick();
  return setInterval(tick, config.tickSeconds * 1000);
}

// for tests
export function _reset() { rules = null; busy = false; }
