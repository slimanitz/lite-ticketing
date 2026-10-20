export type FlagValue = string | boolean | string[];
export interface Parsed {
    positional: string[];
    flags: Record<string, FlagValue>;
}
export interface ArgSpec {
    /** short -> long, e.g. { d: 'desc' } */
    aliases?: Record<string, string>;
    /** flags that never take a value */
    booleans?: string[];
    /** flags that may be repeated and collect into an array */
    multi?: string[];
}
export declare function parseArgs(argv: string[], spec?: ArgSpec): Parsed;
export declare function str(flags: Record<string, FlagValue>, key: string): string | undefined;
export declare function bool(flags: Record<string, FlagValue>, key: string): boolean;
export declare function list(flags: Record<string, FlagValue>, key: string): string[];
