export const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'];
export const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'review'];
export const CLOSED_STATUSES = ['done', 'cancelled'];
export const TYPES = ['feature', 'bug', 'chore', 'epic', 'spike'];
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const BRANCH_PREFIX = {
    feature: 'feat',
    bug: 'fix',
    chore: 'chore',
    epic: 'epic',
    spike: 'spike',
};
export class UserError extends Error {
    code;
    constructor(message, code = 'USER_ERROR') {
        super(message);
        this.code = code;
        this.name = 'UserError';
    }
}
