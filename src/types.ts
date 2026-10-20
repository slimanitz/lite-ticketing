export const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ['backlog', 'todo', 'in_progress', 'review'];
export const CLOSED_STATUSES: Status[] = ['done', 'cancelled'];

export const TYPES = ['feature', 'bug', 'chore', 'epic', 'spike'] as const;
export type TicketType = (typeof TYPES)[number];

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type PriorityName = (typeof PRIORITIES)[number];

export const BRANCH_PREFIX: Record<TicketType, string> = {
  feature: 'feat',
  bug: 'fix',
  chore: 'chore',
  epic: 'epic',
  spike: 'spike',
};

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

export type EventKind =
  | 'created'
  | 'status'
  | 'assign'
  | 'branch'
  | 'note'
  | 'edit'
  | 'milestone'
  | 'dep'
  | 'label'
  | 'deleted';

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

export class UserError extends Error {
  constructor(message: string, public readonly code = 'USER_ERROR') {
    super(message);
    this.name = 'UserError';
  }
}
