import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bool, list, parseArgs, str, type FlagValue } from './args.js';
import { DB_DIRNAME, dbExists, openDb, resolveDbPath } from './db.js';
import * as git from './git.js';
import {
  fmtMilestoneId,
  fmtTicketId,
  parseMilestoneRef,
  parsePriority,
  parseStatus,
  parseTicketRef,
  parseType,
  slugify,
  ticketIdFromBranch,
} from './ids.js';
import {
  bold,
  cyan,
  dim,
  eventJson,
  exportJson,
  exportMarkdown,
  green,
  milestoneJson,
  progressBar,
  renderBoard,
  renderEvent,
  renderRoadmap,
  renderTicket,
  renderTicketList,
  table,
  ticketJson,
  yellow,
} from './render.js';
import { Store } from './store.js';
import { BRANCH_PREFIX, PRIORITIES, STATUSES, TYPES, UserError, type ListFilter, type Status, type Ticket } from './types.js';

const VERSION = '0.1.1';

const BOOLEANS = [
  'json', 'help', 'version', 'all', 'blocked', 'force', 'checkout', 'claim', 'dry-run', 'gitignore',
  'tickets', 'project', 'quiet', 'done', 'open', 'unassign', 'mine',
];
const ALIASES: Record<string, string> = {
  d: 'desc', p: 'priority', t: 'type', l: 'label', m: 'message', s: 'status', a: 'assign',
  b: 'branch', n: 'limit', o: 'out', f: 'format', h: 'help', v: 'version', M: 'milestone', j: 'json',
};
const MULTI = ['label', 'unlabel', 'depends-on'];

interface Ctx {
  flags: Record<string, FlagValue>;
  args: string[];
  json: boolean;
  cwd: string;
  dbPath: string;
  actor: string | null;
  _store?: Store;
  store(): Store;
  out: string[];
}

function defaultActor(flags: Record<string, FlagValue>): string | null {
  return str(flags, 'as') ?? process.env.TK_ACTOR ?? (process.env.CLAUDECODE ? 'claude' : process.env.USER ?? null);
}

function emit(ctx: Ctx, json: unknown, text: string | (() => string)): void {
  if (ctx.json) ctx.out.push(JSON.stringify(json, null, 2));
  else ctx.out.push(typeof text === 'function' ? text() : text);
}

function resolveMilestone(store: Store, ref: string): number | null {
  if (ref === 'none' || ref === '') return null;
  try {
    return store.requireMilestone(parseMilestoneRef(ref)).id;
  } catch (e) {
    if (e instanceof UserError && e.code !== 'NOT_FOUND') {
      const m = store.findMilestoneByName(ref);
      if (m) return m.id;
    }
    throw e;
  }
}

function branchNameFor(t: Ticket): string {
  return `${BRANCH_PREFIX[t.type]}/t-${t.id}-${slugify(t.title)}`;
}

function requireArg(ctx: Ctx, i: number, what: string): string {
  const v = ctx.args[i];
  if (v === undefined || v === '') throw new UserError(`Missing ${what}. See: tk --help`);
  return v;
}

// ---------- commands ----------

type Command = (ctx: Ctx) => void | Promise<void>;

const commands: Record<string, Command> = {
  init(ctx) {
    const existed = dbExists(ctx.dbPath);
    openDb(ctx.dbPath).close();
    let ignored = false;
    const root = git.mainRoot(ctx.cwd);
    if (root && ctx.flags.gitignore !== false && path.dirname(ctx.dbPath) === path.join(root, DB_DIRNAME)) {
      const gi = path.join(root, '.gitignore');
      const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
      if (!cur.split('\n').some((l) => l.trim() === `${DB_DIRNAME}/` || l.trim() === DB_DIRNAME)) {
        fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${DB_DIRNAME}/\n`);
        ignored = true;
      }
    }
    emit(ctx, { ok: true, db: ctx.dbPath, created: !existed, gitignore_updated: ignored }, () =>
      [
        existed ? `Database already exists: ${ctx.dbPath}` : `${green('✓')} Created ${ctx.dbPath}`,
        ignored ? `${green('✓')} Added ${DB_DIRNAME}/ to .gitignore` : '',
        '',
        'Next steps:',
        `  tk ms add "v0.1" --due 2026-12-01      ${dim('# a milestone for the roadmap')}`,
        `  tk add "Set up CI" -p high -M v0.1     ${dim('# a ticket')}`,
        `  tk next --claim --checkout             ${dim('# agent picks up work on a branch')}`,
        `  tk skill install                       ${dim('# teach Claude Code the workflow')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  },

  path(ctx) {
    emit(ctx, { db: ctx.dbPath, exists: dbExists(ctx.dbPath) }, ctx.dbPath);
  },

  add(ctx) {
    const store = ctx.store();
    const title = ctx.args.join(' ').trim();
    if (!title) throw new UserError('Usage: tk add "<title>" [-d desc] [-p priority] [-t type] [-M milestone] [--parent T-1] [-l label]');
    const ms = str(ctx.flags, 'milestone');
    const parent = str(ctx.flags, 'parent');
    const parentId = parent ? parseTicketRef(parent) : null;
    // Subtasks inherit the parent's milestone unless one is given explicitly.
    const milestoneId = ms !== undefined ? resolveMilestone(store, ms) : parentId != null ? store.requireTicket(parentId).milestone_id : null;
    const t = store.createTicket({
      title,
      description: str(ctx.flags, 'desc') ?? '',
      priority: str(ctx.flags, 'priority') !== undefined ? parsePriority(str(ctx.flags, 'priority')!) : 2,
      type: str(ctx.flags, 'type') !== undefined ? parseType(str(ctx.flags, 'type')!) : 'feature',
      status: str(ctx.flags, 'status') !== undefined ? parseStatus(str(ctx.flags, 'status')!) : 'todo',
      parent_id: parentId,
      milestone_id: milestoneId,
      assignee: str(ctx.flags, 'assign') ?? null,
      labels: list(ctx.flags, 'label'),
      depends_on: list(ctx.flags, 'depends-on').map(parseTicketRef),
    });
    emit(ctx, ticketJson(t, store), `${green('✓')} Created ${cyan(fmtTicketId(t.id))} ${t.title}`);
  },

  ls(ctx) {
    const store = ctx.store();
    const f: ListFilter = { includeClosed: bool(ctx.flags, 'all') };
    const st = list(ctx.flags, 'status');
    if (st.length) f.status = st.map(parseStatus);
    if (bool(ctx.flags, 'done')) f.status = ['done'];
    const ms = str(ctx.flags, 'milestone');
    if (ms !== undefined) f.milestone = ms === 'none' ? 'none' : (resolveMilestone(store, ms) ?? 'none');
    const parent = str(ctx.flags, 'parent');
    if (parent !== undefined) f.parent = parent === 'none' ? 'none' : parseTicketRef(parent);
    const assignee = str(ctx.flags, 'assignee') ?? (bool(ctx.flags, 'mine') ? ctx.actor ?? undefined : undefined);
    if (assignee !== undefined) f.assignee = assignee === 'none' ? 'none' : assignee;
    const ty = str(ctx.flags, 'type');
    if (ty) f.type = parseType(ty);
    const label = str(ctx.flags, 'label');
    if (label) f.label = label;
    if (bool(ctx.flags, 'blocked')) f.blocked = true;
    const search = str(ctx.flags, 'search') ?? ctx.args.join(' ');
    if (search) f.search = search;
    const limit = str(ctx.flags, 'limit');
    if (limit) f.limit = Number(limit);
    const tickets = store.listTickets(f);
    emit(ctx, tickets.map((t) => ticketJson(t)), () => renderTicketList(tickets, store));
  },

  show(ctx) {
    const store = ctx.store();
    const t = store.requireTicket(parseTicketRef(requireArg(ctx, 0, 'ticket id')));
    emit(
      ctx,
      {
        ...ticketJson(t, store),
        children: store.children(t.id).map((c) => ticketJson(c)),
        notes: store.notes(t.id).map(eventJson),
        events: store.events(t.id, 20).map(eventJson),
      },
      () => renderTicket(t, store),
    );
  },

  edit(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const patch: Parameters<Store['updateTicket']>[1] = {};
    const title = str(ctx.flags, 'title') ?? (ctx.args.length > 1 ? ctx.args.slice(1).join(' ') : undefined);
    if (title !== undefined) patch.title = title;
    const desc = str(ctx.flags, 'desc');
    if (desc !== undefined) patch.description = desc;
    const pri = str(ctx.flags, 'priority');
    if (pri !== undefined) patch.priority = parsePriority(pri);
    const ty = str(ctx.flags, 'type');
    if (ty !== undefined) patch.type = parseType(ty);
    const parent = str(ctx.flags, 'parent');
    if (parent !== undefined) patch.parent_id = parent === 'none' ? null : parseTicketRef(parent);
    const ms = str(ctx.flags, 'milestone');
    if (ms !== undefined) patch.milestone_id = resolveMilestone(store, ms);
    const assign = str(ctx.flags, 'assign');
    if (assign !== undefined) patch.assignee = assign === 'none' ? null : assign;
    if (bool(ctx.flags, 'unassign')) patch.assignee = null;
    const branch = str(ctx.flags, 'branch');
    if (branch !== undefined) patch.branch = branch === 'none' ? null : branch;
    const t = store.tx(() => {
      const u = store.updateTicket(id, patch);
      for (const l of list(ctx.flags, 'label')) store.addLabel(id, l);
      for (const l of list(ctx.flags, 'unlabel')) store.removeLabel(id, l);
      return u.labels.length || list(ctx.flags, 'label').length ? store.getTicket(id)! : u;
    });
    emit(ctx, ticketJson(t, store), `${green('✓')} Updated ${cyan(fmtTicketId(t.id))}`);
  },

  mv(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const status = parseStatus(requireArg(ctx, 1, 'status'));
    const t = store.setStatus(id, status, { force: bool(ctx.flags, 'force'), note: str(ctx.flags, 'message') });
    emit(ctx, ticketJson(t, store), `${green('✓')} ${cyan(fmtTicketId(t.id))} → ${t.status}`);
  },

  start(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    startTicket(ctx, store, id);
  },

  done(ctx) {
    statusShortcut(ctx, 'done');
  },
  review(ctx) {
    statusShortcut(ctx, 'review');
  },
  cancel(ctx) {
    statusShortcut(ctx, 'cancelled');
  },
  todo(ctx) {
    statusShortcut(ctx, 'todo');
  },
  backlog(ctx) {
    statusShortcut(ctx, 'backlog');
  },

  note(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const body = str(ctx.flags, 'message') ?? ctx.args.slice(1).join(' ');
    store.addNote(id, body);
    emit(ctx, { ok: true, ticket: fmtTicketId(id) }, `${green('✓')} Note added to ${cyan(fmtTicketId(id))}`);
  },

  label(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    for (const l of ctx.args.slice(1).flatMap((s) => s.split(','))) store.addLabel(id, l);
    emit(ctx, ticketJson(store.getTicket(id)!), `${green('✓')} Labels: ${store.getTicket(id)!.labels.join(', ')}`);
  },

  unlabel(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    for (const l of ctx.args.slice(1).flatMap((s) => s.split(','))) store.removeLabel(id, l);
    emit(ctx, ticketJson(store.getTicket(id)!), `${green('✓')} Labels: ${store.getTicket(id)!.labels.join(', ') || '(none)'}`);
  },

  dep(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const on = str(ctx.flags, 'on') ?? ctx.args[1];
    if (!on) throw new UserError('Usage: tk dep T-3 --on T-2   (T-3 depends on T-2)');
    for (const ref of on.split(',')) store.addDep(id, parseTicketRef(ref));
    const t = store.getTicket(id)!;
    emit(ctx, ticketJson(t, store), `${green('✓')} ${cyan(fmtTicketId(id))} depends on ${store.allDeps(id).map(fmtTicketId).join(', ')}`);
  },

  undep(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const on = str(ctx.flags, 'on') ?? ctx.args[1];
    if (!on) throw new UserError('Usage: tk undep T-3 --on T-2');
    for (const ref of on.split(',')) store.removeDep(id, parseTicketRef(ref));
    emit(ctx, ticketJson(store.getTicket(id)!, store), `${green('✓')} Dependency removed`);
  },

  next(ctx) {
    const store = ctx.store();
    const ms = str(ctx.flags, 'milestone');
    const t = store.next({
      milestone: ms ? (resolveMilestone(store, ms) ?? undefined) : undefined,
      label: str(ctx.flags, 'label'),
      assignee: ctx.actor ?? undefined,
    });
    if (!t) {
      emit(ctx, null, dim('Nothing to pick up: no unblocked, unassigned todo tickets.'));
      return;
    }
    if (bool(ctx.flags, 'claim') || bool(ctx.flags, 'checkout') || str(ctx.flags, 'worktree') !== undefined) {
      startTicket(ctx, store, t.id);
      return;
    }
    emit(ctx, ticketJson(t, store), () => `${renderTicket(t, store)}\n\n${dim('Pick it up with: tk start ' + fmtTicketId(t.id) + ' --checkout')}`);
  },

  current(ctx) {
    const store = ctx.store();
    const branch = git.currentBranch(ctx.cwd);
    let t: Ticket | null = null;
    if (branch) {
      t = store.findByBranch(branch);
      if (!t) {
        const id = ticketIdFromBranch(branch);
        if (id) t = store.getTicket(id);
      }
    }
    if (!t) {
      emit(ctx, { branch, ticket: null }, dim(`No ticket matches branch ${branch ?? '(detached)'}`));
      return;
    }
    emit(ctx, { branch, ticket: ticketJson(t, store) }, () => renderTicket(t!, store));
  },

  branch(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const t = store.requireTicket(id);
    const name = str(ctx.flags, 'name') ?? t.branch ?? branchNameFor(t);
    const result = ensureBranch(ctx, store, t, name);
    emit(ctx, { ticket: fmtTicketId(t.id), branch: name, ...result }, () =>
      [`${cyan(fmtTicketId(t.id))} → ${bold(name)}`, result.created ? `${green('✓')} branch created` : '', result.checked_out ? `${green('✓')} checked out` : '', result.worktree ? `${green('✓')} worktree at ${result.worktree}` : '']
        .filter(Boolean)
        .join('\n'),
    );
  },

  sync(ctx) {
    const store = ctx.store();
    if (!git.isGitRepo(ctx.cwd)) throw new UserError('Not inside a git repository');
    const base = str(ctx.flags, 'base') ?? git.defaultBranch(ctx.cwd);
    const dry = bool(ctx.flags, 'dry-run');
    const open = store.listTickets({}).filter((t) => t.branch);
    const actions: { ticket: string; branch: string; action: string }[] = [];
    for (const t of open) {
      const b = t.branch!;
      if (!git.branchExists(b, ctx.cwd)) {
        actions.push({ ticket: fmtTicketId(t.id), branch: b, action: 'branch missing locally' });
        continue;
      }
      if (git.isMerged(b, base, ctx.cwd)) {
        if (!dry) store.setStatus(t.id, 'done', { force: true, note: `Branch ${b} merged into ${base} (tk sync)` });
        actions.push({ ticket: fmtTicketId(t.id), branch: b, action: dry ? `would mark done (merged into ${base})` : `marked done (merged into ${base})` });
      } else {
        actions.push({ ticket: fmtTicketId(t.id), branch: b, action: 'open' });
      }
    }
    emit(ctx, { base, dry_run: dry, results: actions }, () =>
      actions.length ? table(['TICKET', 'BRANCH', 'RESULT'], actions.map((a) => [cyan(a.ticket), a.branch, a.action.includes('done') ? green(a.action) : a.action])) : dim('No open tickets with branches.'),
    );
  },

  board(ctx) {
    const store = ctx.store();
    const ms = str(ctx.flags, 'milestone');
    const milestone = ms ? (resolveMilestone(store, ms) ?? undefined) : undefined;
    if (ctx.json) {
      const cols: Record<string, unknown[]> = {};
      for (const s of STATUSES) cols[s] = store.listTickets({ status: [s], milestone }).map((t) => ticketJson(t));
      emit(ctx, { counts: store.counts(), columns: cols }, '');
      return;
    }
    emit(ctx, null, renderBoard(store, { milestone, doneLimit: bool(ctx.flags, 'all') ? 1000 : 8 }));
  },

  roadmap(ctx) {
    const store = ctx.store();
    if (ctx.json) {
      const milestones = store.listMilestones(bool(ctx.flags, 'all')).map((m) => ({
        ...milestoneJson(m, store),
        tickets: store.listTickets({ milestone: m.id, includeClosed: true }).map((t) => ticketJson(t)),
      }));
      emit(ctx, { milestones, unscheduled: store.listTickets({ milestone: 'none' }).map((t) => ticketJson(t)) }, '');
      return;
    }
    emit(ctx, null, renderRoadmap(store, { includeDone: bool(ctx.flags, 'all'), showTickets: ctx.flags.tickets !== false }));
  },

  ms(ctx) {
    const store = ctx.store();
    const sub = ctx.args[0] ?? 'ls';
    const rest = ctx.args.slice(1);
    switch (sub) {
      case 'add':
      case 'new': {
        const name = rest.join(' ').trim();
        if (!name) throw new UserError('Usage: tk ms add "<name>" [--due YYYY-MM-DD] [-d desc]');
        const m = store.createMilestone({ name, description: str(ctx.flags, 'desc') ?? '', due: str(ctx.flags, 'due') ?? null });
        emit(ctx, milestoneJson(m, store), `${green('✓')} Created ${cyan(fmtMilestoneId(m.id))} ${m.name}`);
        return;
      }
      case 'ls':
      case 'list': {
        const ms = store.listMilestones(bool(ctx.flags, 'all'));
        emit(ctx, ms.map((m) => milestoneJson(m, store)), () =>
          table(
            ['ID', 'NAME', 'DUE', 'STATUS', 'PROGRESS'],
            ms.map((m) => {
              const p = store.milestoneProgress(m.id);
              return [cyan(fmtMilestoneId(m.id)), m.name, m.due ?? '', m.status === 'done' ? green('done') : 'open', `${progressBar(p.done, p.total, 12)} ${p.done}/${p.total}`];
            }),
          ),
        );
        return;
      }
      case 'show': {
        const id = resolveMilestone(store, rest[0] ?? '');
        if (id == null) throw new UserError('Usage: tk ms show M-1');
        const m = store.requireMilestone(id);
        const tickets = store.listTickets({ milestone: id, includeClosed: true });
        emit(ctx, { ...milestoneJson(m, store), tickets: tickets.map((t) => ticketJson(t)) }, () => {
          const p = store.milestoneProgress(id);
          return [`${bold(cyan(fmtMilestoneId(m.id)))} ${bold(m.name)}${m.due ? dim(`  due ${m.due}`) : ''}`, `  ${progressBar(p.done, p.total)}  ${p.done}/${p.total}`, m.description ? `  ${m.description}` : '', '', renderTicketList(tickets, store)].filter((l) => l !== '').join('\n');
        });
        return;
      }
      case 'edit': {
        const id = resolveMilestone(store, rest[0] ?? '');
        if (id == null) throw new UserError('Usage: tk ms edit M-1 [--name x] [--due d] [-d desc]');
        const m = store.updateMilestone(id, { name: str(ctx.flags, 'name'), due: str(ctx.flags, 'due') === 'none' ? null : str(ctx.flags, 'due'), description: str(ctx.flags, 'desc') });
        emit(ctx, milestoneJson(m, store), `${green('✓')} Updated ${cyan(fmtMilestoneId(m.id))}`);
        return;
      }
      case 'done':
      case 'close': {
        const id = resolveMilestone(store, rest[0] ?? '');
        if (id == null) throw new UserError('Usage: tk ms done M-1');
        const p = store.milestoneProgress(id);
        if (p.open && !bool(ctx.flags, 'force')) throw new UserError(`${fmtMilestoneId(id)} still has ${p.open} open ticket(s). Pass --force to close anyway.`);
        const m = store.updateMilestone(id, { status: 'done' });
        emit(ctx, milestoneJson(m, store), `${green('✓')} ${cyan(fmtMilestoneId(m.id))} ${m.name} closed`);
        return;
      }
      case 'reopen': {
        const id = resolveMilestone(store, rest[0] ?? '');
        if (id == null) throw new UserError('Usage: tk ms reopen M-1');
        const m = store.updateMilestone(id, { status: 'open' });
        emit(ctx, milestoneJson(m, store), `${green('✓')} ${cyan(fmtMilestoneId(m.id))} reopened`);
        return;
      }
      case 'rm':
      case 'delete': {
        const id = resolveMilestone(store, rest[0] ?? '');
        if (id == null) throw new UserError('Usage: tk ms rm M-1');
        store.deleteMilestone(id);
        emit(ctx, { ok: true, deleted: fmtMilestoneId(id) }, `${green('✓')} Deleted ${fmtMilestoneId(id)} (tickets kept, now unscheduled)`);
        return;
      }
      default:
        throw new UserError(`Unknown milestone subcommand "${sub}". Use: add, ls, show, edit, done, reopen, rm`);
    }
  },

  log(ctx) {
    const store = ctx.store();
    const limit = Number(str(ctx.flags, 'limit') ?? 30);
    const ref = ctx.args[0];
    const events = ref ? store.events(parseTicketRef(ref), limit) : store.events(undefined, limit);
    emit(ctx, events.map(eventJson), () => (events.length ? events.map(renderEvent).join('\n') : dim('(no events)')));
  },

  export(ctx) {
    const store = ctx.store();
    const format = (str(ctx.flags, 'format') ?? (ctx.json ? 'json' : 'md')).toLowerCase();
    let content: string;
    if (format === 'md' || format === 'markdown') content = exportMarkdown(store);
    else if (format === 'json') content = JSON.stringify(exportJson(store), null, 2);
    else throw new UserError(`Unknown format "${format}". Use md or json.`);
    const out = str(ctx.flags, 'out');
    if (out) {
      fs.writeFileSync(path.resolve(ctx.cwd, out), content + (content.endsWith('\n') ? '' : '\n'));
      emit(ctx, { ok: true, file: path.resolve(ctx.cwd, out), format }, `${green('✓')} Wrote ${out}`);
    } else {
      ctx.out.push(content);
    }
  },

  rm(ctx) {
    const store = ctx.store();
    const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
    const t = store.requireTicket(id);
    const kids = store.children(id);
    if (kids.length && !bool(ctx.flags, 'force')) throw new UserError(`${fmtTicketId(id)} has ${kids.length} subtask(s). Pass --force to delete anyway (subtasks are kept, unparented).`);
    store.deleteTicket(id);
    emit(ctx, { ok: true, deleted: fmtTicketId(id), title: t.title }, `${green('✓')} Deleted ${fmtTicketId(id)} "${t.title}"`);
  },

  hook(ctx) {
    const sub = ctx.args[0] ?? 'show';
    const gitDir = git.commonGitDir(ctx.cwd);
    if (!gitDir) throw new UserError('Not inside a git repository');
    const custom = git.git(['config', '--get', 'core.hooksPath'], ctx.cwd);
    const hooksDir = custom.ok && custom.stdout ? path.resolve(git.worktreeRoot(ctx.cwd) ?? ctx.cwd, custom.stdout) : path.join(gitDir, 'hooks');
    const file = path.join(hooksDir, 'prepare-commit-msg');
    const exists = fs.existsSync(file);
    const ours = exists && fs.readFileSync(file, 'utf8').includes(HOOK_MARKER);
    switch (sub) {
      case 'install': {
        if (exists && !ours && !bool(ctx.flags, 'force')) throw new UserError(`A prepare-commit-msg hook already exists at ${file}. Pass --force to overwrite it.`);
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(file, HOOK_SCRIPT, { mode: 0o755 });
        fs.chmodSync(file, 0o755);
        emit(ctx, { ok: true, file }, `${green('✓')} Installed ${file}\nCommits on branches like feat/t-12-login will be prefixed with [T-12].`);
        return;
      }
      case 'uninstall': {
        if (!exists) {
          emit(ctx, { ok: true, removed: false }, 'No hook installed.');
          return;
        }
        if (!ours && !bool(ctx.flags, 'force')) throw new UserError(`The hook at ${file} was not installed by tk. Pass --force to remove it anyway.`);
        fs.unlinkSync(file);
        emit(ctx, { ok: true, removed: true, file }, `${green('✓')} Removed ${file}`);
        return;
      }
      case 'show':
        emit(ctx, { file, installed: ours, other_hook_present: exists && !ours }, ours ? `${green('✓')} tk hook installed at ${file}` : exists ? `${yellow('!')} A different prepare-commit-msg hook exists at ${file}` : `No hook installed. Run: tk hook install`);
        return;
      default:
        throw new UserError(`Unknown hook subcommand "${sub}". Use: install, uninstall, show`);
    }
  },

  skill(ctx) {
    const sub = ctx.args[0] ?? 'show';
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skill', 'SKILL.md');
    const content = fs.readFileSync(src, 'utf8');
    switch (sub) {
      case 'install': {
        const base = str(ctx.flags, 'dir') ?? (bool(ctx.flags, 'project') ? path.join(git.worktreeRoot(ctx.cwd) ?? ctx.cwd, '.claude', 'skills') : path.join(os.homedir(), '.claude', 'skills'));
        const dir = path.join(base, 'lite-ticketing');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
        emit(ctx, { ok: true, file: path.join(dir, 'SKILL.md') }, `${green('✓')} Installed skill to ${path.join(dir, 'SKILL.md')}\nClaude Code will pick it up on the next session. Trigger it with /lite-ticketing or just ask the agent to use the ticket board.`);
        return;
      }
      case 'show':
        ctx.out.push(content);
        return;
      case 'snippet':
        ctx.out.push(AGENTS_SNIPPET);
        return;
      default:
        throw new UserError(`Unknown skill subcommand "${sub}". Use: install [--project|--dir path], show, snippet`);
    }
  },

  help(ctx) {
    ctx.out.push(HELP);
  },
};

const ALIAS_CMDS: Record<string, string> = {
  list: 'ls',
  new: 'add',
  create: 'add',
  view: 'show',
  get: 'show',
  move: 'mv',
  status: 'mv',
  set: 'edit',
  update: 'edit',
  close: 'done',
  finish: 'done',
  comment: 'note',
  milestone: 'ms',
  milestones: 'ms',
  delete: 'rm',
  remove: 'rm',
  history: 'log',
  pick: 'next',
  claim: 'next',
  kanban: 'board',
  wip: 'current',
  whoami: 'current',
};

function statusShortcut(ctx: Ctx, status: Status): void {
  const store = ctx.store();
  const id = parseTicketRef(requireArg(ctx, 0, 'ticket id'));
  const note = str(ctx.flags, 'message') ?? (ctx.args.length > 1 ? ctx.args.slice(1).join(' ') : undefined);
  const t = store.setStatus(id, status, { force: bool(ctx.flags, 'force'), note });
  let hint = '';
  if (status === 'done' && t.parent_id != null) {
    const sibs = store.children(t.parent_id);
    if (sibs.every((s) => s.status === 'done' || s.status === 'cancelled')) hint = `\n${dim(`All subtasks of ${fmtTicketId(t.parent_id)} are done. Close it with: tk done ${fmtTicketId(t.parent_id)}`)}`;
  }
  if (status === 'done') {
    const unblocked = store.dependents(id).map((d) => store.getTicket(d)!).filter((d) => d && d.blocked_by.length === 0 && d.status !== 'done');
    if (unblocked.length) hint += `\n${dim(`Unblocked: ${unblocked.map((u) => fmtTicketId(u.id)).join(', ')}`)}`;
  }
  emit(ctx, ticketJson(t, store), `${green('✓')} ${cyan(fmtTicketId(t.id))} → ${t.status}${hint}`);
}

function ensureBranch(ctx: Ctx, store: Store, t: Ticket, name: string): { created: boolean; checked_out: boolean; worktree: string | null; existed: boolean } {
  const result = { created: false, checked_out: false, worktree: null as string | null, existed: false };
  if (t.branch !== name) store.updateTicket(t.id, { branch: name });
  const wantCheckout = bool(ctx.flags, 'checkout');
  const wt = str(ctx.flags, 'worktree');
  if (!wantCheckout && wt === undefined) return result;
  if (!git.isGitRepo(ctx.cwd)) throw new UserError('Not inside a git repository');
  const from = str(ctx.flags, 'from');
  result.existed = git.branchExists(name, ctx.cwd);
  if (wt !== undefined) {
    const dir = wt === '' ? path.join(git.mainRoot(ctx.cwd) ?? ctx.cwd, '..', `${path.basename(git.mainRoot(ctx.cwd) ?? ctx.cwd)}-${fmtTicketId(t.id).toLowerCase()}`) : path.resolve(ctx.cwd, wt);
    const r = git.addWorktree(dir, name, { from }, ctx.cwd);
    if (!r.ok) throw new UserError(`git worktree add failed: ${r.stderr}`);
    result.worktree = dir;
    result.created = !result.existed;
    result.checked_out = true;
    return result;
  }
  if (result.existed) {
    const r = git.git(['checkout', name], ctx.cwd);
    if (!r.ok) throw new UserError(`git checkout failed: ${r.stderr}`);
  } else {
    const r = git.createBranch(name, { checkout: true, from }, ctx.cwd);
    if (!r.ok) throw new UserError(`git checkout -b failed: ${r.stderr}`);
    result.created = true;
  }
  result.checked_out = true;
  return result;
}

function startTicket(ctx: Ctx, store: Store, id: number): void {
  const before = store.requireTicket(id);
  const assignee = str(ctx.flags, 'assign') ?? ctx.actor;
  const t = store.tx(() => {
    const s = store.setStatus(id, 'in_progress', { force: bool(ctx.flags, 'force') });
    return assignee && s.assignee !== assignee ? store.updateTicket(id, { assignee }) : s;
  });
  const wantBranch = bool(ctx.flags, 'checkout') || str(ctx.flags, 'worktree') !== undefined || ctx.flags.branch !== undefined;
  let branchInfo: ReturnType<typeof ensureBranch> | null = null;
  let name = t.branch;
  if (wantBranch) {
    name = (typeof ctx.flags.branch === 'string' ? ctx.flags.branch : null) ?? t.branch ?? branchNameFor(t);
    branchInfo = ensureBranch(ctx, store, t, name);
  }
  const final = store.getTicket(id)!;
  emit(ctx, { ...ticketJson(final, store), git: branchInfo }, () =>
    [
      `${green('✓')} ${cyan(fmtTicketId(id))} ${before.status} → in_progress${assignee ? dim(` (@${assignee})`) : ''}`,
      name ? `  branch: ${bold(name)}${branchInfo?.checked_out ? green('  (checked out)') : ''}${branchInfo?.worktree ? green(`  worktree: ${branchInfo.worktree}`) : ''}` : '',
      !wantBranch && !name ? dim(`  tip: tk start ${fmtTicketId(id)} --checkout creates and checks out ${branchNameFor(t)}`) : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

const HOOK_MARKER = 'lite-ticketing prepare-commit-msg hook';
const HOOK_SCRIPT = `#!/bin/sh
# ${HOOK_MARKER}
# Prefixes commit messages with the ticket id found in the branch name (e.g. feat/t-12-login -> "[T-12] ...").
MSG_FILE="$1"
SOURCE="$2"
case "$SOURCE" in merge|squash) exit 0 ;; esac
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
ID=$(printf '%s' "$BRANCH" | grep -oiE '(^|[/_-])t-?[0-9]+([/_-]|$)' | head -n1 | grep -oE '[0-9]+')
[ -z "$ID" ] && exit 0
if grep -qiE "\\bT-?$ID\\b" "$MSG_FILE"; then exit 0; fi
TMP=$(mktemp) || exit 0
printf '[T-%s] ' "$ID" | cat - "$MSG_FILE" > "$TMP" && mv "$TMP" "$MSG_FILE"
exit 0
`;

const AGENTS_SNIPPET = `## Task tracking (lite-ticketing)

This repo tracks work with \`tk\` (lite-ticketing), a local SQLite kanban. Run \`tk --help\` for the full reference.

- Before starting work: \`tk board\` to see the state, \`tk next\` to find the best unblocked ticket.
- Pick up a ticket: \`tk start T-12 --checkout\` (sets in_progress, assigns you, creates branch feat/t-12-...).
- While working: \`tk note T-12 "what you did / decided"\`; reference the ticket id in commit messages.
- Found more work? \`tk add "..." --parent T-12\` for subtasks, \`tk dep T-13 --on T-12\` for ordering.
- Finish: \`tk review T-12\` when a PR is open, \`tk done T-12\` when merged (or let \`tk sync\` do it).
- Always use \`--json\` when you need to parse output.
`;

const HELP = `${bold('tk')} — lite-ticketing: a tiny SQLite kanban for coding agents (v${VERSION})

${bold('Setup')}
  tk init [--no-gitignore]            Create .tickets/tickets.db at the repo root
  tk path                             Print the database path
  tk skill install [--project]        Install the Claude Code skill (~/.claude/skills or ./.claude/skills)
  tk skill snippet                    Print a paragraph for AGENTS.md / CLAUDE.md
  tk hook install|uninstall|show      Git hook: prefix commits with [T-n] from the branch name

${bold('Tickets')}
  tk add "<title>" [-d desc] [-p pri] [-t type] [-M milestone] [--parent T-1 (inherits milestone)] [-l label] [--depends-on T-2] [-s status]
  tk ls [--status s,s] [-M milestone|none] [-l label] [--assignee a|none] [--mine] [-t type] [--parent T|none] [--blocked] [--all] [search]
  tk show T-1                         Full detail: deps, subtasks, notes, history
  tk edit T-1 [--title t] [-d desc] [-p pri] [-t type] [-M ms|none] [--parent T|none] [-a assignee|none] [-b branch|none] [-l +label] [--unlabel label]
  tk note T-1 "text"                  Append a note (progress, decisions, blockers)
  tk label T-1 x,y / tk unlabel T-1 x
  tk dep T-3 --on T-2                 T-3 is blocked until T-2 is done
  tk undep T-3 --on T-2
  tk rm T-1 [--force]

${bold('Status')}  (${STATUSES.join(' → ')})
  tk next [--claim] [--checkout] [-M milestone] [-l label]
                                      Best unblocked, unassigned todo ticket; --claim starts it
  tk start T-1 [--checkout|--worktree [dir]] [-b name] [--as actor] [--force]
                                      in_progress + assignee (+ git branch)
  tk review T-1 [-m note]             Ready for review / PR open
  tk done T-1 [-m note]               Done (closes; reports newly unblocked tickets)
  tk cancel T-1 | tk todo T-1 | tk backlog T-1
  tk mv T-1 <status> [--force]        Any transition
  tk current                          The ticket matching the current git branch

${bold('Git')}
  tk branch T-1 [--checkout|--worktree [dir]] [--from base] [--name n]
                                      Branch name = <feat|fix|chore>/t-<id>-<slug>
  tk sync [--base main] [--dry-run]   Mark tickets done when their branch is merged

${bold('Roadmap')}
  tk ms add "<name>" [--due YYYY-MM-DD] [-d desc]
  tk ms ls [--all] | tk ms show M-1 | tk ms edit M-1 [--name n] [--due d|none] [-d desc]
  tk ms done M-1 [--force] | tk ms reopen M-1 | tk ms rm M-1
  tk roadmap [--all] [--no-tickets]   Milestones with progress bars
  tk board [-M milestone] [--all]     Kanban columns
  tk log [T-1] [-n 30]                Event history
  tk export [--format md|json] [-o ROADMAP.md]

${bold('Global flags')}
  --json          Machine-readable output (every command)
  --db <path>     Database file (default: <repo>/.tickets/tickets.db, or $TK_DB)
  --as <actor>    Who is acting (default: $TK_ACTOR, "claude" under Claude Code, else $USER)

${bold('Values')}
  priority: ${PRIORITIES.map((p, i) => `P${i}=${p}`).join(', ')}     type: ${TYPES.join(', ')}
  Ticket refs accept T-12, t12 or 12. Milestones accept M-1 or the milestone name.
`;

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const parsed = parseArgs(argv, { aliases: ALIASES, booleans: BOOLEANS, multi: MULTI });
  const { flags } = parsed;
  const [cmdRaw, ...args] = parsed.positional;
  const json = bool(flags, 'json');
  const out: string[] = [];

  if (bool(flags, 'version')) {
    console.log(VERSION);
    return 0;
  }
  let cmd = cmdRaw ?? 'help';
  cmd = ALIAS_CMDS[cmd] ?? cmd;
  if (bool(flags, 'help') || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return 0;
  }

  const dbPath = resolveDbPath(str(flags, 'db'), cwd);
  const ctx: Ctx = {
    flags,
    args,
    json,
    cwd,
    dbPath,
    actor: defaultActor(flags),
    out,
    store() {
      if (!this._store) {
        if (!dbExists(dbPath) && cmd !== 'init') {
          throw new UserError(`No ticket database at ${dbPath}. Run "tk init" first (or set --db / $TK_DB).`, 'NO_DB');
        }
        this._store = new Store(openDb(dbPath), this.actor);
      }
      return this._store;
    },
  };

  const fn = commands[cmd];
  if (!fn) {
    const msg = `Unknown command "${cmd}". Run tk --help.`;
    if (json) console.log(JSON.stringify({ error: msg, code: 'UNKNOWN_COMMAND' }));
    else console.error(msg);
    return 2;
  }
  try {
    await fn(ctx);
    const text = out.filter((s) => s !== '').join('\n');
    if (text) console.log(text);
    return 0;
  } catch (e) {
    const err = e instanceof UserError ? e : e instanceof Error ? new UserError(e.message, 'ERROR') : new UserError(String(e), 'ERROR');
    if (json) console.log(JSON.stringify({ error: err.message, code: err.code }));
    else console.error(`${yellow('error:')} ${err.message}`);
    return err.code === 'NOT_FOUND' ? 3 : 1;
  } finally {
    ctx._store?.db.close();
  }
}
