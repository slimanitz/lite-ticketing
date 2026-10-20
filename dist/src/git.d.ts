export interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}
export declare function git(args: string[], cwd?: string): GitResult;
export declare function isGitRepo(cwd?: string): boolean;
/** Root of the current worktree (may be a linked worktree). */
export declare function worktreeRoot(cwd?: string): string | null;
/** Root of the main worktree, shared by all linked worktrees. */
export declare function mainRoot(cwd?: string): string | null;
export declare function commonGitDir(cwd?: string): string | null;
export declare function currentBranch(cwd?: string): string | null;
export declare function defaultBranch(cwd?: string): string;
export declare function branchExists(name: string, cwd?: string): boolean;
export declare function createBranch(name: string, opts?: {
    checkout?: boolean;
    from?: string;
}, cwd?: string): GitResult;
export declare function addWorktree(dir: string, branch: string, opts?: {
    from?: string;
}, cwd?: string): GitResult;
export declare function isMerged(branch: string, base: string, cwd?: string): boolean;
export declare function listBranches(cwd?: string): string[];
