import { now } from './db.js';
import { fmtMilestoneId, fmtTicketId } from './ids.js';
import { CLOSED_STATUSES, OPEN_STATUSES, UserError, } from './types.js';
const STATUS_ORDER = {
    in_progress: 0,
    review: 1,
    todo: 2,
    backlog: 3,
    done: 4,
    cancelled: 5,
};
export class Store {
    db;
    actor;
    constructor(db, actor = null) {
        this.db = db;
        this.actor = actor;
    }
    // ---------- transactions ----------
    txDepth = 0;
    /** Run fn inside a transaction. Re-entrant: nested calls join the outer transaction. */
    tx(fn) {
        if (this.txDepth > 0) {
            this.txDepth++;
            try {
                return fn();
            }
            finally {
                this.txDepth--;
            }
        }
        this.db.exec('BEGIN IMMEDIATE');
        this.txDepth = 1;
        try {
            const r = fn();
            this.db.exec('COMMIT');
            return r;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
        finally {
            this.txDepth = 0;
        }
    }
    // ---------- events ----------
    addEvent(ticketId, kind, data = {}) {
        this.db
            .prepare(`INSERT INTO events (ticket_id, at, actor, kind, data) VALUES (?, ?, ?, ?, ?)`)
            .run(ticketId, now(), this.actor, kind, JSON.stringify(data));
    }
    events(ticketId, limit = 50) {
        if (ticketId !== undefined) {
            return this.db
                .prepare(`SELECT * FROM events WHERE ticket_id = ? ORDER BY id DESC LIMIT ?`)
                .all(ticketId, limit);
        }
        return this.db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT ?`).all(limit);
    }
    notes(ticketId) {
        return this.db
            .prepare(`SELECT * FROM events WHERE ticket_id = ? AND kind = 'note' ORDER BY id ASC`)
            .all(ticketId);
    }
    // ---------- tickets ----------
    createTicket(input) {
        const title = input.title.trim();
        if (!title)
            throw new UserError('Title is required');
        return this.tx(() => {
            if (input.parent_id != null)
                this.requireTicket(input.parent_id);
            if (input.milestone_id != null)
                this.requireMilestone(input.milestone_id);
            const ts = now();
            const r = this.db
                .prepare(`INSERT INTO tickets (title, description, status, priority, type, parent_id, milestone_id, assignee, branch, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tickets), ?, ?)`)
                .run(title, input.description ?? '', input.status ?? 'todo', input.priority ?? 2, input.type ?? 'feature', input.parent_id ?? null, input.milestone_id ?? null, input.assignee ?? null, input.branch ?? null, ts, ts);
            const id = Number(r.lastInsertRowid);
            for (const l of input.labels ?? [])
                this.db.prepare(`INSERT OR IGNORE INTO labels (ticket_id, label) VALUES (?, ?)`).run(id, l);
            for (const d of input.depends_on ?? [])
                this.addDepUnchecked(id, d);
            this.addEvent(id, 'created', { title, status: input.status ?? 'todo' });
            return this.getTicket(id);
        });
    }
    getTicket(id) {
        const row = this.db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id);
        if (!row)
            return null;
        return this.hydrate(row);
    }
    requireTicket(id) {
        const t = this.getTicket(id);
        if (!t)
            throw new UserError(`Ticket ${fmtTicketId(id)} not found`, 'NOT_FOUND');
        return t;
    }
    hydrate(row) {
        const labels = this.db.prepare(`SELECT label FROM labels WHERE ticket_id = ? ORDER BY label`).all(row.id).map((r) => r.label);
        const blocked_by = this.openBlockers(row.id);
        return { ...row, labels, blocked_by };
    }
    /** Ids of dependencies that are not yet done. */
    openBlockers(id) {
        return this.db
            .prepare(`SELECT d.depends_on AS id FROM deps d JOIN tickets t ON t.id = d.depends_on
           WHERE d.ticket_id = ? AND t.status NOT IN ('done','cancelled') ORDER BY d.depends_on`)
            .all(id).map((r) => r.id);
    }
    allDeps(id) {
        return this.db.prepare(`SELECT depends_on AS id FROM deps WHERE ticket_id = ? ORDER BY depends_on`).all(id).map((r) => r.id);
    }
    dependents(id) {
        return this.db.prepare(`SELECT ticket_id AS id FROM deps WHERE depends_on = ? ORDER BY ticket_id`).all(id).map((r) => r.id);
    }
    children(id) {
        const rows = this.db.prepare(`SELECT * FROM tickets WHERE parent_id = ? ORDER BY position, id`).all(id);
        return rows.map((r) => this.hydrate(r));
    }
    listTickets(f = {}) {
        const where = [];
        const params = [];
        if (f.status && f.status.length) {
            where.push(`t.status IN (${f.status.map(() => '?').join(',')})`);
            params.push(...f.status);
        }
        else if (!f.includeClosed) {
            where.push(`t.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`);
            params.push(...OPEN_STATUSES);
        }
        if (f.milestone === 'none')
            where.push(`t.milestone_id IS NULL`);
        else if (typeof f.milestone === 'number') {
            where.push(`t.milestone_id = ?`);
            params.push(f.milestone);
        }
        if (f.parent === 'none')
            where.push(`t.parent_id IS NULL`);
        else if (typeof f.parent === 'number') {
            where.push(`t.parent_id = ?`);
            params.push(f.parent);
        }
        if (f.assignee === 'none')
            where.push(`t.assignee IS NULL`);
        else if (f.assignee) {
            where.push(`t.assignee = ?`);
            params.push(f.assignee);
        }
        if (f.type) {
            where.push(`t.type = ?`);
            params.push(f.type);
        }
        if (f.label) {
            where.push(`EXISTS (SELECT 1 FROM labels l WHERE l.ticket_id = t.id AND l.label = ?)`);
            params.push(f.label);
        }
        if (f.search) {
            where.push(`(t.title LIKE ? OR t.description LIKE ?)`);
            params.push(`%${f.search}%`, `%${f.search}%`);
        }
        const blockedExpr = `EXISTS (SELECT 1 FROM deps d JOIN tickets b ON b.id = d.depends_on WHERE d.ticket_id = t.id AND b.status NOT IN ('done','cancelled'))`;
        if (f.blocked === true)
            where.push(blockedExpr);
        if (f.blocked === false)
            where.push(`NOT ${blockedExpr}`);
        const sql = `SELECT t.* FROM tickets t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE t.status ${Object.entries(STATUS_ORDER)
            .map(([s, o]) => `WHEN '${s}' THEN ${o}`)
            .join(' ')} END, t.priority, t.position, t.id
      ${f.limit ? `LIMIT ${Number(f.limit)}` : ''}`;
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => this.hydrate(r));
    }
    updateTicket(id, patch) {
        return this.tx(() => {
            const before = this.requireTicket(id);
            const sets = [];
            const params = [];
            const changes = {};
            for (const [k, v] of Object.entries(patch)) {
                if (v === undefined)
                    continue;
                if (k === 'parent_id' && v != null) {
                    if (Number(v) === id)
                        throw new UserError('A ticket cannot be its own parent');
                    this.requireTicket(Number(v));
                }
                if (k === 'milestone_id' && v != null)
                    this.requireMilestone(Number(v));
                if (before[k] === v)
                    continue;
                sets.push(`${k} = ?`);
                params.push(v);
                changes[k] = { from: before[k], to: v };
            }
            if (!sets.length)
                return before;
            sets.push(`updated_at = ?`);
            params.push(now());
            params.push(id);
            this.db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
            if (changes.assignee)
                this.addEvent(id, 'assign', { from: changes.assignee.from, to: changes.assignee.to });
            if (changes.branch)
                this.addEvent(id, 'branch', { from: changes.branch.from, to: changes.branch.to });
            if (changes.milestone_id)
                this.addEvent(id, 'milestone', { from: changes.milestone_id.from, to: changes.milestone_id.to });
            const other = Object.fromEntries(Object.entries(changes).filter(([k]) => !['assignee', 'branch', 'milestone_id'].includes(k)));
            if (Object.keys(other).length)
                this.addEvent(id, 'edit', other);
            return this.getTicket(id);
        });
    }
    setStatus(id, status, opts = {}) {
        return this.tx(() => {
            const t = this.requireTicket(id);
            if (t.status === status)
                return t;
            if ((status === 'in_progress' || status === 'review') && t.blocked_by.length && !opts.force) {
                throw new UserError(`${fmtTicketId(id)} is blocked by ${t.blocked_by.map(fmtTicketId).join(', ')}. Finish those first or pass --force.`, 'BLOCKED');
            }
            const ts = now();
            const closed = CLOSED_STATUSES.includes(status) ? ts : null;
            this.db.prepare(`UPDATE tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?`).run(status, ts, closed, id);
            this.addEvent(id, 'status', { from: t.status, to: status, ...(opts.note ? { note: opts.note } : {}) });
            if (opts.note)
                this.addEvent(id, 'note', { body: opts.note });
            return this.getTicket(id);
        });
    }
    addNote(id, body) {
        const text = body.trim();
        if (!text)
            throw new UserError('Note body is required');
        this.requireTicket(id);
        this.db.prepare(`UPDATE tickets SET updated_at = ? WHERE id = ?`).run(now(), id);
        this.addEvent(id, 'note', { body: text });
    }
    addLabel(id, label) {
        this.requireTicket(id);
        const r = this.db.prepare(`INSERT OR IGNORE INTO labels (ticket_id, label) VALUES (?, ?)`).run(id, label.trim());
        if (r.changes)
            this.addEvent(id, 'label', { add: label.trim() });
    }
    removeLabel(id, label) {
        const r = this.db.prepare(`DELETE FROM labels WHERE ticket_id = ? AND label = ?`).run(id, label.trim());
        if (r.changes)
            this.addEvent(id, 'label', { remove: label.trim() });
    }
    addDepUnchecked(id, dependsOn) {
        if (id === dependsOn)
            throw new UserError('A ticket cannot depend on itself');
        this.requireTicket(dependsOn);
        if (this.pathExists(dependsOn, id)) {
            throw new UserError(`Adding ${fmtTicketId(id)} -> ${fmtTicketId(dependsOn)} would create a dependency cycle`, 'CYCLE');
        }
        const r = this.db.prepare(`INSERT OR IGNORE INTO deps (ticket_id, depends_on) VALUES (?, ?)`).run(id, dependsOn);
        if (r.changes)
            this.addEvent(id, 'dep', { depends_on: dependsOn });
    }
    addDep(id, dependsOn) {
        this.tx(() => {
            this.requireTicket(id);
            this.addDepUnchecked(id, dependsOn);
        });
    }
    removeDep(id, dependsOn) {
        const r = this.db.prepare(`DELETE FROM deps WHERE ticket_id = ? AND depends_on = ?`).run(id, dependsOn);
        if (r.changes)
            this.addEvent(id, 'dep', { remove: dependsOn });
    }
    /** True if `from` (transitively) depends on `to`. */
    pathExists(from, to) {
        const seen = new Set();
        const stack = [from];
        while (stack.length) {
            const cur = stack.pop();
            if (cur === to)
                return true;
            if (seen.has(cur))
                continue;
            seen.add(cur);
            stack.push(...this.allDeps(cur));
        }
        return false;
    }
    deleteTicket(id) {
        this.tx(() => {
            const t = this.requireTicket(id);
            this.addEvent(null, 'deleted', { id, title: t.title });
            this.db.prepare(`DELETE FROM tickets WHERE id = ?`).run(id);
        });
    }
    /**
     * The best ticket to pick up next: todo, unblocked, unassigned,
     * highest priority first, then earliest milestone, then oldest.
     */
    next(opts = {}) {
        const where = [`t.status = 'todo'`, `t.type != 'epic'`];
        const params = [];
        where.push(`NOT EXISTS (SELECT 1 FROM deps d JOIN tickets b ON b.id = d.depends_on WHERE d.ticket_id = t.id AND b.status NOT IN ('done','cancelled'))`);
        if (opts.assignee) {
            where.push(`(t.assignee IS NULL OR t.assignee = ?)`);
            params.push(opts.assignee);
        }
        else
            where.push(`t.assignee IS NULL`);
        if (opts.milestone !== undefined) {
            where.push(`t.milestone_id = ?`);
            params.push(opts.milestone);
        }
        if (opts.label) {
            where.push(`EXISTS (SELECT 1 FROM labels l WHERE l.ticket_id = t.id AND l.label = ?)`);
            params.push(opts.label);
        }
        const row = this.db
            .prepare(`SELECT t.* FROM tickets t LEFT JOIN milestones m ON m.id = t.milestone_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.priority ASC, (m.due IS NULL) ASC, m.due ASC, m.position ASC, t.position ASC, t.id ASC LIMIT 1`)
            .get(...params);
        return row ? this.hydrate(row) : null;
    }
    findByBranch(branch) {
        const row = this.db.prepare(`SELECT * FROM tickets WHERE branch = ? LIMIT 1`).get(branch);
        return row ? this.hydrate(row) : null;
    }
    counts() {
        const rows = this.db.prepare(`SELECT status, COUNT(*) AS n FROM tickets GROUP BY status`).all();
        const out = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 };
        for (const r of rows)
            out[r.status] = r.n;
        return out;
    }
    // ---------- milestones ----------
    createMilestone(input) {
        const name = input.name.trim();
        if (!name)
            throw new UserError('Milestone name is required');
        const ts = now();
        const r = this.db
            .prepare(`INSERT INTO milestones (name, description, due, position, created_at, updated_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM milestones), ?, ?)`)
            .run(name, input.description ?? '', input.due ?? null, ts, ts);
        return this.getMilestone(Number(r.lastInsertRowid));
    }
    getMilestone(id) {
        return this.db.prepare(`SELECT * FROM milestones WHERE id = ?`).get(id) ?? null;
    }
    requireMilestone(id) {
        const m = this.getMilestone(id);
        if (!m)
            throw new UserError(`Milestone ${fmtMilestoneId(id)} not found`, 'NOT_FOUND');
        return m;
    }
    /** Exact (case-insensitive) name match, else a unique substring match among open milestones first, then all. */
    findMilestoneByName(name) {
        const exact = this.db.prepare(`SELECT * FROM milestones WHERE lower(name) = lower(?) LIMIT 1`).get(name);
        if (exact)
            return exact;
        const like = `%${name.replace(/[%_]/g, (c) => '\\' + c)}%`;
        const open = this.db.prepare(`SELECT * FROM milestones WHERE status = 'open' AND name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY position, id`).all(like);
        if (open.length === 1)
            return open[0];
        if (open.length > 1)
            throw new UserError(`Milestone "${name}" is ambiguous: ${open.map((m) => `${fmtMilestoneId(m.id)} ${m.name}`).join(', ')}`);
        const all = this.db.prepare(`SELECT * FROM milestones WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY position, id`).all(like);
        if (all.length === 1)
            return all[0];
        if (all.length > 1)
            throw new UserError(`Milestone "${name}" is ambiguous: ${all.map((m) => `${fmtMilestoneId(m.id)} ${m.name}`).join(', ')}`);
        return null;
    }
    listMilestones(includeDone = false) {
        const sql = includeDone
            ? `SELECT * FROM milestones ORDER BY status, position, id`
            : `SELECT * FROM milestones WHERE status = 'open' ORDER BY position, id`;
        return this.db.prepare(sql).all();
    }
    updateMilestone(id, patch) {
        this.requireMilestone(id);
        const sets = [];
        const params = [];
        for (const [k, v] of Object.entries(patch)) {
            if (v === undefined)
                continue;
            sets.push(`${k} = ?`);
            params.push(v);
        }
        if (sets.length) {
            sets.push(`updated_at = ?`);
            params.push(now(), id);
            this.db.prepare(`UPDATE milestones SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }
        return this.getMilestone(id);
    }
    deleteMilestone(id) {
        this.requireMilestone(id);
        this.db.prepare(`DELETE FROM milestones WHERE id = ?`).run(id);
    }
    milestoneProgress(id) {
        const rows = this.db
            .prepare(`SELECT status, COUNT(*) AS n FROM tickets WHERE milestone_id = ? AND status != 'cancelled' GROUP BY status`)
            .all(id);
        const p = { total: 0, done: 0, open: 0, in_progress: 0 };
        for (const r of rows) {
            p.total += r.n;
            if (r.status === 'done')
                p.done += r.n;
            else {
                p.open += r.n;
                if (r.status === 'in_progress' || r.status === 'review')
                    p.in_progress += r.n;
            }
        }
        return p;
    }
}
