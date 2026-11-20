export const SUPPORT_STATUSES = ['new', 'in_progress', 'waiting_for_user', 'resolved', 'closed'] as const;
export type SupportStatus = typeof SUPPORT_STATUSES[number];
export const SUPPORT_CATEGORIES = ['account', 'playing', 'competition', 'boards', 'notifications', 'other'] as const;
export type SupportCategory = typeof SUPPORT_CATEGORIES[number];
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = typeof SUPPORT_PRIORITIES[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {new: 'Nieuw', in_progress: 'In behandeling', waiting_for_user: 'Wacht op gebruiker', resolved: 'Opgelost', closed: 'Gesloten'};
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {account: 'Account & inloggen', playing: 'Spelen & scores', competition: 'Competities & toernooien', boards: 'Banen & Oche Live', notifications: 'Meldingen', other: 'Overig'};
export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {low: 'Laag', normal: 'Normaal', high: 'Hoog', urgent: 'Dringend'};
export type SupportPerson = {id: string; name: string; username: string | null};
export type SupportTicketPermissions = {canReply: boolean; canClose: boolean; canReopen: boolean; canManage: boolean; canNote: boolean; canAssign: boolean; canSetPriority: boolean; canChangeStatus: boolean; canEditDetails: boolean};
/** revision/updatedAt belong only to visible events on the owner route. */
export type SupportTicketSummary = {
  id: string; number: string; category: SupportCategory; subject: string; status: SupportStatus;
  waitingOn: 'support' | 'user' | 'none'; revision: number; createdAt: string; updatedAt: string;
  permissions: SupportTicketPermissions;
};
export type SupportPublicEvent = {
  id: string; type: 'created' | 'message' | 'status' | 'details'; actorRole: 'user' | 'support' | 'system';
  actorName: string; body: string | null; createdAt: string; fromStatus?: SupportStatus; toStatus?: SupportStatus;
};
export type SupportAdminEvent = {
  id: string; type: SupportPublicEvent['type'] | 'internal_note' | 'assignment' | 'priority';
  visibility: 'public' | 'internal'; actor: SupportPerson | null; body: string | null; createdAt: string;
  changes: Record<string, string | null>;
};
export type SupportTicketManagement = {
  owner: SupportPerson; assignee: SupportPerson | null; priority: SupportPriority; publicRevision: number;
  timeline: SupportAdminEvent[]; staff: SupportPerson[]; allowedStatuses: SupportStatus[];
};
export type SupportTicketDetail = SupportTicketSummary & {timeline: SupportPublicEvent[]; management?: SupportTicketManagement};
export type SupportAdminTicketSummary = SupportTicketSummary & {owner: SupportPerson; assignee: SupportPerson | null; priority: SupportPriority};
export type SupportTicketFilters = {
  q?: string; status?: SupportStatus | 'all' | 'open' | 'unhandled'; category?: SupportCategory | 'all';
  priority?: SupportPriority | 'all'; assignee?: string; limit?: number; offset?: number;
};
export type SupportTicketList = {
  tickets: SupportTicketSummary[]; total: number; limit: number; offset: number; canManageSupport: boolean;
  categories: typeof SUPPORT_CATEGORIES; statuses: typeof SUPPORT_STATUSES;
};
export type SupportAdminTicketList = Omit<SupportTicketList, 'tickets'> & {
  tickets: SupportAdminTicketSummary[]; staff: SupportPerson[]; counts: {open: number; unhandled: number};
};
export type SupportAction =
  | {type: 'ticket.create'; category: SupportCategory; subject: string; body: string}
  | {type: 'ticket.reply'; ticketId: string; body: string}
  | {type: 'ticket.close'; ticketId: string}
  | {type: 'ticket.reopen'; ticketId: string; body?: string}
  | {type: 'ticket.admin.reply'; ticketId: string; body: string; status?: 'waiting_for_user' | 'in_progress' | 'resolved'}
  | {type: 'ticket.admin.note'; ticketId: string; body: string}
  | {type: 'ticket.admin.status'; ticketId: string; status: SupportStatus; reason?: string}
  | {type: 'ticket.admin.update'; ticketId: string; priority?: SupportPriority; assigneeId?: string | null; subject?: string; category?: SupportCategory};
export type SupportCommand = {requestId: string; expectedRevision?: number; action: SupportAction};
export type SupportCommandResult = {ok: true; ticket: SupportTicketDetail; replayed: boolean};
export type SupportNotificationReference = {ticketId: string; ticketNumber: string; recipientView: 'user' | 'support'};
