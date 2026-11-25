import {DomainError} from './domain';
import {SUPPORT_STATUSES, type SupportStatus, type SupportTicketPermissions} from './support-types';

const transitions: Record<SupportStatus, SupportStatus[]> = {
  new: ['in_progress', 'waiting_for_user', 'resolved', 'closed'],
  in_progress: ['waiting_for_user', 'resolved', 'closed'],
  waiting_for_user: ['in_progress', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: ['in_progress'],
};
export const supportStatusTransitions = (status: SupportStatus) => [...transitions[status]];
export const supportWaitingOn = (status: SupportStatus): 'support' | 'user' | 'none' => status === 'waiting_for_user' ? 'user' : ['resolved', 'closed'].includes(status) ? 'none' : 'support';
export function assertSupportTransition(from: SupportStatus, to: SupportStatus) {
  if (!SUPPORT_STATUSES.includes(to) || !transitions[from].includes(to)) throw new DomainError('ticket_transition', 'Deze statusovergang is niet toegestaan. Vernieuw het ticket en kies opnieuw.', 409);
}
export function supportPermissions(status: SupportStatus, support: boolean, hasOwner = true): SupportTicketPermissions {
  return {canReply: hasOwner && !['resolved', 'closed'].includes(status), canClose: hasOwner && status !== 'closed', canReopen: hasOwner && ['resolved', 'closed'].includes(status), canManage: support, canNote: support && hasOwner, canAssign: support, canSetPriority: support, canChangeStatus: support && hasOwner, canEditDetails: support && hasOwner};
}
