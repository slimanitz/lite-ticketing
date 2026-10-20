import { type PriorityName, type Status, type TicketType } from './types.js';
export declare function fmtTicketId(id: number): string;
export declare function fmtMilestoneId(id: number): string;
/** Accepts "T-12", "t12", "12", "#12". */
export declare function parseTicketRef(ref: string): number;
/** Accepts "M-3", "m3", "3". */
export declare function parseMilestoneRef(ref: string): number;
export declare function parsePriority(p: string | number): number;
export declare function priorityName(n: number): PriorityName;
export declare function parseStatus(s: string): Status;
export declare function parseType(t: string): TicketType;
export declare function slugify(s: string, max?: number): string;
/** Extracts a ticket id from a branch name like feat/t-12-add-login. */
export declare function ticketIdFromBranch(branch: string): number | null;
