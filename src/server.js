import express from 'express';
import { pathToFileURL } from 'node:url';
import { config, assertSafeToTrade } from './config.js';
import * as db from './db.js';
import { startLoop, isPaused, setPaused, closeNow } from './engine.js';
import { fmt } from './strategy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function equitySvg(closedAsc) {
  if (closedAsc.length < 2) return '<div class="empty">Chart 2+ band trades ke baad dikhega.</div>';
  let cum = 0;
  const pts = [0, ...closedAsc.map(t => (cum += t.pnl))];
  const min = Math.min(0, ...pts), max = Math.max(0, ...pts), span = max - min || 1;
  const W = 600, H = 160, x = i => (i / (pts.length - 1)) * W, y = v => H - ((v - min) / span) * H;
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 -8 ${W} ${H + 16}" preserveAspectRatio="none" class="chart" role="img" aria-label="Cumulative profit">
<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
<polyline points="${line}" class="${cum >= 0 ? 'up' : 'down'}"/></svg>`;
}

export function render() {
  const s = db.summary();
  const open = db.openTrade();
  const all = db.trades(200);
  const closedAsc = all.filter(t => t.closed_at).reverse();
  const decision = JSON.parse(db.kvGet('last_decision', 'null') ?? 'null');
  const price = Number(db.kvGet('last_price', 0));
  const unreal = open ? open.qty * price - open.entry_quote - open.entry_fee : 0;
  const live = config.mode === 'live';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Trade Bot</title>
<style>
:root{--bg:#f5f5f1;--card:#fff;--ink:#1a1d1b;--mute:#6b736e;--line:#e2e5df;--up:#127a52;--down:#b3261e;--warn:#a35a00}
@media (prefers-color-scheme:dark){:root{--bg:#111312;--card:#1a1d1b;--ink:#e8ebe8;--mute:#98a29c;--line:#2a2f2c;--up:#45c08a;--down:#ef6b61;--warn:#e7a14f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:900px;margin:0 auto;padding:16px}h1{font-size:19px;margin:0}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:22px 0 8px}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;border:1px solid currentColor}.live{color:var(--down)}.test{color:var(--up)}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}@media(min-width:640px){.grid{grid-template-columns:repeat(4,1fr)}}
.stat,.card{background:var(--card);border:1px solid var(--line);border-radius:12px}.stat{padding:12px}.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.stat span{font-size:13px;color:var(--mute)}
.card{padding:14px}.pos{color:var(--up)}.neg{color:var(--down)}.mute{color:var(--mute);font-size:13px}
.think{border-left:3px solid var(--up);padding:10px 14px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-top:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:500;border-top:0}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.scroll{overflow-x:auto}
.chart{width:100%;height:160px}.chart polyline{fill:none;stroke-width:2.5;vector-effect:non-scaling-stroke}.chart .up{stroke:var(--up)}.chart .down{stroke:var(--down)}
.chart .zero{stroke:var(--line);stroke-dasharray:4 4;vector-effect:non-scaling-stroke}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.log li{margin:0 0 8px;list-style:none}.log{padding:0;margin:0}
.lvl-trade{font-weight:600}.lvl-error{color:var(--down)}.lvl-warn{color:var(--warn)}.empty{color:var(--mute);padding:10px 0}
</style></head><body><main>
<div class="top"><h1>${esc(config.symbol)} bot <span class="mute">· ${esc(config.interval)} candles</span></h1>
<span class="badge ${live ? 'live' : 'test'}">${live ? 'LIVE — REAL MONEY' : 'TESTNET — fake money'}</span></div>

<div class="grid">
<div class="stat"><b class="${s.pnl >= 0 ? 'pos' : 'neg'}">${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}</b><span>Total P&amp;L (USDT)</span></div>
<div class="stat"><b>${s.closed}</b><span>Trades (${s.wins}W / ${s.losses}L)</span></div>
<div class="stat"><b>${s.closed ? (s.winRate * 100).toFixed(0) + '%' : '-'}</b><span>Win rate</span></div>
<div class="stat"><b>${s.fees.toFixed(2)}</b><span>Fees paid (USDT)</span></div>
</div>

<h2>Bot abhi kya soch raha hai</h2>
<div class="card think">${decision ? esc(decision.reason) : 'Pehli candle ka intezar…'}
<div class="mute">Price ${fmt(price)} · last check ${esc(db.kvGet('last_tick', '-'))} UTC${isPaused() ? ' · <b>PAUSED</b>' : ''}</div>
<form method="post" class="actions">
<button formaction="/pause">${isPaused() ? '▶️ Resume' : '⏸ Pause new trades'}</button>
${open ? '<button formaction="/close" onclick="return confirm(\'Position abhi bech dein?\')">Close position now</button>' : ''}
</form></div>

<h2>Open position</h2>
<div class="card">${open ? `
<b>${fmt(open.qty)}</b> @ ${fmt(open.entry_price)} · now ${fmt(price)}
<span class="${unreal >= 0 ? 'pos' : 'neg'}">(${unreal >= 0 ? '+' : ''}${unreal.toFixed(3)} USDT)</span>
<div class="mute">Stop ${fmt(open.stop)} · Target ${fmt(open.target)} · since ${esc(open.opened_at)} UTC</div>`
    : '<div class="empty">Koi position nahi. Bot sahi signal ka intezar kar raha hai.</div>'}</div>

<h2>Profit curve</h2><div class="card">${equitySvg(closedAsc)}</div>

<h2>Trades</h2>
<div class="card scroll"><table><tr><th>#</th><th>Opened</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P&amp;L</th><th>Why closed</th></tr>
${all.map(t => `<tr><td>${t.id}</td><td>${esc(t.opened_at)}</td><td class="num">${fmt(t.entry_price)}</td><td class="num">${t.exit_price ? fmt(t.exit_price) : '<span class="mute">open</span>'}</td>
<td class="num ${t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : ''}">${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(3) : '-'}</td><td class="mute">${esc(t.exit_reason ?? '')}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">Abhi koi trade nahi.</td></tr>'}
</table></div>

<h2>Bot ki diary</h2>
<div class="card"><ul class="log">${db.recentLog(60).map(l => `<li class="lvl-${esc(l.level)}"><span class="mute">${esc(l.created_at)}</span> ${esc(l.message)}</li>`).join('')}</ul></div>
</main></body></html>`;
}

export function createApp() {
  const app = express();
  app.use((req, res, next) => {
    if (!config.adminPassword) return res.status(503).send('Set ADMIN_PASSWORD in .env');
    const [, b64] = (req.get('authorization') ?? '').split(' ');
    const pass = Buffer.from(b64 ?? '', 'base64').toString().split(':').slice(1).join(':');
    if (pass === config.adminPassword) return next();
    res.set('WWW-Authenticate', 'Basic realm="tradebot"').sendStatus(401);
  });
  app.get('/', (_req, res) => res.send(render()));
  app.post('/pause', (_req, res) => { setPaused(!isPaused()); res.redirect('/'); });
  app.post('/close', async (_req, res) => {
    try { await closeNow(); } catch (e) { db.log('error', `Manual close failed: ${e.message}`); }
    res.redirect('/');
  });
  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertSafeToTrade();
  db.getDb();
  createApp().listen(config.port, () => console.log(`Dashboard on :${config.port}`));
  startLoop();
}
