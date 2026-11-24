"""Emails: a short alert for every paper trade, and a daily summary."""
import html
import smtplib
import ssl
import time
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from . import config, market, paper

E = lambda s: html.escape(str(s if s is not None else ""))


def send(subject, body):
    if not (config.SMTP_USER and config.SMTP_PASSWORD and config.REPORT_TO):
        return False
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subject, f"{config.LABEL} <{config.SMTP_USER}>", ", ".join(config.REPORT_TO)
    m.set_content("Open this email in HTML view.")
    m.add_alternative(f'<div style="font-family:Arial,sans-serif;max-width:720px;color:#111;font-size:14px">{body}'
                      '<p style="font-size:11px;color:#888;margin-top:24px">PAPER TRADING: nakli paise, asli prices. '
                      'Koi asli order nahi lagta. Ye financial advice nahi hai.</p></div>', subtype="html")
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=60) as s:
        s.starttls(context=ssl.create_default_context())
        s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(m)
    return True


def rs(usdt):
    return f"Rs {usdt * market.usd_pkr():,.0f}"


def _local(ts):
    return datetime.fromtimestamp(ts, ZoneInfo(config.TIMEZONE)).strftime("%d %b %H:%M")


def _name(sym):
    return "GOLD" if sym == config.GOLD_SYMBOL else sym


def alert_open(t):
    pct_stop = abs(t["entry"] - t["stop"]) / t["entry"] * 100
    pct_target = abs(t["target"] - t["entry"]) / t["entry"] * 100
    side = (t["side"] or "long")
    lev = (t["notional"] or t["cost"]) / t["cost"] if t["cost"] else 1
    loss_at_stop = t["qty"] * abs(t["entry"] - t["stop"])
    gain_at_target = t["qty"] * abs(t["target"] - t["entry"])
    word = "KHAREEDA (long, upar jaane par munafa)" if side == "long" else "BECHA (short, neeche jaane par munafa)"
    send(f"{config.LABEL}: Paper {'BUY' if side == 'long' else 'SELL'} {_name(t['symbol'])} · stop par −{rs(loss_at_stop)}, target par +{rs(gain_at_target)}",
         f"<h2 style='margin:0 0 8px'>{_name(t['symbol'])}: {word}</h2>"
         f"<p>Price {t['entry']:.6g} USD · margin {rs(t['cost'])} · leverage {lev:.1f}x<br>"
         f"Stop-loss {t['stop']:.6g} ({pct_stop:.2f}% door): nuqsaan ~{rs(loss_at_stop)}<br>"
         f"Target {t['target']:.6g} ({pct_target:.2f}% door): munafa ~{rs(gain_at_target)}<br>"
         f"AI confidence {t['confidence']:.0f}/100</p><p><b>Kyun:</b> {E(t['reason'])}</p>")


def alert_close(t):
    pct = t["pnl"] / t["cost"] * 100
    word = "MUNAFA" if t["pnl"] >= 0 else "NUQSAAN"
    send(f"{config.LABEL}: trade band {_name(t['symbol'])}: {word} {rs(abs(t['pnl']))} ({pct:+.1f}%)",
         f"<h2 style='margin:0 0 8px'>Trade band: {E(_name(t['symbol']))} ({E(t['exit_reason'])})</h2>"
         f"<p>Khareeda {t['entry']:.6g} → becha {t['exit']:.6g} USDT<br>"
         f"Nateeja: <b style='color:{'#067647' if t['pnl'] >= 0 else '#b42318'}'>{word} {rs(abs(t['pnl']))} ({pct:+.1f}%)</b>, fees ke baad.</p>")


def daily(con):
    start = paper.get(con, "start")
    eq = paper.equity(con)
    rate = market.usd_pkr()
    bsym = start.get("bench_symbol", "BTCUSDT")
    bench = start["usdt"] * market.price(bsym) / start.get("bench", start["btc"])
    days = max(1, int((time.time() - start["ts"]) / 86400) + 1)
    closed = con.execute("SELECT * FROM trades WHERE closed IS NOT NULL ORDER BY closed DESC").fetchall()
    wins = sum(1 for t in closed if t["pnl"] > 0)
    since = time.time() - 86400
    today = [t for t in closed if t["closed"] >= since]
    opened = paper.open_trades(con)
    last = con.execute("SELECT data FROM decisions ORDER BY id DESC LIMIT 1").fetchone()
    import json
    last = json.loads(last[0]) if last else {}
    color = "#067647" if eq >= start["usdt"] else "#b42318"
    h = [f"<h2 style='margin:0 0 6px'>{E(config.LABEL)} · din {days}</h2>",
         f"<p style='font-size:22px;margin:4px 0'><b style='color:{color}'>Rs {eq * rate:,.0f}</b> "
         f"<span style='font-size:14px;color:#555'>(shuru Rs {start['pkr']:,.0f} · {(eq / start['usdt'] - 1) * 100:+.1f}%)</span></p>",
         f"<p style='color:#555'>Agar sirf {'sona' if bsym == config.GOLD_SYMBOL else 'Bitcoin'} khareed kar rakh lete: Rs {bench * rate:,.0f} ({(bench / start['usdt'] - 1) * 100:+.1f}%). "
         "Bot tabhi kaam ka hai jab ye is se behtar kare.</p>",
         f"<p>Total trades: {len(closed)} · jeetay {wins} · haaray {len(closed) - wins}"
         + (f" · jeet ka hissa {wins / len(closed) * 100:.0f}%" if closed else "") + "</p>"]
    if opened:
        rows = []
        for t in opened:
            p = market.price(t["symbol"])
            rows.append(f"<li>{E(_name(t['symbol']))} {E(t['side'] or 'long')}: entry {t['entry']:.6g}, abhi {p:.6g} "
                        f"(abhi {'+' if paper.value(t, p) >= t['cost'] else '−'}{rs(abs(paper.value(t, p) - t['cost']))}) · stop {t['stop']:.6g} · target {t['target']:.6g} · {_local(t['opened'])} se</li>")
        h.append("<h3>Khuli trade</h3><ul>" + "".join(rows) + "</ul>")
    else:
        h.append("<p>Abhi koi trade khuli nahi.</p>")
    if today:
        h.append("<h3>Pichhle 24 ghante ki band trades</h3><ul>" + "".join(
            f"<li>{E(_name(t['symbol']))} {E(t['side'] or 'long')}: {'+' if t['pnl'] >= 0 else '−'}{rs(abs(t['pnl']))} ({t['pnl'] / t['cost'] * 100:+.1f}%, {E(t['exit_reason'])})</li>"
            for t in today) + "</ul>")
    if last:
        h.append(f"<h3>AI ki aakhri raaye</h3><p>{E(last.get('market_view'))}</p>"
                 + (f"<p style='color:#555'>{E(last.get('why_not'))}</p>" if last.get("why_not") else ""))
    send(f"{config.LABEL}: Rs {eq * rate:,.0f} ({(eq / start['usdt'] - 1) * 100:+.1f}%) · din {days}", "".join(h))
