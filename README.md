# tradebot — Binance spot bot (testnet pehle)

Chhota, imaandar trading bot. Testnet (fake paisa) pe default chalta hai. Har faisle ki wajah Roman Urdu mein "Bot ki diary" mein likhta hai, taake tum saath saath trading bhi seekho.

## Strategy (seedhi zabaan mein)
- **1 ghante ki candles**, sirf **BTC/USDT**, sirf **khareed ke bechna** (no leverage, no shorting, no futures).
- **Kab khareedta hai:** jab chhota trend (EMA 20) bade trend (EMA 50) ko upar se cross kare, price lambe trend (EMA 200) se upar ho, aur market "bohot garam" na ho (RSI < 70).
- **Kab bechta hai:**
  - **Stop-loss:** price 2× ATR neeche gir jaye (nuksan chhota rakho)
  - **Take-profit:** price 3× ATR upar chala jaye (munafa pakka karo)
  - Ya trend ulta ho jaye (EMA 20 neeche cross kare)
- **Jaan boojh ke kam trades:** har buy+sell pe ~0.2% fee lagti hai, zyada trades = zyada fees.

> Is strategy mein koi jaadu nahi. Ye "trend ke saath chalo, nuksan chhota rakho" wala classic tareeqa hai. Kai din aur kabhi hafta bhar koi trade nahi hogi, ye normal hai.

## Safety
- `MODE=testnet` default hai. Live ke liye **do switch** chahiye: `MODE=live` aur `LIVE_TRADING_CONFIRM=yes`.
- `BUDGET_USDT`: account mein jitna bhi paisa ho, bot isse zyada use nahi karega.
- `MAX_DAILY_LOSS_USDT`: din ka itna nuksan hua to us din aur trade nahi.
- Dashboard pe **Pause** aur **Close position now** buttons hain.
- Live API key banate waqt: sirf **Spot Trading** enable karo. **Withdrawals kabhi enable mat karna.** Key ko apne VPS ki IP pe restrict karo.

## 1. Backtest (sab se pehle, 2 minute, koi key nahi chahiye)
Pichle 1 saal ke asli prices pe yehi strategy chala ke dekho, fees samait:
```bash
npm install
npm run backtest -- --days 365 --budget 25
```
Isme trades, win rate, mahina-ba-mahina profit/loss aur "buy & hold" se muqabla dikhega. Yaad rahe: purane data pe acha nateeja future ki guarantee nahi.

## 2. Testnet key
1. **testnet.binance.vision** → "Log In with GitHub"
2. **Generate HMAC_SHA256 Key** → key aur secret copy karo (secret sirf ek dafa dikhta hai)
3. Testnet account mein fake USDT pehle se hota hai.

## 3. VPS pe chalana
```bash
cd tradebot
cp .env.example .env && nano .env      # keys + ADMIN_PASSWORD
docker compose run --rm bot node --no-warnings scripts/check.js   # connection check, koi order nahi
docker compose up -d
docker compose logs -f                 # live log (Ctrl+C se bahar, bot chalta rahega)
```

## 4. Dashboard dekhna
Dashboard sirf VPS ke andar khula hai (security ke liye). Do tareeqe:

**Laptop se (SSH tunnel):**
```bash
ssh -L 3100:localhost:3100 root@YOUR_VPS_IP
```
Phir browser mein `http://localhost:3100` kholo (user kuch bhi, password = ADMIN_PASSWORD).

**Phone se (WhatsApp bot wale Caddy ke zariye, HTTPS):**
1. DNS mein `trade.yourdomain.com` → VPS IP
2. `wabot/docker-compose.yml` mein `caddy` service ke neeche add karo:
   ```yaml
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```
   aur tradebot ki `docker-compose.yml` mein port ko `"172.17.0.1:3100:3100"` kar do.
3. `wabot/Caddyfile` mein add karo:
   ```
   trade.yourdomain.com {
   	reverse_proxy host.docker.internal:3100
   }
   ```
4. `cd wabot && docker compose up -d`

## 5. 2 hafte baad
Dashboard pe dekho: total P&L, win rate, fees. Phir faisla tumhara.

Live jana ho to:
1. Binance pe real Spot API key banao (Spot Trading only, withdrawals OFF, IP restricted)
2. `.env`: `MODE=live`, `LIVE_TRADING_CONFIRM=yes`, nayi key, `BUDGET_USDT=25`
3. `data/` folder ka naam badal do (testnet history alag rahe), phir `docker compose up -d --build`

## Files
```
src/strategy.js       entry/exit rules + har faisle ki wajah
src/indicators.js     EMA, RSI, ATR
src/engine.js         har minute: stop/target check, naye candle pe strategy, orders
src/binance.js        signed Binance REST client, lot-size rounding, fees
src/db.js             SQLite: trades, diary
src/server.js         dashboard
src/backtest-core.js  wohi strategy purane data pe
scripts/backtest.js   npm run backtest
scripts/check.js      keys/balance check (no orders)
```
