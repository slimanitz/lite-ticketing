import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.js';
import { Store } from '../src/store.js';
import { UserError } from '../src/types.js';

/** A fresh store on a temp file, using the real schema/migration. */
function mem(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-store-'));
  return new Store(openDb(path.join(dir, 'tickets.db')), 'tester');
}

test('create, get, list with filters', () => {
  const s = mem();
  const a = s.createTicket({ title: 'A', priority: 0, labels: ['x'] });
  const b = s.createTicket({ title: 'B', priority: 3, status: 'backlog' });
  assert.equal(a.id, 1);
  assert.deepEqual(a.labels, ['x']);
  assert.equal(s.listTickets().length, 2);
  assert.equal(s.listTickets({ status: ['backlog'] })[0]!.id, b.id);
  assert.equal(s.listTickets({ label: 'x' }).length, 1);
  s.setStatus(a.id, 'done');
  assert.equal(s.listTickets().length, 1, 'closed tickets hidden by default');
  assert.equal(s.listTickets({ includeClosed: true }).length, 2);
  assert.ok(s.getTicket(a.id)!.closed_at);
});

test('dependencies block start and are released on done', () => {
  const s = mem();
  const a = s.createTicket({ title: 'A' });
  const b = s.createTicket({ title: 'B', depends_on: [a.id] });
  assert.deepEqual(s.getTicket(b.id)!.blocked_by, [a.id]);
  assert.throws(() => s.setStatus(b.id, 'in_progress'), (e: unknown) => e instanceof UserError && e.code === 'BLOCKED');
  s.setStatus(b.id, 'in_progress', { force: true });
  s.setStatus(b.id, 'todo');
  s.setStatus(a.id, 'done');
  assert.deepEqual(s.getTicket(b.id)!.blocked_by, []);
  s.setStatus(b.id, 'in_progress');
  assert.equal(s.getTicket(b.id)!.status, 'in_progress');
});

test('dependency cycles are rejected', () => {
  const s = mem();
  const a = s.createTicket({ title: 'A' });
  const b = s.createTicket({ title: 'B' });
  const c = s.createTicket({ title: 'C' });
  s.addDep(b.id, a.id);
  s.addDep(c.id, b.id);
  assert.throws(() => s.addDep(a.id, c.id), (e: unknown) => e instanceof UserError && e.code === 'CYCLE');
  assert.throws(() => s.addDep(a.id, a.id));
});

test('next picks highest priority unblocked unassigned todo, prefers earlier milestone', () => {
  const s = mem();
  const late = s.createMilestone({ name: 'later', due: '2027-01-01' });
  const soon = s.createMilestone({ name: 'soon', due: '2026-11-01' });
  s.createTicket({ title: 'backlog item', priority: 0, status: 'backlog' });
  s.createTicket({ title: 'assigned', priority: 0, assignee: 'someone' });
  const blocker = s.createTicket({ title: 'blocker', priority: 2 });
  s.createTicket({ title: 'blocked', priority: 0, depends_on: [blocker.id] });
  s.createTicket({ title: 'epic', priority: 0, type: 'epic' });
  const l = s.createTicket({ title: 'p1 late', priority: 1, milestone_id: late.id });
  const sn = s.createTicket({ title: 'p1 soon', priority: 1, milestone_id: soon.id });
  assert.equal(s.next()!.id, sn.id);
  s.setStatus(sn.id, 'done');
  assert.equal(s.next()!.id, l.id);
  assert.equal(s.next({ assignee: 'someone' })!.title, 'assigned');
});

test('milestone progress and name lookup', () => {
  const s = mem();
  const m = s.createMilestone({ name: 'v0.1 MVP' });
  const a = s.createTicket({ title: 'A', milestone_id: m.id });
  s.createTicket({ title: 'B', milestone_id: m.id });
  s.createTicket({ title: 'C', milestone_id: m.id, status: 'cancelled' });
  s.setStatus(a.id, 'done');
  assert.deepEqual(s.milestoneProgress(m.id), { total: 2, done: 1, open: 1, in_progress: 0 });
  assert.equal(s.findMilestoneByName('v0.1')!.id, m.id);
  assert.equal(s.findMilestoneByName('V0.1 mvp')!.id, m.id);
  assert.equal(s.findMilestoneByName('nope'), null);
  s.createMilestone({ name: 'v0.1 hotfix' });
  assert.throws(() => s.findMilestoneByName('v0.1'), /ambiguous/);
});

test('events and notes are recorded with actor', () => {
  const s = mem();
  const a = s.createTicket({ title: 'A' });
  s.addNote(a.id, 'hello');
  s.updateTicket(a.id, { assignee: 'bob', title: 'A2', branch: 'feat/t-1-a' });
  s.setStatus(a.id, 'in_progress');
  const kinds = s.events(a.id).map((e) => e.kind);
  assert.deepEqual(kinds, ['status', 'edit', 'branch', 'assign', 'note', 'created']);
  assert.ok(s.events(a.id).every((e) => e.actor === 'tester'));
  assert.equal(s.notes(a.id).length, 1);
});

test('transactions are re-entrant and roll back on error', () => {
  const s = mem();
  const a = s.createTicket({ title: 'A' });
  assert.throws(() =>
    s.tx(() => {
      s.setStatus(a.id, 'in_progress');
      s.tx(() => s.addNote(a.id, 'inner'));
      throw new Error('boom');
    }),
  );
  assert.equal(s.getTicket(a.id)!.status, 'todo');
  assert.equal(s.notes(a.id).length, 0);
  s.tx(() => {
    s.setStatus(a.id, 'in_progress');
    s.tx(() => s.addNote(a.id, 'inner'));
  });
  assert.equal(s.getTicket(a.id)!.status, 'in_progress');
});

test('delete cascades labels/deps and unparents children', () => {
  const s = mem();
  const p = s.createTicket({ title: 'P', labels: ['l'] });
  const c = s.createTicket({ title: 'C', parent_id: p.id, depends_on: [p.id] });
  s.deleteTicket(p.id);
  const child = s.getTicket(c.id)!;
  assert.equal(child.parent_id, null);
  assert.deepEqual(child.blocked_by, []);
  assert.equal(s.getTicket(p.id), null);
});
