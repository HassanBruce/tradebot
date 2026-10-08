import crypto from 'node:crypto';
import { config } from './config.js';

async function request(method, path, params = {}, signed = false) {
  const qs = new URLSearchParams(params);
  if (signed) {
    qs.set('timestamp', String(Date.now()));
    qs.set('recvWindow', '10000');
    qs.set('signature', crypto.createHmac('sha256', config.apiSecret).update(qs.toString()).digest('hex'));
  }
  const url = `${config.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: signed ? { 'X-MBX-APIKEY': config.apiKey } : {},
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Binance ${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

/** Closed candles only (the last, still-forming candle is dropped). */
export async function klines(symbol, interval, limit = 300) {
  const rows = await request('GET', '/api/v3/klines', { symbol, interval, limit });
  const now = Date.now();
  return rows
    .map(r => ({ openTime: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], closeTime: r[6] }))
    .filter(c => c.closeTime < now);
}

export async function price(symbol) {
  return Number((await request('GET', '/api/v3/ticker/price', { symbol })).price);
}

export async function symbolRules(symbol) {
  const info = await request('GET', '/api/v3/exchangeInfo', { symbol });
  const s = info.symbols[0];
  const f = Object.fromEntries(s.filters.map(x => [x.filterType, x]));
  return {
    base: s.baseAsset,
    quote: s.quoteAsset,
    stepSize: Number(f.LOT_SIZE?.stepSize ?? '0.00000001'),
    minQty: Number(f.LOT_SIZE?.minQty ?? 0),
    minNotional: Number(f.NOTIONAL?.minNotional ?? f.MIN_NOTIONAL?.minNotional ?? 5),
  };
}

export async function balances() {
  const acc = await request('GET', '/api/v3/account', { omitZeroBalances: 'true' }, true);
  return Object.fromEntries(acc.balances.map(b => [b.asset, Number(b.free)]));
}

export async function marketBuy(symbol, quoteAmount) {
  return request('POST', '/api/v3/order', {
    symbol, side: 'BUY', type: 'MARKET',
    quoteOrderQty: quoteAmount.toFixed(2),
    newOrderRespType: 'FULL',
  }, true);
}

export async function marketSell(symbol, quantity) {
  return request('POST', '/api/v3/order', {
    symbol, side: 'SELL', type: 'MARKET',
    quantity: String(quantity),
    newOrderRespType: 'FULL',
  }, true);
}

/** Round DOWN to the exchange's lot step (selling more than you have fails). */
export function floorToStep(qty, step) {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  const floored = Math.floor(qty / step + 1e-9) * step;
  return Number(floored.toFixed(decimals));
}

/** Summarises a FULL order response: avg price, qty, quote spent, fees converted to quote. */
export function fillSummary(order, baseAsset, quoteAsset, feeRate = 0.001) {
  const qty = Number(order.executedQty);
  const quote = Number(order.cummulativeQuoteQty);
  const avg = qty ? quote / qty : 0;
  let feeBase = 0, feeQuote = 0, paidInOther = false;
  for (const f of order.fills ?? []) {
    if (f.commissionAsset === baseAsset) feeBase += Number(f.commission);
    else if (f.commissionAsset === quoteAsset) feeQuote += Number(f.commission);
    else if (Number(f.commission) > 0) paidInOther = true; // e.g. BNB
  }
  // Fees paid in BNB: estimate in quote terms (BNB gives ~25% discount).
  if (paidInOther) feeQuote += quote * feeRate * 0.75;
  return { qty, quote, avg, feeBase, feeQuote, feeTotalQuote: feeQuote + feeBase * avg };
}
