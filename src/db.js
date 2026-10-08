import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;
export function getDb() {
  if (db) return db;
  const file = config.dataDir === ':memory:' ? ':memory:'
    : (fs.mkdirSync(config.dataDir, { recursive: true }), path.join(config.dataDir, 'tradebot.sqlite'));
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL, symbol TEXT NOT NULL,
      qty REAL NOT NULL, entry_price REAL NOT NULL, entry_quote REAL NOT NULL, entry_fee REAL NOT NULL,
      stop REAL, target REAL, entry_reason TEXT, opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      exit_price REAL, exit_quote REAL, exit_fee REAL, exit_reason TEXT, closed_at TEXT,
      pnl REAL
    );
    CREATE TABLE IF NOT EXISTS log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL, message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

export const kvGet = (k, d = null) => getDb().prepare('SELECT v FROM kv WHERE k=?').get(k)?.v ?? d;
export const kvSet = (k, v) => getDb().prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

export function log(level, message) {
  getDb().prepare('INSERT INTO log (level, message) VALUES (?,?)').run(level, message);
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`);
}

export function openTrade() {
  return getDb().prepare('SELECT * FROM trades WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get() ?? null;
}

export function insertTrade(t) {
  const r = getDb().prepare(`INSERT INTO trades (mode, symbol, qty, entry_price, entry_quote, entry_fee, stop, target, entry_reason)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(t.mode, t.symbol, t.qty, t.entry_price, t.entry_quote, t.entry_fee, t.stop, t.target, t.entry_reason);
  return Number(r.lastInsertRowid);
}

export function closeTrade(id, x) {
  getDb().prepare(`UPDATE trades SET exit_price=?, exit_quote=?, exit_fee=?, exit_reason=?, pnl=?, closed_at=datetime('now') WHERE id=?`)
    .run(x.exit_price, x.exit_quote, x.exit_fee, x.exit_reason, x.pnl, id);
}

export function trades(limit = 200) {
  return getDb().prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?').all(limit);
}

export function realizedToday() {
  return getDb().prepare(`SELECT COALESCE(SUM(pnl),0) s FROM trades WHERE closed_at IS NOT NULL AND date(closed_at)=date('now')`).get().s;
}

export function recentLog(limit = 100) {
  return getDb().prepare('SELECT * FROM log ORDER BY id DESC LIMIT ?').all(limit);
}

export function summary() {
  const closed = getDb().prepare('SELECT pnl, entry_fee, exit_fee FROM trades WHERE closed_at IS NOT NULL').all();
  const wins = closed.filter(t => t.pnl > 0).length;
  return {
    closed: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? wins / closed.length : 0,
    pnl: closed.reduce((s, t) => s + t.pnl, 0),
    fees: closed.reduce((s, t) => s + t.entry_fee + (t.exit_fee ?? 0), 0),
  };
}
