import { DatabaseSync } from 'node:sqlite';
export declare const DB_DIRNAME = ".tickets";
export declare const DB_FILENAME = "tickets.db";
export declare const SCHEMA_VERSION = 1;
/**
 * Resolve where the database lives:
 *  1. explicit path argument
 *  2. $TK_DB
 *  3. <main git worktree root>/.tickets/tickets.db  (shared by all worktrees)
 *  4. <cwd>/.tickets/tickets.db
 */
export declare function resolveDbPath(explicit?: string, cwd?: string): string;
export declare function dbExists(dbPath: string): boolean;
export declare function openDb(dbPath: string, opts?: {
    create?: boolean;
}): DatabaseSync;
export declare function now(): string;
