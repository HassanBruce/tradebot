// Quick connection check: keys, balances, symbol rules. Places NO orders.
import { config, assertSafeToTrade } from '../src/config.js';
import * as bx from '../src/binance.js';

try {
  assertSafeToTrade();
  console.log(`Mode: ${config.mode.toUpperCase()}  (${config.baseUrl})`);
  const r = await bx.symbolRules(config.symbol);
  console.log(`${config.symbol}: min order ${r.minNotional} ${r.quote}, step ${r.stepSize}`);
  console.log(`Price: ${await bx.price(config.symbol)}`);
  const bal = await bx.balances();
  console.log(`Balances: ${r.quote} ${bal[r.quote] ?? 0}, ${r.base} ${bal[r.base] ?? 0}`);
  console.log('\n✅ Sab theek hai. `docker compose up -d` se bot chala dein.');
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
