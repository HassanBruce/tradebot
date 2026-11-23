# Trade bot (paper trading)

AI ki madad se crypto **paper trading**: nakli paise, asli Binance prices. Koi exchange account, API key ya asli order nahi.
Maqsad ye dekhna hai ke AI ke faisle waqai munafa dete hain ya nahi, asli paisa lagane se **pehle**.

## Do modes

- `MODE=crypto`: spot, sirf khareed (long), top 25 coins, leverage nahi.
- `MODE=gold` (server par yahi chal raha hai): sone ki qeemat (PAXG), long ya short, **20x leverage**, Rs 2000 ka account,
  har trade stop-loss par account ka zyada se zyada ~20% khatre mein, 1-ghante ki candles, hafte ke aakhir (Sat/Sun) nayi trade nahi.
  Leverage ka matlab: sona 1% hile to account ~20% hilta hai, dono taraf.

## Kaise kaam karta hai (crypto mode)

1. **Har ghante** bot khuli trade ka stop-loss aur target check karta hai (15-minute candles, dono ek candle mein lagein to nuqsaan wala maana jata hai).
2. **Har 4 ghante** (agar koi trade khuli nahi) wo Binance ke 25 sab se zyada trade hone wale coins dekhta hai, 4-ghante ki candles par:
   - sirf woh coins jo uptrend mein hain (price EMA50 ke upar, EMA20 > EMA50), RSI 45-70, aur bohot zyada bhaage hue nahi;
   - agar Bitcoin kamzor hai (EMA50 ke neeche aur RSI < 40) to koi nayi trade nahi.
3. Is chhoti list mein se **Gemini** zyada se zyada ek coin chunta hai, ya kuch nahi.
4. **Code ke pakke rules** (AI inhein tod nahi sakta):
   - ek waqt mein 1 trade (Rs 1500 mein Binance ka $5 minimum order ek hi trade ki jagah deta hai);
   - stop-loss 4% se door ho to trade nahi;
   - din mein 3 trades, ya 3% nuqsaan ke baad us din band;
   - 5 din mein target/stop na lage to trade band;
   - har khareed/farokht par 0.1% fee aur 0.05% slippage.
5. Har trade par email, aur roz subah hisaab: kitna bana, aur agar sirf Bitcoin rakh lete to kitna hota.

## Server par

```bash
cp .env.example .env          # Gemini key + Gmail App Password bharein
docker compose build
docker compose run --rm tradebot run          # ek dafa chalayen
docker compose run --rm tradebot status
docker compose run --rm tradebot test-email
```

Cron (`/etc/cron.d/tradebot`):

```
5 * * * *  deploy cd /var/www/tradebot/src && docker compose run --rm tradebot run >> data/cron.log 2>&1
0 8 * * *  deploy cd /var/www/tradebot/src && docker compose run --rm tradebot report >> data/cron.log 2>&1
```

Data `data/paper.db` (SQLite) mein rehta hai. Nayi shuruaat ke liye ye file delete kar dein.

> Ye financial advice nahi. Crypto bohot tezi se upar neeche hota hai. Asli paisa sirf itna lagayein jo doob jaye to farq na pare.
