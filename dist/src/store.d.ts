import type { DatabaseSync } from 'node:sqlite';
import { type EventKind, type EventRow, type ListFilter, type MilestoneProgress, type MilestoneRow, type Status, type Ticket, type TicketRow, type TicketType } from './types.js';
export interface CreateTicketInput {
    title: string;
    description?: string;
    status?: Status;
    priority?: number;
    type?: TicketType;
    parent_id?: number | null;
    milestone_id?: number | null;
    assignee?: string | null;
    branch?: string | null;
    labels?: string[];
    depends_on?: number[];
}
export type UpdateTicketInput = Partial<Pick<TicketRow, 'title' | 'description' | 'priority' | 'type' | 'parent_id' | 'milestone_id' | 'assignee' | 'branch' | 'position'>>;
export interface CreateMilestoneInput {
    name: string;
    description?: string;
    due?: string | null;
}
export type UpdateMilestoneInput = Partial<Pick<MilestoneRow, 'name' | 'description' | 'due' | 'status' | 'position'>>;
export declare class Store {
    readonly db: DatabaseSync;
    actor: string | null;
    constructor(db: DatabaseSync, actor?: string | null);
    private txDepth;
    /** Run fn inside a transaction. Re-entrant: nested calls join the outer transaction. */
    tx<T>(fn: () => T): T;
    addEvent(ticketId: number | null, kind: EventKind, data?: Record<string, unknown>): void;
    events(ticketId?: number, limit?: number): EventRow[];
    notes(ticketId: number): EventRow[];
    createTicket(input: CreateTicketInput): Ticket;
    getTicket(id: number): Ticket | null;
    requireTicket(id: number): Ticket;
    private hydrate;
    /** Ids of dependencies that are not yet done. */
    openBlockers(id: number): number[];
    allDeps(id: number): number[];
    dependents(id: number): number[];
    children(id: number): Ticket[];
    listTickets(f?: ListFilter): Ticket[];
    updateTicket(id: number, patch: UpdateTicketInput): Ticket;
    setStatus(id: number, status: Status, opts?: {
        force?: boolean;
        note?: string;
    }): Ticket;
    addNote(id: number, body: string): void;
    addLabel(id: number, label: string): void;
    removeLabel(id: number, label: string): void;
    private addDepUnchecked;
    addDep(id: number, dependsOn: number): void;
    removeDep(id: number, dependsOn: number): void;
    /** True if `from` (transitively) depends on `to`. */
    private pathExists;
    deleteTicket(id: number): void;
    /**
     * The best ticket to pick up next: todo, unblocked, unassigned,
     * highest priority first, then earliest milestone, then oldest.
     */
    next(opts?: {
        milestone?: number;
        label?: string;
        assignee?: string;
    }): Ticket | null;
    findByBranch(branch: string): Ticket | null;
    counts(): Record<Status, number>;
    createMilestone(input: CreateMilestoneInput): MilestoneRow;
    getMilestone(id: number): MilestoneRow | null;
    requireMilestone(id: number): MilestoneRow;
    /** Exact (case-insensitive) name match, else a unique substring match among open milestones first, then all. */
    findMilestoneByName(name: string): MilestoneRow | null;
    listMilestones(includeDone?: boolean): MilestoneRow[];
    updateMilestone(id: number, patch: UpdateMilestoneInput): MilestoneRow;
    deleteMilestone(id: number): void;
    milestoneProgress(id: number): MilestoneProgress;
}
