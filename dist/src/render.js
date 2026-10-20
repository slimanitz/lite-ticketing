import { fmtMilestoneId, fmtTicketId, priorityName } from './ids.js';
import { STATUSES } from './types.js';
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s) => c('1', s);
export const dim = (s) => c('2', s);
export const green = (s) => c('32', s);
export const yellow = (s) => c('33', s);
export const red = (s) => c('31', s);
export const cyan = (s) => c('36', s);
export const magenta = (s) => c('35', s);
export const STATUS_GLYPH = {
    backlog: '·',
    todo: '○',
    in_progress: '◐',
    review: '◑',
    done: '●',
    cancelled: '✕',
};
export const STATUS_LABEL = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In progress',
    review: 'Review',
    done: 'Done',
    cancelled: 'Cancelled',
};
export function colorStatus(s) {
    const label = `${STATUS_GLYPH[s]} ${s}`;
    switch (s) {
        case 'in_progress':
            return yellow(label);
        case 'review':
            return magenta(label);
        case 'done':
            return green(label);
        case 'cancelled':
            return dim(label);
        case 'backlog':
            return dim(label);
        default:
            return label;
    }
}
export function colorPriority(p) {
    const label = `P${p}`;
    if (p === 0)
        return red(bold(label));
    if (p === 1)
        return yellow(label);
    if (p === 3)
        return dim(label);
    return label;
}
export function truncate(s, n) {
    if (n <= 1)
        return s.slice(0, n);
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const WIDE = /[\u{1F300}-\u{1FAFF}\u{2705}\u{26D4}\u{231A}\u{231B}\u{23E9}-\u{23F3}]/u;
export function visibleLength(s) {
    return [...s.replace(ANSI, '')].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
}
function padEnd(s, n) {
    const len = visibleLength(s);
    return len >= n ? s : s + ' '.repeat(n - len);
}
export function table(headers, rows) {
    if (!rows.length)
        return dim('(none)');
    const widths = headers.map((h, i) => Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ''))));
    const line = (cells) => cells.map((cell, i) => padEnd(cell, widths[i])).join('  ').trimEnd();
    return [bold(line(headers)), ...rows.map(line)].join('\n');
}
export function termWidth() {
    return process.stdout.columns && process.stdout.columns > 40 ? process.stdout.columns : 100;
}
export function ticketJson(t, store) {
    return {
        id: fmtTicketId(t.id),
        title: t.title,
        description: t.description,
        status: t.status,
        priority: priorityName(t.priority),
        priority_level: t.priority,
        type: t.type,
        parent: t.parent_id != null ? fmtTicketId(t.parent_id) : null,
        milestone: t.milestone_id != null ? fmtMilestoneId(t.milestone_id) : null,
        assignee: t.assignee,
        branch: t.branch,
        labels: t.labels,
        blocked: t.blocked_by.length > 0,
        blocked_by: t.blocked_by.map(fmtTicketId),
        ...(store ? { depends_on: store.allDeps(t.id).map(fmtTicketId), blocks: store.dependents(t.id).map(fmtTicketId) } : {}),
        created_at: t.created_at,
        updated_at: t.updated_at,
        closed_at: t.closed_at,
    };
}
export function milestoneJson(m, store) {
    const p = store.milestoneProgress(m.id);
    return {
        id: fmtMilestoneId(m.id),
        name: m.name,
        description: m.description,
        due: m.due,
        status: m.status,
        progress: { ...p, percent: p.total ? Math.round((p.done / p.total) * 100) : 0 },
        created_at: m.created_at,
        updated_at: m.updated_at,
    };
}
export function eventJson(e) {
    return {
        id: e.id,
        ticket: e.ticket_id != null ? fmtTicketId(e.ticket_id) : null,
        at: e.at,
        actor: e.actor,
        kind: e.kind,
        data: safeJson(e.data),
    };
}
function safeJson(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return s;
    }
}
export function renderTicketList(tickets, store) {
    const msNames = new Map(store.listMilestones(true).map((m) => [m.id, m.name]));
    const rows = tickets.map((t) => [
        cyan(fmtTicketId(t.id)),
        colorPriority(t.priority),
        colorStatus(t.status),
        t.type,
        truncate(t.title, 60) + (t.blocked_by.length ? red(' ⛔') : ''),
        t.milestone_id != null ? truncate(msNames.get(t.milestone_id) ?? fmtMilestoneId(t.milestone_id), 16) : '',
        t.assignee ?? '',
        t.branch ? dim(truncate(t.branch, 30)) : '',
    ]);
    return table(['ID', 'PRI', 'STATUS', 'TYPE', 'TITLE', 'MILESTONE', 'ASSIGNEE', 'BRANCH'], rows);
}
export function renderTicket(t, store) {
    const lines = [];
    lines.push(`${bold(cyan(fmtTicketId(t.id)))} ${bold(t.title)}`);
    const ms = t.milestone_id != null ? store.getMilestone(t.milestone_id) : null;
    const parent = t.parent_id != null ? store.getTicket(t.parent_id) : null;
    const kv = [
        ['Status', colorStatus(t.status) + (t.blocked_by.length ? red(`  (blocked by ${t.blocked_by.map(fmtTicketId).join(', ')})`) : '')],
        ['Priority', `${colorPriority(t.priority)} ${priorityName(t.priority)}`],
        ['Type', t.type],
    ];
    if (parent)
        kv.push(['Parent', `${fmtTicketId(parent.id)} ${parent.title}`]);
    if (ms)
        kv.push(['Milestone', `${fmtMilestoneId(ms.id)} ${ms.name}${ms.due ? ` (due ${ms.due})` : ''}`]);
    if (t.assignee)
        kv.push(['Assignee', t.assignee]);
    if (t.branch)
        kv.push(['Branch', t.branch]);
    if (t.labels.length)
        kv.push(['Labels', t.labels.join(', ')]);
    const deps = store.allDeps(t.id);
    if (deps.length)
        kv.push(['Depends on', deps.map((d) => `${fmtTicketId(d)}${t.blocked_by.includes(d) ? red('*') : green('✓')}`).join(', ')]);
    const blocks = store.dependents(t.id);
    if (blocks.length)
        kv.push(['Blocks', blocks.map(fmtTicketId).join(', ')]);
    kv.push(['Created', `${t.created_at.slice(0, 16).replace('T', ' ')}`]);
    kv.push(['Updated', `${t.updated_at.slice(0, 16).replace('T', ' ')}`]);
    if (t.closed_at)
        kv.push(['Closed', `${t.closed_at.slice(0, 16).replace('T', ' ')}`]);
    const w = Math.max(...kv.map(([k]) => k.length));
    for (const [k, v] of kv)
        lines.push(`  ${dim(k.padEnd(w))}  ${v}`);
    if (t.description) {
        lines.push('');
        lines.push(t.description.split('\n').map((l) => `  ${l}`).join('\n'));
    }
    const children = store.children(t.id);
    if (children.length) {
        lines.push('');
        lines.push(bold('  Subtasks'));
        for (const ch of children)
            lines.push(`    ${STATUS_GLYPH[ch.status]} ${cyan(fmtTicketId(ch.id))} ${truncate(ch.title, 60)}${ch.assignee ? dim(` @${ch.assignee}`) : ''}`);
    }
    const notes = store.notes(t.id);
    if (notes.length) {
        lines.push('');
        lines.push(bold('  Notes'));
        for (const n of notes) {
            const d = safeJson(n.data);
            lines.push(`    ${dim(n.at.slice(0, 16).replace('T', ' '))} ${n.actor ? dim(`@${n.actor}`) : ''}`);
            for (const l of (d.body ?? '').split('\n'))
                lines.push(`      ${l}`);
        }
    }
    return lines.join('\n');
}
export function renderEvent(e) {
    const d = safeJson(e.data);
    const who = e.actor ? `@${e.actor}` : '';
    const id = e.ticket_id != null ? cyan(fmtTicketId(e.ticket_id)) : dim('—');
    let what;
    switch (e.kind) {
        case 'created':
            what = `created "${d.title}"`;
            break;
        case 'status':
            what = `${d.from} → ${d.to}`;
            break;
        case 'assign':
            what = d.to ? `assigned to ${d.to}` : `unassigned (was ${d.from})`;
            break;
        case 'branch':
            what = `branch ${d.to ?? '(none)'}`;
            break;
        case 'note':
            what = `note: ${truncate(String(d.body ?? ''), 70)}`;
            break;
        case 'milestone':
            what = `milestone → ${d.to != null ? fmtMilestoneId(Number(d.to)) : 'none'}`;
            break;
        case 'dep':
            what = d.remove != null ? `no longer depends on ${fmtTicketId(Number(d.remove))}` : `depends on ${fmtTicketId(Number(d.depends_on))}`;
            break;
        case 'label':
            what = d.add ? `+${d.add}` : `-${d.remove}`;
            break;
        case 'deleted':
            what = `deleted ${fmtTicketId(Number(d.id))} "${d.title}"`;
            break;
        default:
            what = `${e.kind} ${JSON.stringify(d)}`;
    }
    return `${dim(e.at.slice(0, 16).replace('T', ' '))}  ${id}  ${what} ${dim(who)}`;
}
export function renderBoard(store, opts = {}) {
    const cols = ['backlog', 'todo', 'in_progress', 'review', 'done'];
    const width = termWidth();
    const colW = Math.max(14, Math.floor((width - (cols.length - 1) * 3) / cols.length));
    const filter = opts.milestone !== undefined ? { milestone: opts.milestone } : {};
    const byStatus = new Map();
    for (const s of cols) {
        const list = store.listTickets({ ...filter, status: [s] });
        byStatus.set(s, s === 'done' ? list.slice(0, opts.doneLimit ?? 8) : list);
    }
    const counts = store.counts();
    const header = cols.map((s) => padEnd(bold(`${STATUS_LABEL[s]} (${counts[s]})`), colW));
    const rule = cols.map(() => '─'.repeat(colW));
    const cells = cols.map((s) => {
        const out = [];
        for (const t of byStatus.get(s) ?? []) {
            const tag = `${fmtTicketId(t.id)} ${colorPriority(t.priority)}${t.blocked_by.length ? red('⛔') : ''}`;
            out.push(padEnd(cyan(fmtTicketId(t.id)) + tag.slice(fmtTicketId(t.id).length), colW));
            out.push(padEnd(truncate(t.title, colW - 1), colW));
            if (t.assignee || t.branch)
                out.push(padEnd(dim(truncate((t.assignee ? `@${t.assignee} ` : '') + (t.branch ?? ''), colW - 1)), colW));
            out.push(padEnd('', colW));
        }
        return out;
    });
    const height = Math.max(...cells.map((col) => col.length));
    const lines = [header.join(' │ '), rule.join('─┼─')];
    for (let r = 0; r < height; r++)
        lines.push(cells.map((col) => col[r] ?? ' '.repeat(colW)).join(' │ ').trimEnd());
    return lines.join('\n');
}
export function progressBar(done, total, width = 20) {
    const pct = total ? done / total : 0;
    const filled = Math.round(pct * width);
    return `${green('█'.repeat(filled))}${dim('░'.repeat(width - filled))} ${String(Math.round(pct * 100)).padStart(3)}%`;
}
export function renderRoadmap(store, opts = {}) {
    const lines = [];
    const milestones = store.listMilestones(opts.includeDone ?? false);
    for (const m of milestones) {
        const p = store.milestoneProgress(m.id);
        const head = `${bold(cyan(fmtMilestoneId(m.id)))} ${bold(m.name)}${m.due ? dim(`  due ${m.due}`) : ''}${m.status === 'done' ? green('  ✓ done') : ''}`;
        lines.push(head);
        lines.push(`  ${progressBar(p.done, p.total)}  ${p.done}/${p.total} done${p.in_progress ? `, ${p.in_progress} in progress` : ''}`);
        if (m.description)
            lines.push(`  ${dim(m.description.split('\n')[0] ?? '')}`);
        if (opts.showTickets !== false) {
            const ts = store.listTickets({ milestone: m.id, includeClosed: true });
            for (const t of ts) {
                if (t.status === 'cancelled')
                    continue;
                lines.push(`    ${STATUS_GLYPH[t.status]} ${cyan(fmtTicketId(t.id))} ${colorPriority(t.priority)} ${truncate(t.title, 60)}${t.assignee ? dim(` @${t.assignee}`) : ''}${t.blocked_by.length ? red(' ⛔') : ''}`);
            }
        }
        lines.push('');
    }
    const loose = store.listTickets({ milestone: 'none' });
    if (loose.length) {
        lines.push(bold('No milestone'));
        for (const t of loose)
            lines.push(`    ${STATUS_GLYPH[t.status]} ${cyan(fmtTicketId(t.id))} ${colorPriority(t.priority)} ${truncate(t.title, 60)}${t.assignee ? dim(` @${t.assignee}`) : ''}`);
    }
    if (!lines.length)
        return dim('No milestones yet. Create one with: tk ms add "v1.0" --due 2026-12-01');
    return lines.join('\n').trimEnd();
}
export function exportMarkdown(store) {
    const out = ['# Roadmap', '', `_Generated by lite-ticketing on ${new Date().toISOString().slice(0, 10)}_`, ''];
    const box = (t) => (t.status === 'done' ? '[x]' : '[ ]');
    const line = (t, indent = '') => `${indent}- ${box(t)} **${fmtTicketId(t.id)}** ${t.title} _(${t.status}, ${priorityName(t.priority)}${t.assignee ? `, @${t.assignee}` : ''}${t.branch ? `, \`${t.branch}\`` : ''})_`;
    const tree = (tickets) => {
        const res = [];
        const top = tickets.filter((t) => t.parent_id == null || !tickets.some((p) => p.id === t.parent_id));
        const emit = (t, indent) => {
            res.push(line(t, indent));
            for (const ch of tickets.filter((x) => x.parent_id === t.id))
                emit(ch, indent + '  ');
        };
        for (const t of top)
            emit(t, '');
        return res;
    };
    for (const m of store.listMilestones(true)) {
        const p = store.milestoneProgress(m.id);
        out.push(`## ${fmtMilestoneId(m.id)} ${m.name}${m.due ? ` — due ${m.due}` : ''}${m.status === 'done' ? ' ✅' : ''}`);
        out.push('');
        out.push(`${p.done}/${p.total} done (${p.total ? Math.round((p.done / p.total) * 100) : 0}%)`);
        if (m.description)
            out.push('', m.description);
        out.push('');
        const ts = store.listTickets({ milestone: m.id, includeClosed: true }).filter((t) => t.status !== 'cancelled');
        out.push(...tree(ts));
        out.push('');
    }
    const loose = store.listTickets({ milestone: 'none', includeClosed: true }).filter((t) => t.status !== 'cancelled');
    if (loose.length) {
        out.push('## Unscheduled', '');
        out.push(...tree(loose));
        out.push('');
    }
    return out.join('\n');
}
export function exportJson(store) {
    return {
        exported_at: new Date().toISOString(),
        milestones: store.listMilestones(true).map((m) => milestoneJson(m, store)),
        tickets: store.listTickets({ includeClosed: true }).map((t) => ticketJson(t, store)),
    };
}
export const ALL_STATUSES = STATUSES;
