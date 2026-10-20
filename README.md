# lite-ticketing

A tiny kanban board for coding agents, stored in a single SQLite file inside your repo. Tickets, branches, status, dependencies and a milestone roadmap, all driven from the shell with `tk`. Zero dependencies: it uses the `node:sqlite` module built into Node 22.13+.

It exists because agents (Claude Code, Codex, Cursor, Gemini CLI, your own) work better with a structured place to look up what to do next, record what they did, and branch per task. A text file drifts; a database with a tiny API does not.

```
$ tk next --claim --checkout
✓ T-2 todo → in_progress (@claude)
  branch: feat/t-2-user-login  (checked out)

$ tk board
Backlog (0)     │ Todo (3)          │ In progress (1)     │ Review (0)   │ Done (4)
────────────────┼───────────────────┼─────────────────────┼──────────────┼──────────────
                │ T-1 P1            │ T-2 P0              │              │ T-7 P2
                │ Set up CI         │ User login          │              │ Schema v1
                │                   │ @claude feat/t-2-…  │              │
```

## Install

```sh
npm install -g lite-ticketing      # gives you `tk` and `lite-ticketing`
# or run without installing
npx lite-ticketing --help
```

Requires Node 22.13 or newer.

## Quick start

```sh
cd your-repo
tk init                                  # creates .tickets/tickets.db, git-ignores it
tk ms add "v0.1 MVP" --due 2026-12-01    # a milestone
tk add "User login" -p critical -M v0.1 -d "OAuth + sessions"
tk add "Login form" --parent T-1 --depends-on T-1
tk add "Set up CI" -t chore -p high -l infra
tk board
tk roadmap
```

Then let the agent drive:

```sh
tk skill install        # Claude Code skill in ~/.claude/skills/lite-ticketing
tk hook install         # commits on feat/t-12-* get a [T-12] prefix
tk skill snippet >> AGENTS.md
```

## The agent loop

| Step | Command |
| --- | --- |
| What is going on? | `tk board`, `tk roadmap`, `tk current` |
| What should I do next? | `tk next --json` (highest priority, unblocked, unassigned todo) |
| Pick it up on a branch | `tk start T-12 --checkout` or `tk next --claim --checkout` |
| Pick it up in a worktree | `tk start T-12 --worktree ../repo-t-12` |
| Record progress and decisions | `tk note T-12 "chose X because Y"` |
| Found more work | `tk add "..." --parent T-12`, `tk dep T-13 --on T-12` |
| PR open | `tk review T-12` |
| Merged | `tk done T-12`, or `tk sync` to detect merged branches |

Every command takes `--json`, so an agent never has to scrape tables.

## Concepts

- **Ticket** `T-n`: title, description, status, priority (P0 critical to P3 low), type (feature, bug, chore, epic, spike), optional parent (subtasks and epics), milestone, labels, assignee and git branch.
- **Status**: `backlog → todo → in_progress → review → done`, plus `cancelled`. `tk mv` allows any transition; `tk start`, `tk review`, `tk done`, `tk cancel`, `tk todo`, `tk backlog` are shortcuts.
- **Dependencies**: `tk dep T-3 --on T-2` means T-3 is blocked until T-2 is done. Blocked tickets are skipped by `tk next` and refused by `tk start` unless `--force`. Cycles are rejected.
- **Milestone** `M-n`: the roadmap. `tk roadmap` shows progress bars; `tk ms done` refuses to close a milestone with open tickets unless forced.
- **Events**: every change and note is logged with an actor and timestamp. `tk log`, `tk log T-12`, `tk show T-12`.
- **Actor**: `--as name`, else `$TK_ACTOR`, else `claude` when running under Claude Code, else `$USER`.

## Git integration

- **Branch names** are derived from the ticket: `feat/t-12-user-login`, `fix/t-13-null-deref`, `chore/t-14-bump-deps`. `tk branch T-12 [--checkout|--worktree dir] [--from main] [--name custom]`.
- **Worktrees**: the database lives at the main worktree's root, so every linked worktree shares the same board. Run several agents in parallel, one per worktree.
- **Commit hook**: `tk hook install` writes a `prepare-commit-msg` hook that prefixes messages with `[T-12]` based on the branch name. It never touches merge or squash messages.
- **Sync**: `tk sync [--base main] [--dry-run]` marks tickets done when their branch is an ancestor of the base branch.

## Where the data lives

`<repo>/.tickets/tickets.db`, resolved through `git rev-parse --git-common-dir` so worktrees share it. Override with `--db path` or `$TK_DB`. Outside git, the current directory is used.

`tk init` adds `.tickets/` to `.gitignore` because a binary database merges badly. To keep a shareable roadmap in the repo, commit the export instead: `tk export -o ROADMAP.md`. `tk export --format json` dumps everything.

Concurrency: the database runs in WAL mode with a busy timeout, so several agents can write at the same time.

## Library use

```js
import { openDb, resolveDbPath, Store } from 'lite-ticketing';

const store = new Store(openDb(resolveDbPath()), 'my-agent');
const t = store.createTicket({ title: 'Index the docs', priority: 1, labels: ['docs'] });
store.setStatus(t.id, 'in_progress');
console.log(store.next());
```

## Development

```sh
npm install
npm test          # builds with tsc, runs node --test
```

Layout: `src/db.ts` (schema, path resolution), `src/store.ts` (all queries and rules), `src/commands.ts` (CLI), `src/render.ts` (tables, board, roadmap, exports), `src/git.ts` (git helpers), `skill/SKILL.md` (Claude Code skill).

## Roadmap

- [ ] MCP server exposing the same store (`tk mcp`)
- [ ] `tk import` from GitHub issues / Linear
- [ ] Ticket reordering within a column
- [ ] Web view (`tk serve`)

## License

MIT
