"""Indicators and the rule-based shortlist the AI chooses from. Long only (spot): we buy, then sell."""
from . import config, market


def ema(values, n):
    k, out = 2 / (n + 1), []
    for v in values:
        out.append(v if not out else v * k + out[-1] * (1 - k))
    return out


def rsi(closes, n=14):
    gains, losses = [], []
    for a, b in zip(closes, closes[1:]):
        gains.append(max(b - a, 0)); losses.append(max(a - b, 0))
    if len(gains) < n:
        return 50.0
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):
        ag, al = (ag * (n - 1) + g) / n, (al * (n - 1) + l) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def atr(c, n=14):
    trs = [max(x["h"] - x["l"], abs(x["h"] - p["c"]), abs(x["l"] - p["c"])) for p, x in zip(c, c[1:])]
    if not trs:
        return 0.0
    a = sum(trs[:n]) / min(n, len(trs))
    for t in trs[n:]:
        a = (a * (n - 1) + t) / n
    return a


def describe(symbol, interval=None):
    c = market.candles(symbol, interval or config.INTERVAL, 200)
    if len(c) < 60:
        return None
    closes = [x["c"] for x in c]
    e20, e50 = ema(closes, 20), ema(closes, 50)
    last = closes[-1]
    vol_now = sum(x["v"] for x in c[-6:]) / 6
    vol_avg = sum(x["v"] for x in c[-60:-6]) / 54 or 1
    return dict(
        symbol=symbol, price=last, atr=atr(c), atr_pct=round(atr(c) / last * 100, 2),
        rsi=round(rsi(closes), 1), ema20=e20[-1], ema50=e50[-1],
        above_ema50=last > e50[-1], ema20_over_50=e20[-1] > e50[-1],
        change_24h=round((last / closes[-7] - 1) * 100, 2) if config.INTERVAL == "4h" else None,
        change_7d=round((last / closes[-43] - 1) * 100, 2) if len(closes) > 43 else None,
        volume_vs_avg=round(vol_now / vol_avg, 2),
        dist_from_ema20_pct=round((last / e20[-1] - 1) * 100, 2),
        last_6_closes=[round(x, 6) for x in closes[-6:]],
    )


def market_regime():
    """BTC leads the crypto market: when it is in a downtrend, most coins fall with it."""
    b = describe("BTCUSDT")
    risk_off = bool(b and not b["above_ema50"] and b["rsi"] < 40)
    return b, risk_off


def shortlist(exclude=()):
    """Coins in an uptrend that are not already overheated. The AI picks from these, or nothing."""
    out = []
    for s in market.top_symbols(config.UNIVERSE):
        if s in exclude:
            continue
        try:
            d = describe(s)
        except Exception:
            continue
        if not d or not (d["above_ema50"] and d["ema20_over_50"]):
            continue
        if not 45 <= d["rsi"] <= 70 or d["dist_from_ema20_pct"] > 6:
            continue                                   # skip coins that already ran too far
        if d["atr_pct"] < 0.3:
            continue                                   # barely moves: a stablecoin or pegged token
        if d["atr_pct"] * 1.5 > config.MAX_STOP_PCT:
            continue                                   # too wild for our stop-loss limit
        out.append(d)
    out.sort(key=lambda d: (d["volume_vs_avg"], -abs(d["dist_from_ema20_pct"])), reverse=True)
    return out[:8]
