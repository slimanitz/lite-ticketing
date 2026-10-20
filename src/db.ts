import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { mainRoot } from './git.js';

export const DB_DIRNAME = '.tickets';
export const DB_FILENAME = 'tickets.db';
export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('backlog','todo','in_progress','review','done','cancelled')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  type TEXT NOT NULL DEFAULT 'feature'
    CHECK (type IN ('feature','bug','chore','epic','spike')),
  parent_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
  assignee TEXT,
  branch TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_milestone ON tickets(milestone_id);
CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_id);
CREATE TABLE IF NOT EXISTS labels (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  PRIMARY KEY (ticket_id, label)
);
CREATE TABLE IF NOT EXISTS deps (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, depends_on),
  CHECK (ticket_id != depends_on)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  actor TEXT,
  kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_id, id);
`;

/**
 * Resolve where the database lives:
 *  1. explicit path argument
 *  2. $TK_DB
 *  3. <main git worktree root>/.tickets/tickets.db  (shared by all worktrees)
 *  4. <cwd>/.tickets/tickets.db
 */
export function resolveDbPath(explicit?: string, cwd = process.cwd()): string {
  if (explicit) return path.resolve(cwd, explicit);
  if (process.env.TK_DB) return path.resolve(cwd, process.env.TK_DB);
  const root = mainRoot(cwd) ?? cwd;
  return path.join(root, DB_DIRNAME, DB_FILENAME);
}

export function dbExists(dbPath: string): boolean {
  return fs.existsSync(dbPath);
}

export function openDb(dbPath: string, opts: { create?: boolean } = {}): DatabaseSync {
  const create = opts.create ?? true;
  if (!create && !fs.existsSync(dbPath)) {
    throw new Error(`No ticket database at ${dbPath}. Run "tk init" first.`);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA);
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
  if (!row) {
    db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION));
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('created_at', ?)`).run(new Date().toISOString());
  }
  // Future migrations: compare Number(row.value) to SCHEMA_VERSION and ALTER accordingly.
}

export function now(): string {
  return new Date().toISOString();
}
