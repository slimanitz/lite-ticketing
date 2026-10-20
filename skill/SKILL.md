---
name: lite-ticketing
description: Track coding work on a local SQLite kanban with the `tk` CLI. Use at the start of any coding session in a repo that has a .tickets/ directory, when the user mentions tickets, tasks, kanban, backlog, roadmap or milestones, or when you need to decide what to work on next, record progress, or branch for a task.
---

# lite-ticketing (`tk`)

`tk` is a zero-dependency CLI that keeps a kanban board in `.tickets/tickets.db` at the repo root. The database is shared by every git worktree of the repo, so parallel agents see the same board. Every command accepts `--json` for parsing; prefer it whenever you read output programmatically.

Run `tk --help` for the full reference. If `tk` is not on PATH, use `npx lite-ticketing`.

## Session start

1. `tk board` to see the state of the board, and `tk roadmap` for milestones and progress.
2. `tk current` tells you which ticket the current git branch belongs to. If it returns one, continue that work.
3. Otherwise `tk next --json` returns the best unblocked, unassigned todo ticket (highest priority, earliest milestone). Read its description, parent and notes with `tk show T-<id>` before writing code.

If `tk path` reports no database, ask the user whether to run `tk init` (it creates `.tickets/` and git-ignores it).

## Picking up work

- `tk start T-12 --checkout` marks the ticket in_progress, assigns it to you, and creates and checks out the branch `feat/t-12-<slug>` (prefix is `fix/` for bugs, `chore/` for chores).
- Use `--worktree` instead of `--checkout` when you should work in a separate worktree, which is the right choice when several agents run in parallel: `tk start T-12 --worktree ../repo-t-12`.
- `tk next --claim --checkout` does the picking and starting in one step.
- A ticket that is blocked (`blocked_by` non-empty, shown as ⛔) must not be started. Work on a blocker instead, or ask the user.

## While working

- Record decisions, findings and blockers as you go: `tk note T-12 "Switched to Lucia for sessions; cookie config in src/auth.ts"`. Notes are the memory that survives between sessions and between agents.
- Reference the ticket in commit messages (`[T-12] add login form`). `tk hook install` makes git do this automatically from the branch name.
- Discovered extra work? Do not silently expand scope. Create a ticket for it: `tk add "Rate-limit login" --parent T-12 -p high` for a subtask, or `tk add "..." -s backlog` for later. Use `tk dep T-14 --on T-12` when ordering matters.
- Keep ticket fields honest: `tk edit T-12 -p critical`, `tk edit T-12 -M "v0.2"`, `tk label T-12 needs-design`.

## Finishing

- `tk review T-12 -m "PR #45 opened"` once a pull request is open.
- `tk done T-12 -m "merged"` when the work is merged. The output lists tickets this unblocked; mention them to the user.
- `tk sync` scans every open ticket with a branch and marks it done if the branch is merged into the default branch. Run it when you come back to a repo.
- When all subtasks of an epic are done, close the epic too (`tk done` prints a hint).

## Planning with the user

When the user describes a feature or a plan, turn it into tickets rather than a prose list:

```
tk ms add "v0.2 Payments" --due 2026-12-01
tk add "Stripe checkout" -t epic -M v0.2 -p high
tk add "Checkout API route" --parent T-20 -M v0.2
tk add "Checkout page" --parent T-20 -M v0.2 --depends-on T-21
tk roadmap
```

Show `tk roadmap` or `tk board` afterwards so the user can confirm the plan. `tk export -o ROADMAP.md` writes a markdown roadmap that can be committed.

## Rules of thumb

- One ticket in progress per agent at a time.
- Never mark something done that is not merged or verified; use `review` for "code written, awaiting merge".
- Use `--as <name>` if the user wants work attributed to a specific agent or person. Under Claude Code the default actor is `claude`.
- Statuses: backlog → todo → in_progress → review → done (or cancelled). Priorities: P0 critical, P1 high, P2 medium, P3 low.
