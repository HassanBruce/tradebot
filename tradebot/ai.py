"""Gemini picks at most one trade from the shortlist. The code, not the AI, sets the size and limits."""
import json
import re
import time

from . import config


def ask_json(prompt):
    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    from google import genai
    client = genai.Client(api_key=config.GEMINI_API_KEY, http_options={"timeout": 120_000})
    last = None
    for model in config.GEMINI_MODELS:
        for attempt in range(2):
            try:
                r = client.models.generate_content(model=model, contents=prompt, config={
                    "response_mime_type": "application/json", "temperature": 0.2, "max_output_tokens": 4096})
                t = re.sub(r"^```(?:json)?\s*|\s*```$", "", (r.text or "").strip())
                return json.loads(t), model
            except ValueError as e:
                last = e
            except Exception as e:
                last = e
                if any(x in str(e) for x in ("429", "RESOURCE_EXHAUSTED", "404", "imeout", "503", "UNAVAILABLE", "504", "DEADLINE")):
                    break
                time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Gemini failed: {str(last)[:200]}")


def decide(candidates, btc, account):
    if config.MODE == "gold":
        return decide_gold(candidates[0], account)
    prompt = f"""You are a careful crypto swing trader managing a very small paper account (spot, long only).
Your job is to protect capital first. Choosing NO trade is often the best answer.

Account: {json.dumps(account)}
Bitcoin ({config.INTERVAL} candles): {json.dumps(btc)}
Shortlist (already filtered for uptrends, {config.INTERVAL} candles; prices in USDT):
{json.dumps(candidates)}

Rules:
- Pick at most ONE coin from the shortlist, or none.
- Only buy when the trend is clear, the coin is near support (close to its EMA20) and volume supports the move.
- If Bitcoin looks weak, prefer no trade.
- stop_atr is the stop-loss distance in ATRs (1.0 to 2.5). target_r is the profit target as a multiple of that risk (1.5 to 3).
- Never invent news or data that is not given above.

Return JSON:
{{"market_view": "2 short sentences on the market right now",
  "trade": null or {{"symbol": "XXXUSDT", "confidence": 0-100, "stop_atr": 1.5, "target_r": 2, "reason": "2-3 sentences"}},
  "why_not": "if no trade, one sentence why"}}"""
    out, model = ask_json(prompt)
    out["model"] = model
    t = out.get("trade")
    allowed = {c["symbol"] for c in candidates}
    if t and (t.get("symbol") not in allowed or float(t.get("confidence", 0)) < config.MIN_CONFIDENCE):
        out["why_not"] = f"AI suggestion {t.get('symbol')} rejected (not on the shortlist or confidence below {config.MIN_CONFIDENCE})"
        out["trade"] = None
    return out


def decide_gold(g, account):
    prompt = f"""You are a disciplined gold day trader. The account trades gold futures-style with {config.LEVERAGE:.0f}x leverage,
long or short. Each trade uses a small fixed margin, so several trades can be open; never open the opposite side
of a position that is still open. Only take setups with a clear edge. Choosing NO trade is often right.

Account: {json.dumps(account)}
Gold ({config.INTERVAL} candles, price in USD per ounce, via PAXG): {json.dumps(g)}

Rules:
- side "long" only with the 4h trend up or a clear bounce from support; side "short" only with the 4h trend down or a clear rejection.
- Avoid trading against the 4h trend unless RSI is extreme (below 25 or above 75).
- stop_atr is the stop-loss distance in {config.INTERVAL} ATRs (1.0 to 2.5). target_r is the profit target as a multiple of that risk (1.5 to 3).
- Never invent news or data that is not given above.

Return JSON:
{{"market_view": "2 short sentences on gold right now",
  "trade": null or {{"symbol": "{config.GOLD_SYMBOL}", "side": "long" or "short", "confidence": 0-100, "stop_atr": 1.5, "target_r": 2, "reason": "2-3 sentences"}},
  "why_not": "if no trade, one sentence why"}}"""
    out, model = ask_json(prompt)
    out["model"] = model
    t = out.get("trade")
    if t and (t.get("side") not in ("long", "short") or float(t.get("confidence", 0)) < config.MIN_CONFIDENCE):
        out["why_not"] = f"AI suggestion rejected (side {t.get('side')}, confidence {t.get('confidence')}; minimum {config.MIN_CONFIDENCE})"
        out["trade"] = None
    return out
