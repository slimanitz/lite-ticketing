export declare const STATUSES: readonly ["backlog", "todo", "in_progress", "review", "done", "cancelled"];
export type Status = (typeof STATUSES)[number];
export declare const OPEN_STATUSES: Status[];
export declare const CLOSED_STATUSES: Status[];
export declare const TYPES: readonly ["feature", "bug", "chore", "epic", "spike"];
export type TicketType = (typeof TYPES)[number];
export declare const PRIORITIES: readonly ["critical", "high", "medium", "low"];
export type PriorityName = (typeof PRIORITIES)[number];
export declare const BRANCH_PREFIX: Record<TicketType, string>;
export interface TicketRow {
    id: number;
    title: string;
    description: string;
    status: Status;
    priority: number;
    type: TicketType;
    parent_id: number | null;
    milestone_id: number | null;
    assignee: string | null;
    branch: string | null;
    position: number;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
}
export interface Ticket extends TicketRow {
    labels: string[];
    blocked_by: number[];
}
export interface MilestoneRow {
    id: number;
    name: string;
    description: string;
    due: string | null;
    status: 'open' | 'done';
    position: number;
    created_at: string;
    updated_at: string;
}
export interface MilestoneProgress {
    total: number;
    done: number;
    open: number;
    in_progress: number;
}
export interface EventRow {
    id: number;
    ticket_id: number | null;
    at: string;
    actor: string | null;
    kind: EventKind;
    data: string;
}
export type EventKind = 'created' | 'status' | 'assign' | 'branch' | 'note' | 'edit' | 'milestone' | 'dep' | 'label' | 'deleted';
export interface ListFilter {
    status?: Status[];
    milestone?: number | 'none';
    label?: string;
    assignee?: string | 'none';
    type?: TicketType;
    parent?: number | 'none';
    blocked?: boolean;
    search?: string;
    includeClosed?: boolean;
    limit?: number;
}
export declare class UserError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
