import { spawnSync } from 'node:child_process';
import path from 'node:path';
export function git(args, cwd = process.cwd()) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.error)
        return { ok: false, stdout: '', stderr: String(r.error.message) };
    return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}
export function isGitRepo(cwd = process.cwd()) {
    return git(['rev-parse', '--is-inside-work-tree'], cwd).ok;
}
/** Root of the current worktree (may be a linked worktree). */
export function worktreeRoot(cwd = process.cwd()) {
    const r = git(['rev-parse', '--show-toplevel'], cwd);
    return r.ok ? r.stdout : null;
}
/** Root of the main worktree, shared by all linked worktrees. */
export function mainRoot(cwd = process.cwd()) {
    const r = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    if (!r.ok) {
        const r2 = git(['rev-parse', '--git-common-dir'], cwd);
        if (!r2.ok)
            return null;
        const wt = worktreeRoot(cwd) ?? cwd;
        return path.dirname(path.resolve(wt, r2.stdout));
    }
    return path.dirname(r.stdout);
}
export function commonGitDir(cwd = process.cwd()) {
    const r = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    return r.ok ? r.stdout : null;
}
export function currentBranch(cwd = process.cwd()) {
    const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return r.ok && r.stdout !== 'HEAD' ? r.stdout : null;
}
export function defaultBranch(cwd = process.cwd()) {
    const r = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
    if (r.ok)
        return r.stdout.replace(/^origin\//, '');
    for (const cand of ['main', 'master', 'develop']) {
        if (branchExists(cand, cwd))
            return cand;
    }
    return 'main';
}
export function branchExists(name, cwd = process.cwd()) {
    return git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], cwd).ok;
}
export function createBranch(name, opts = {}, cwd = process.cwd()) {
    if (opts.checkout) {
        const args = ['checkout', '-b', name];
        if (opts.from)
            args.push(opts.from);
        return git(args, cwd);
    }
    const args = ['branch', name];
    if (opts.from)
        args.push(opts.from);
    return git(args, cwd);
}
export function addWorktree(dir, branch, opts = {}, cwd = process.cwd()) {
    const exists = branchExists(branch, cwd);
    const args = exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir];
    if (!exists && opts.from)
        args.push(opts.from);
    return git(args, cwd);
}
export function isMerged(branch, base, cwd = process.cwd()) {
    if (!branchExists(branch, cwd))
        return false;
    const r = git(['merge-base', '--is-ancestor', branch, base], cwd);
    return r.ok;
}
export function listBranches(cwd = process.cwd()) {
    const r = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], cwd);
    return r.ok && r.stdout ? r.stdout.split('\n') : [];
}
