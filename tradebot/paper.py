"""Paper account in SQLite: fake money, real prices, real fees. Nothing is ever sent to an exchange."""
import json
import sqlite3
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from . import config, market

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY, symbol TEXT, opened REAL, entry REAL, qty REAL, cost REAL,
  stop REAL, target REAL, confidence REAL, reason TEXT,
  closed REAL, exit REAL, proceeds REAL, pnl REAL, exit_reason TEXT);
CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, ts REAL, data TEXT);
"""


def db():
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(config.DATA_DIR / "paper.db", timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def get(con, key, default=None):
    r = con.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def put(con, key, value):
    con.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)))
    con.commit()


def init(con):
    """First run: convert the rupee budget to USDT and remember BTC's price as a benchmark."""
    if get(con, "cash") is not None:
        return False
    rate = market.usd_pkr()
    put(con, "cash", config.START_PKR / rate)
    put(con, "start", dict(ts=time.time(), pkr=config.START_PKR, usdt=config.START_PKR / rate, rate=rate,
                           btc=market.price("BTCUSDT")))
    return True


def open_trades(con):
    return con.execute("SELECT * FROM trades WHERE closed IS NULL").fetchall()


def equity(con, prices=None):
    total = get(con, "cash", 0.0)
    for t in open_trades(con):
        p = (prices or {}).get(t["symbol"]) or market.price(t["symbol"])
        total += t["qty"] * p * (1 - config.FEE_PCT / 100)
    return total


def today_start_ts():
    tz = ZoneInfo(config.TIMEZONE)
    return datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def today_stats(con):
    since = today_start_ts()
    opened = con.execute("SELECT COUNT(*) FROM trades WHERE opened >= ?", (since,)).fetchone()[0]
    pnl = con.execute("SELECT COALESCE(SUM(pnl),0) FROM trades WHERE closed >= ?", (since,)).fetchone()[0]
    return opened, pnl


def can_open(con):
    """The hard rules. Returns (ok, reason)."""
    if len(open_trades(con)) >= config.MAX_OPEN:
        return False, "a trade is already open"
    opened, pnl = today_stats(con)
    if opened >= config.MAX_TRADES_PER_DAY:
        return False, f"{opened} trades today already (limit {config.MAX_TRADES_PER_DAY})"
    eq = equity(con)
    if pnl < 0 and -pnl >= eq * config.DAILY_LOSS_STOP_PCT / 100:
        return False, f"daily loss limit reached ({pnl:.2f} USDT today)"
    if get(con, "cash", 0) < config.MIN_ORDER_USDT:
        return False, f"cash below the {config.MIN_ORDER_USDT} USDT minimum order"
    return True, ""


def buy(con, cand, decision):
    """Size the trade from cash and the stop, with fees and slippage. Returns the trade row or None."""
    price = cand["price"] * (1 + config.SLIPPAGE_PCT / 100)
    stop_atr = min(2.5, max(1.0, float(decision.get("stop_atr", 1.5))))
    target_r = min(3.0, max(1.5, float(decision.get("target_r", 2))))
    stop = price - stop_atr * cand["atr"]
    stop_pct = (price - stop) / price * 100
    if stop <= 0 or stop_pct > config.MAX_STOP_PCT:
        return None, f"stop would be {stop_pct:.1f}% away (limit {config.MAX_STOP_PCT}%)"
    target = price + target_r * (price - stop)
    cash = get(con, "cash", 0)
    spend = cash * 0.98 / max(1, config.MAX_OPEN - len(open_trades(con)))   # keep a little for rounding
    if spend < config.MIN_ORDER_USDT:
        return None, "order would be below the exchange minimum"
    qty = spend * (1 - config.FEE_PCT / 100) / price
    cur = con.execute("INSERT INTO trades(symbol,opened,entry,qty,cost,stop,target,confidence,reason) VALUES(?,?,?,?,?,?,?,?,?)",
                      (cand["symbol"], time.time(), price, qty, spend, stop, target,
                       float(decision.get("confidence", 0)), decision.get("reason", "")))
    put(con, "cash", cash - spend)
    return con.execute("SELECT * FROM trades WHERE id=?", (cur.lastrowid,)).fetchone(), ""


def sell(con, t, price, why):
    px = price * (1 - config.SLIPPAGE_PCT / 100)
    proceeds = t["qty"] * px * (1 - config.FEE_PCT / 100)
    con.execute("UPDATE trades SET closed=?, exit=?, proceeds=?, pnl=?, exit_reason=? WHERE id=?",
                (time.time(), px, proceeds, proceeds - t["cost"], why, t["id"]))
    put(con, "cash", get(con, "cash", 0) + proceeds)
    return con.execute("SELECT * FROM trades WHERE id=?", (t["id"],)).fetchone()


def check_exits(con):
    """Walk the 15-minute candles since the trade opened. If one candle touched both, assume the stop (worst case)."""
    closed = []
    for t in open_trades(con):
        candles = market.candles(t["symbol"], "15m", 1000, start_ms=t["opened"] * 1000)
        hit = None
        for c in candles:
            if c["t"] < t["opened"] * 1000:
                continue                     # this candle started before we bought
            if c["l"] <= t["stop"]:
                hit = (t["stop"], "stop-loss"); break
            if c["h"] >= t["target"]:
                hit = (t["target"], "target"); break
        if not hit and (time.time() - t["opened"]) / 3600 >= config.MAX_HOLD_HOURS:
            hit = (market.price(t["symbol"]), f"time limit ({config.MAX_HOLD_HOURS:.0f} h)")
        if hit:
            closed.append(sell(con, t, *hit))
    return closed


def log_decision(con, data):
    con.execute("INSERT INTO decisions(ts,data) VALUES(?,?)", (time.time(), json.dumps(data, default=str)))
    con.commit()
