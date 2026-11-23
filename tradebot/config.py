"""Settings from environment variables (see .env.example)."""
import os
from pathlib import Path


def _env(name, default=""):
    return os.environ.get(name, default).strip()


def _num(name, default):
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return float(default)


DATA_DIR = Path(_env("DATA_DIR", "data"))
TIMEZONE = _env("TIMEZONE", "Asia/Karachi")

# What to trade: "crypto" (spot, long only, top coins) or "gold" (PAXG price, futures-style: long or short, leverage)
MODE = _env("MODE", "crypto")
GOLD_SYMBOL = _env("GOLD_SYMBOL", "PAXGUSDT")      # PAXG tracks the price of one troy ounce of gold
LEVERAGE = _num("LEVERAGE", 1)                     # 20 = a 1% move changes the position by 20%
RISK_PCT = _num("RISK_PCT", 100)                   # max loss per trade as % of the account (at the stop-loss)
MARGIN_PKR = _num("MARGIN_PKR", 0)                 # fixed margin per trade in rupees (0 = split the cash over MAX_OPEN)
TRADE_WEEKENDS = _env("TRADE_WEEKENDS", "1") == "1"  # gold futures (PMEX) are closed on weekends

# Paper account
START_PKR = _num("START_PKR", 1500)          # starting balance in rupees
FEE_PCT = _num("FEE_PCT", 0.1)               # Binance spot fee per side
SLIPPAGE_PCT = _num("SLIPPAGE_PCT", 0.05)    # price we lose when buying/selling at market
MIN_ORDER_USDT = _num("MIN_ORDER_USDT", 5)   # Binance minimum order size

# Risk rules the AI can never override
MAX_OPEN = int(_num("MAX_OPEN", 1))                 # positions at the same time
MAX_STOP_PCT = _num("MAX_STOP_PCT", 4)              # skip trades whose stop is further than this
MAX_TRADES_PER_DAY = int(_num("MAX_TRADES_PER_DAY", 3))
DAILY_LOSS_STOP_PCT = _num("DAILY_LOSS_STOP_PCT", 3)  # no new trades today after losing this much
MAX_HOLD_HOURS = _num("MAX_HOLD_HOURS", 120)        # close a trade that goes nowhere after 5 days
MIN_CONFIDENCE = _num("MIN_CONFIDENCE", 60)

# Market scan
UNIVERSE = int(_num("UNIVERSE", 25))         # most traded USDT pairs to look at
INTERVAL = _env("INTERVAL", "4h")            # candles used for decisions
AI_EVERY_HOURS = _num("AI_EVERY_HOURS", 4)   # Gemini is asked at most this often (free tier is small)

# AI and email
GEMINI_API_KEY = _env("GEMINI_API_KEY")
GEMINI_MODELS = [m.strip() for m in _env("GEMINI_MODELS", "gemini-3.5-flash,gemini-3.5-flash-lite").split(",") if m.strip()]
SMTP_HOST = _env("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(_num("SMTP_PORT", 587))
SMTP_USER = _env("SMTP_USER")
SMTP_PASSWORD = _env("SMTP_PASSWORD")
REPORT_TO = [e.strip() for e in _env("REPORT_TO").split(",") if e.strip()]
TRADE_ALERTS = _env("TRADE_ALERTS", "1") == "1"
