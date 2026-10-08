import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = ':memory:';
process.env.BINANCE_API_KEY = 'k';
process.env.BINANCE_API_SECRET = 's';
process.env.ADMIN_PASSWORD = 'pw';
process.env.BUDGET_USDT = '25';

const { ema, rsi } = await import('../src/indicators.js');
const { evaluate, checkExits } = await import('../src/strategy.js');
const { floorToStep, fillSummary } = await import('../src/binance.js');
const { simulate } = await import('../src/backtest-core.js');
const { config, assertSafeToTrade } = await import('../src/config.js');
const engine = await import('../src/engine.js');
const db = await import('../src/db.js');
const { render } = await import('../src/server.js');

// ---- synthetic market: seeded random walk with upward drift (deterministic) ----
function series(seed, n = 600) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const closes = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + (rand() - 0.48) * 0.02;   // ~1% moves, slight upward drift
    closes.push(p);
  }
  const t0 = Date.now() - n * 3600_000 - 3600_000;
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return {
      openTime: t0 + i * 3600_000, closeTime: t0 + (i + 1) * 3600_000 - 1,
      open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c,
    };
  });
}
const findBuy = S => {
  for (let i = 210; i < S.length; i++) {
    if (evaluate(S.slice(0, i + 1), null, config.strategy).action === 'buy') return i;
  }
  return -1;
};
let S, firstBuy = -1;
for (let seed = 1; seed < 200 && firstBuy < 0; seed++) { S = series(seed); firstBuy = findBuy(S); }

test('indicators behave', () => {
  const e = ema([1, 2, 3, 4, 5, 6], 3);
  assert.equal(e[1], null);
  assert.equal(e[2], 2);
  const up = rsi(Array.from({ length: 30 }, (_, i) => i), 14);
  assert.equal(up.at(-1), 100);
});

test('strategy finds the recovery entry, with a reason', () => {
  assert.ok(firstBuy > 0, 'expected the strategy to find a buy');
  const d = evaluate(S.slice(0, firstBuy + 1), null, config.strategy);
  assert.equal(d.action, 'buy');
  assert.ok(d.stop < d.ind.close && d.target > d.ind.close);
  assert.match(d.reason, /BUY/);
  const h = evaluate(S.slice(0, firstBuy), null, config.strategy);
  assert.equal(h.action, 'hold');
  assert.ok(h.reason.length > 10);
});

test('stop and target checks', () => {
  const pos = { stop: 90, target: 120 };
  assert.match(checkExits(pos, 89).reason, /STOP/);
  assert.match(checkExits(pos, 121).reason, /TAKE-PROFIT/);
  assert.equal(checkExits(pos, 100), null);
});

test('lot-size rounding never rounds up', () => {
  assert.equal(floorToStep(0.000239999, 0.00001), 0.00023);
  assert.equal(floorToStep(1.23456, 0.01), 1.23);
  assert.equal(floorToStep(5, 1), 5);
});

test('fee in coin reduces holdings; BNB fee estimated', () => {
  const s = fillSummary({ executedQty: '0.001', cummulativeQuoteQty: '25', fills: [{ commission: '0.000001', commissionAsset: 'BTC' }] }, 'BTC', 'USDT');
  assert.equal(s.feeBase, 0.000001);
  assert.ok(Math.abs(s.feeTotalQuote - 0.025) < 1e-9);
  const b = fillSummary({ executedQty: '1', cummulativeQuoteQty: '25', fills: [{ commission: '0.00004', commissionAsset: 'BNB' }] }, 'BTC', 'USDT');
  assert.ok(Math.abs(b.feeTotalQuote - 25 * 0.001 * 0.75) < 1e-9);
});

test('live mode refuses without explicit confirmation', () => {
  const prev = { mode: config.mode, c: config.liveConfirmed, url: config.baseUrl };
  config.mode = 'live'; config.liveConfirmed = false; config.baseUrl = 'https://api.binance.com';
  assert.throws(assertSafeToTrade, /LIVE_TRADING_CONFIRM/);
  config.mode = 'testnet';
  assert.throws(assertSafeToTrade, /real exchange/);
  Object.assign(config, { mode: prev.mode, liveConfirmed: prev.c, baseUrl: prev.url });
  assert.doesNotThrow(assertSafeToTrade);
});

// ---- mock exchange for the engine ----
const ex = { candles: [], price: 0, usdt: 100, btc: 0, orders: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  assert.equal(u.origin, 'https://testnet.binance.vision', 'must only talk to testnet');
  const json = b => new Response(JSON.stringify(b), { status: 200 });
  switch (u.pathname) {
    case '/api/v3/exchangeInfo':
      return json({ symbols: [{ baseAsset: 'BTC', quoteAsset: 'USDT', filters: [
        { filterType: 'LOT_SIZE', stepSize: '0.00001000', minQty: '0.00001000' },
        { filterType: 'NOTIONAL', minNotional: '5.00000000' }] }] });
    case '/api/v3/ticker/price': return json({ price: String(ex.price) });
    case '/api/v3/klines':
      return json(ex.candles.map(c => [c.openTime, c.open, c.high, c.low, c.close, 1, c.closeTime]));
    case '/api/v3/account':
      assert.ok(u.searchParams.get('signature'), 'account call must be signed');
      return json({ balances: [{ asset: 'USDT', free: String(ex.usdt) }, { asset: 'BTC', free: String(ex.btc) }] });
    case '/api/v3/order': {
      assert.equal(opts.method, 'POST');
      const side = u.searchParams.get('side');
      ex.orders.push(Object.fromEntries(u.searchParams));
      if (side === 'BUY') {
        const quote = Number(u.searchParams.get('quoteOrderQty'));
        const qty = quote / ex.price;
        const fee = qty * 0.001;
        ex.usdt -= quote; ex.btc += qty - fee;
        return json({ executedQty: String(qty), cummulativeQuoteQty: String(quote), fills: [{ commission: String(fee), commissionAsset: 'BTC' }] });
      }
      const qty = Number(u.searchParams.get('quantity'));
      assert.ok(qty <= ex.btc + 1e-12, 'never sell more than held');
      const quote = qty * ex.price;
      const fee = quote * 0.001;
      ex.btc -= qty; ex.usdt += quote - fee;
      return json({ executedQty: String(qty), cummulativeQuoteQty: String(quote), fills: [{ commission: String(fee), commissionAsset: 'USDT' }] });
    }
  }
  throw new Error('unexpected ' + u.pathname);
};

beforeEach(() => engine._reset());

test('engine: buys on signal (within budget), then stop-loss sells with fees counted', async () => {
  ex.candles = S.slice(0, firstBuy + 1);
  ex.price = ex.candles.at(-1).close;
  await engine.tick();
  const pos = db.openTrade();
  assert.ok(pos, 'should have opened a position');
  assert.equal(ex.orders[0].side, 'BUY');
  assert.ok(Number(ex.orders[0].quoteOrderQty) <= 25, 'must respect BUDGET_USDT even with 100 USDT available');

  // same candle again → no duplicate buy
  await engine.tick();
  assert.equal(ex.orders.length, 1);

  // price crashes through the stop
  ex.price = pos.stop * 0.99;
  await engine.tick();
  assert.equal(db.openTrade(), null);
  assert.equal(ex.orders[1].side, 'SELL');
  const t = db.trades(1)[0];
  assert.ok(t.pnl < 0);
  assert.match(t.exit_reason, /STOP-LOSS/);
  // P&L includes both fees
  const expected = t.exit_quote - t.exit_fee - t.entry_quote - t.entry_fee;
  assert.ok(Math.abs(t.pnl - expected) < 1e-9);
});

test('engine: pause blocks new entries; daily loss limit blocks too', async () => {
  const before = ex.orders.length;
  engine.setPaused(true);
  ex.candles = S.slice(0, firstBuy + 2);   // new candle
  db.kvSet('last_candle', '0');
  ex.candles = S.slice(0, firstBuy + 1);
  await engine.tick();
  assert.equal(ex.orders.length, before);
  engine.setPaused(false);

  config.maxDailyLossUsdt = 0.0000001;      // earlier stop-loss already lost more than this
  db.kvSet('last_candle', '0');
  await engine.tick();
  assert.equal(ex.orders.length, before);
  assert.match(db.recentLog(1)[0].message, /limit/);
  config.maxDailyLossUsdt = 3;
});

test('dashboard renders with trades and diary', () => {
  const html = render();
  assert.match(html, /TESTNET/);
  assert.match(html, /STOP-LOSS/);
  assert.match(html, /<polyline|Chart 2\+/);
});

test('backtest replays strategy with fees and monthly breakdown', () => {
  const r = simulate(S, { strategy: config.strategy, feeRate: 0.001, budget: 25 });
  assert.ok(r.count >= 0);
  assert.ok(Number.isFinite(r.finalEquity) && r.finalEquity > 0);
  assert.ok(r.maxDrawdownPct >= 0);
  assert.equal(typeof r.monthly, 'object');
});
