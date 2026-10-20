import { PRIORITIES, STATUSES, TYPES, UserError } from './types.js';
export function fmtTicketId(id) {
    return `T-${id}`;
}
export function fmtMilestoneId(id) {
    return `M-${id}`;
}
/** Accepts "T-12", "t12", "12", "#12". */
export function parseTicketRef(ref) {
    const m = /^#?(?:t-?)?(\d+)$/i.exec(ref.trim());
    if (!m)
        throw new UserError(`Not a ticket reference: "${ref}" (expected e.g. T-12)`);
    return Number(m[1]);
}
/** Accepts "M-3", "m3", "3". */
export function parseMilestoneRef(ref) {
    const m = /^#?(?:m-?)?(\d+)$/i.exec(ref.trim());
    if (!m)
        throw new UserError(`Not a milestone reference: "${ref}" (expected e.g. M-3)`);
    return Number(m[1]);
}
export function parsePriority(p) {
    if (typeof p === 'number') {
        if (p >= 0 && p < PRIORITIES.length)
            return p;
        throw new UserError(`Priority out of range: ${p}`);
    }
    const s = p.trim().toLowerCase();
    const m = /^p?(\d)$/.exec(s);
    if (m)
        return parsePriority(Number(m[1]));
    const idx = PRIORITIES.indexOf(s);
    if (idx === -1)
        throw new UserError(`Unknown priority "${p}". Use: ${PRIORITIES.join(', ')} (or P0..P3)`);
    return idx;
}
export function priorityName(n) {
    return PRIORITIES[n] ?? 'medium';
}
export function parseStatus(s) {
    const v = s.trim().toLowerCase().replace(/-/g, '_');
    const aliases = {
        wip: 'in_progress',
        progress: 'in_progress',
        doing: 'in_progress',
        started: 'in_progress',
        closed: 'done',
        complete: 'done',
        completed: 'done',
        canceled: 'cancelled',
        cancel: 'cancelled',
        open: 'todo',
        ready: 'todo',
    };
    const st = aliases[v] ?? v;
    if (!STATUSES.includes(st))
        throw new UserError(`Unknown status "${s}". Use: ${STATUSES.join(', ')}`);
    return st;
}
export function parseType(t) {
    const v = t.trim().toLowerCase();
    const aliases = { feat: 'feature', fix: 'bug', task: 'chore', research: 'spike' };
    const ty = aliases[v] ?? v;
    if (!TYPES.includes(ty))
        throw new UserError(`Unknown type "${t}". Use: ${TYPES.join(', ')}`);
    return ty;
}
export function slugify(s, max = 40) {
    const slug = s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (slug.length <= max)
        return slug;
    const cut = slug.slice(0, max);
    const lastDash = cut.lastIndexOf('-');
    return lastDash > 10 ? cut.slice(0, lastDash) : cut;
}
/** Extracts a ticket id from a branch name like feat/t-12-add-login. */
export function ticketIdFromBranch(branch) {
    const m = /(?:^|[\/_-])t-?(\d+)(?:[\/_-]|$)/i.exec(branch);
    return m ? Number(m[1]) : null;
}
