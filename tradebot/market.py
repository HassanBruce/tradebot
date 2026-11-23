"""Public market data: Binance spot candles (no account or key needed) and the USD/PKR rate."""
import time

import requests

BASE = "https://data-api.binance.vision/api/v3"   # Binance's public market-data mirror
SKIP = ("USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "USDE", "EUR", "TRY", "BRL", "GBP", "PAXG", "XAUT", "WBTC", "XUSD")
_session = requests.Session()


def _get(path, **params):
    for attempt in range(3):
        try:
            r = _session.get(f"{BASE}/{path}", params=params, timeout=20)
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def top_symbols(n):
    """Most traded USDT pairs, without stablecoins, fiat and leveraged tokens."""
    rows = []
    for t in _get("ticker/24hr"):
        s = t["symbol"]
        if not s.endswith("USDT"):
            continue
        base = s[:-4]
        if base in SKIP or base.endswith(("UP", "DOWN", "BULL", "BEAR")) or float(t["lastPrice"]) <= 0:
            continue
        if len(base) >= 3 and base.endswith("B") and base not in ("BNB", "SHIB"):
            continue                                   # Binance tokenized stocks (NVDAB, MUB, ...), not crypto
        if "USD" in base or (0.97 < float(t["lastPrice"]) < 1.03 and abs(float(t["priceChangePercent"])) < 0.5):
            continue                                   # dollar stablecoins (USD1, RLUSD, PYUSD, ...) never move
        rows.append((float(t["quoteVolume"]), s))
    return [s for _, s in sorted(rows, reverse=True)[:n]]


def candles(symbol, interval, limit=200, start_ms=None):
    """[{t, o, h, l, c, v}] oldest first, closed candles only."""
    params = dict(symbol=symbol, interval=interval, limit=limit)
    if start_ms:
        params["startTime"] = int(start_ms)
    now = time.time() * 1000
    return [dict(t=k[0], o=float(k[1]), h=float(k[2]), l=float(k[3]), c=float(k[4]), v=float(k[5]))
            for k in _get("klines", **params) if k[6] < now]


def price(symbol):
    return float(_get("ticker/price", symbol=symbol)["price"])


def usd_pkr(cache={}):
    if cache.get("t", 0) > time.time() - 3600:
        return cache["v"]
    try:
        v = float(requests.get("https://open.er-api.com/v6/latest/USD", timeout=20).json()["rates"]["PKR"])
    except Exception:
        v = cache.get("v") or 280.0
    cache.update(t=time.time(), v=v)
    return v
