import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-cli-'));
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.email', 't@example.com']);
  sh(dir, 'git', ['config', 'user.name', 'T']);
  sh(dir, 'git', ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function sh(cwd: string, cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, TK_ACTOR: 'bot', NO_COLOR: '1' } });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function tk(cwd: string, ...args: string[]) {
  return sh(cwd, process.execPath, [CLI, ...args]);
}

function tkj(cwd: string, ...args: string[]): any {
  const r = tk(cwd, ...args, '--json');
  assert.equal(r.code, 0, `tk ${args.join(' ')} failed: ${r.err || r.out}`);
  return JSON.parse(r.out);
}

test('init creates db at repo root and git-ignores it', () => {
  const dir = repo();
  const r = tkj(dir, 'init');
  assert.equal(r.db, path.join(dir, '.tickets', 'tickets.db'));
  assert.ok(fs.existsSync(r.db));
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.tickets\/$/m);
  assert.equal(tkj(dir, 'init').created, false);
});

test('commands fail cleanly without a database', () => {
  const dir = repo();
  const r = tk(dir, 'ls', '--json');
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.out).code, 'NO_DB');
});

test('add / ls / show / edit / done round trip', () => {
  const dir = repo();
  tkj(dir, 'init');
  const m = tkj(dir, 'ms', 'add', 'v0.1 MVP', '--due', '2026-12-01');
  assert.equal(m.id, 'M-1');
  const t = tkj(dir, 'add', 'User login', '-p', 'critical', '-t', 'feature', '-M', 'v0.1', '-l', 'auth,backend', '-d', 'OAuth');
  assert.equal(t.id, 'T-1');
  assert.equal(t.priority, 'critical');
  assert.equal(t.milestone, 'M-1');
  assert.deepEqual(t.labels, ['auth', 'backend']);
  const sub = tkj(dir, 'add', 'Login form', '--parent', 'T-1', '--depends-on', 'T-1');
  assert.equal(sub.parent, 'T-1');
  assert.deepEqual(sub.blocked_by, ['T-1']);
  assert.equal(tkj(dir, 'ls').length, 2);
  assert.equal(tkj(dir, 'ls', '--blocked').length, 1);
  assert.equal(tkj(dir, 'ls', '-M', 'none').length, 0);
  const e = tkj(dir, 'edit', 'T-2', '-p', 'P1', '--unlabel', 'nothing', '-l', 'ui');
  assert.equal(e.priority, 'high');
  assert.deepEqual(e.labels, ['ui']);
  const blocked = tk(dir, 'start', 'T-2', '--json');
  assert.equal(JSON.parse(blocked.out).code, 'BLOCKED');
  assert.equal(tkj(dir, 'done', 'T-1').status, 'done');
  assert.deepEqual(tkj(dir, 'show', 'T-2').blocked_by, []);
  const shown = tkj(dir, 'show', 'T-1');
  assert.equal(shown.children.length, 1);
  assert.ok(shown.events.length >= 2);
  const notFound = tk(dir, 'show', 'T-9');
  assert.equal(notFound.code, 3);
});

test('next --claim --checkout starts the ticket on a branch; current finds it', () => {
  const dir = repo();
  tkj(dir, 'init');
  tkj(dir, 'add', 'Low thing', '-p', 'low');
  tkj(dir, 'add', 'Fix crash on save', '-p', 'critical', '-t', 'bug');
  const picked = tkj(dir, 'next');
  assert.equal(picked.id, 'T-2');
  const started = tkj(dir, 'next', '--claim', '--checkout');
  assert.equal(started.id, 'T-2');
  assert.equal(started.status, 'in_progress');
  assert.equal(started.assignee, 'bot');
  assert.equal(started.branch, 'fix/t-2-fix-crash-on-save');
  assert.equal(started.git.created, true);
  assert.equal(sh(dir, 'git', ['branch', '--show-current']).out, 'fix/t-2-fix-crash-on-save');
  assert.equal(tkj(dir, 'current').ticket.id, 'T-2');
  // next skips the now-assigned ticket
  assert.equal(tkj(dir, 'next').id, 'T-1');
});

test('hook prefixes commits and sync marks merged branches done', () => {
  const dir = repo();
  tkj(dir, 'init');
  tkj(dir, 'add', 'Add thing');
  tkj(dir, 'hook', 'install');
  tkj(dir, 'start', 'T-1', '--checkout');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-q', '-m', 'add file']);
  assert.equal(sh(dir, 'git', ['log', '-1', '--format=%s']).out, '[T-1] add file');
  sh(dir, 'git', ['commit', '-q', '--allow-empty', '-m', 'T-1 already referenced']);
  assert.equal(sh(dir, 'git', ['log', '-1', '--format=%s']).out, 'T-1 already referenced');

  let s = tkj(dir, 'sync');
  assert.equal(s.results[0].action, 'open');
  sh(dir, 'git', ['checkout', '-q', 'main']);
  sh(dir, 'git', ['merge', '-q', 'feat/t-1-add-thing']);
  s = tkj(dir, 'sync', '--dry-run');
  assert.match(s.results[0].action, /would mark done/);
  assert.equal(tkj(dir, 'show', 'T-1').status, 'in_progress');
  s = tkj(dir, 'sync');
  assert.match(s.results[0].action, /marked done/);
  assert.equal(tkj(dir, 'show', 'T-1').status, 'done');
});

test('worktrees share the database', () => {
  const dir = repo();
  tkj(dir, 'init');
  tkj(dir, 'add', 'Parallel work');
  const wt = path.join(dir, '..', path.basename(dir) + '-wt');
  const r = tkj(dir, 'start', 'T-1', '--worktree', wt);
  assert.equal(r.git.worktree, path.resolve(wt));
  assert.ok(fs.existsSync(wt));
  assert.equal(tkj(wt, 'path').db, path.join(dir, '.tickets', 'tickets.db'));
  assert.equal(tkj(wt, 'current').ticket.id, 'T-1');
  tkj(wt, 'note', 'T-1', 'from the worktree');
  assert.equal(tkj(dir, 'show', 'T-1').notes.length, 1);
  fs.rmSync(wt, { recursive: true, force: true });
});

test('roadmap, board, export and milestone close rules', () => {
  const dir = repo();
  tkj(dir, 'init');
  tkj(dir, 'ms', 'add', 'v1');
  tkj(dir, 'add', 'A', '-M', 'v1');
  tkj(dir, 'add', 'B', '-M', 'v1');
  tkj(dir, 'done', 'T-1');
  const rm = tkj(dir, 'roadmap');
  assert.equal(rm.milestones[0].progress.percent, 50);
  assert.equal(rm.milestones[0].tickets.length, 2);
  const board = tkj(dir, 'board');
  assert.equal(board.columns.done.length, 1);
  assert.equal(board.columns.todo.length, 1);
  const md = tk(dir, 'export');
  assert.match(md.out, /## M-1 v1/);
  assert.match(md.out, /- \[x\] \*\*T-1\*\* A/);
  const closeFail = tk(dir, 'ms', 'done', 'M-1', '--json');
  assert.equal(closeFail.code, 1);
  assert.equal(tkj(dir, 'ms', 'done', 'M-1', '--force').status, 'done');
  const text = tk(dir, 'board');
  assert.match(text.out, /In progress \(0\)/);
});

test('works outside git with --db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-nogit-'));
  const db = path.join(dir, 'x.db');
  assert.equal(tkj(dir, 'init', '--db', db).db, db);
  assert.equal(tkj(dir, 'add', 'hi', '--db', db).id, 'T-1');
  assert.equal(sh(dir, process.execPath, [CLI, 'ls', '--json']).code, 1, 'default path has no db');
});
