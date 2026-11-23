"""Paper trading bot.

    python -m tradebot.main run          # every hour: check stop-loss/targets, maybe ask the AI for a new trade
    python -m tradebot.main report       # daily summary email
    python -m tradebot.main status       # print the account
    python -m tradebot.main test-email
"""
import logging
import sys
import time

from . import ai, config, market, paper, report, strategy

log = logging.getLogger("tradebot")


def run(con):
    if paper.init(con):
        log.info("new paper account: Rs %.0f = %.2f USDT", config.START_PKR, paper.get(con, "cash"))
    for t in paper.check_exits(con):
        log.info("closed %s %s pnl %.3f", t["symbol"], t["exit_reason"], t["pnl"])
        if config.TRADE_ALERTS:
            report.alert_close(t)

    ok, why = paper.can_open(con)
    if not ok:
        log.info("no new trade: %s", why)
        return
    last_ai = paper.get(con, "last_ai", 0)
    if time.time() - last_ai < config.AI_EVERY_HOURS * 3600 - 300:
        log.info("AI asked %.1f h ago, waiting", (time.time() - last_ai) / 3600)
        return

    if config.MODE == "gold":
        from datetime import datetime
        from zoneinfo import ZoneInfo
        if not config.TRADE_WEEKENDS and datetime.now(ZoneInfo(config.TIMEZONE)).weekday() >= 5:
            log.info("weekend: gold futures closed, no new trades")
            return
        btc, risk_off = None, False
    else:
        btc, risk_off = strategy.market_regime()
    if risk_off:
        paper.put(con, "last_ai", time.time())
        paper.log_decision(con, {"market_view": "Bitcoin is in a downtrend (below its 50 EMA, RSI under 40).",
                                 "why_not": "Rule: no new buys while Bitcoin is weak."})
        log.info("risk-off: BTC weak, no trades")
        return
    held = {t["symbol"] for t in paper.open_trades(con)}
    cands = strategy.gold_candidate() if config.MODE == "gold" else strategy.shortlist(exclude=held)
    paper.put(con, "last_ai", time.time())
    if not cands:
        paper.log_decision(con, {"market_view": "No coin passed the trend and risk filters.",
                                 "why_not": "Nothing on the shortlist."})
        log.info("empty shortlist")
        return
    eq = paper.equity(con)
    account = dict(equity_usd=round(eq, 2), equity_pkr=round(eq * market.usd_pkr()),
                   open_positions=[dict(side=t["side"], entry=round(t["entry"], 2), stop=round(t["stop"], 2),
                                        target=round(t["target"], 2)) for t in paper.open_trades(con)],
                   max_positions=config.MAX_OPEN, leverage=config.LEVERAGE)
    try:
        d = ai.decide(cands, btc, account)
    except Exception as e:
        log.warning("AI failed: %s", e)
        paper.put(con, "last_ai", last_ai)          # try again at the next hourly run instead of waiting hours
        paper.log_decision(con, {"market_view": "", "why_not": f"AI unavailable: {str(e)[:150]}"})
        return
    d["shortlist"] = [c["symbol"] for c in cands]
    t = d.get("trade")
    if t:
        cand = cands[0] if config.MODE == "gold" else next(c for c in cands if c["symbol"] == t["symbol"])
        row, why = paper.buy(con, cand, t)
        if row:
            log.info("bought %s at %.6g", row["symbol"], row["entry"])
            if config.TRADE_ALERTS:
                report.alert_open(row)
        else:
            d["why_not"] = f"Rejected by risk rules: {why}"
            log.info("trade rejected: %s", why)
    else:
        log.info("AI: no trade (%s)", d.get("why_not"))
    paper.log_decision(con, d)


def status(con):
    start = paper.get(con, "start")
    if not start:
        print("no account yet: run first"); return
    eq = paper.equity(con)
    rate = market.usd_pkr()
    print(f"equity {eq:.2f} USDT = Rs {eq * rate:,.0f} (start Rs {start['pkr']:,.0f})")
    for t in paper.open_trades(con):
        print("open", t["symbol"], t["entry"], "stop", t["stop"], "target", t["target"])
    for r in con.execute("SELECT symbol, pnl, exit_reason FROM trades WHERE closed IS NOT NULL ORDER BY id DESC LIMIT 10"):
        print("closed", dict(r))


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cmd = argv[0] if argv else "run"
    con = paper.db()
    if cmd == "run":
        run(con)
    elif cmd == "report":
        paper.init(con)
        report.daily(con)
    elif cmd == "status":
        status(con)
    elif cmd == "test-email":
        print("sent" if report.send("Trade bot: test email", "<p>Trade bot test email. Har trade aur roz ka hisaab aise aayega.</p>")
              else "email not configured")
    else:
        print(__doc__); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
