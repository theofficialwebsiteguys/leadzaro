import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  BillingSummary, CatalogProduct, Channels, ContactResearch, Conversation, EmailDraft, IntroDraft, Handoff, HandoffData, LeadList, LeadNote, MessageTemplate, PaymentRequest,
  Qualification, QueueItem, RenderedMessage, SalesPayment, SalesReport, StripeClientMatches, StripeCustomer, StripeCustomerLink, StripeStatus, TodayData, UserRef, Workspace,
} from '../models/sales.model';

type Data<T> = Observable<T>;
const API = '/api/v1/sales';

function params(values: Record<string, unknown>): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') p = p.set(key, String(value));
  }
  return p;
}

/** A fresh key for one deliberate action — a retry of the same action reuses it. */
export function actionKey(): string {
  return crypto.randomUUID();
}

export const tzOffset = () => new Date().getTimezoneOffset();

/** Sales workflow API (ADR 0011). Every call is authorized on the server. */
@Injectable({ providedIn: 'root' })
export class SalesService {
  private http = inject(HttpClient);

  private get<T>(url: string, query: Record<string, unknown> = {}): Data<T> {
    return this.http.get<{ data: T }>(`${API}${url}`, { params: params(query) }).pipe(map((r) => r.data));
  }

  private send<T>(method: 'post' | 'put' | 'patch' | 'delete', url: string, body: unknown = {}): Data<T> {
    const full = `${API}${url}`;
    let request: Observable<{ data: T }>;
    if (method === 'delete') request = this.http.delete<{ data: T }>(full);
    else if (method === 'put') request = this.http.put<{ data: T }>(full, body);
    else if (method === 'patch') request = this.http.patch<{ data: T }>(full, body);
    else request = this.http.post<{ data: T }>(full, body);
    return request.pipe(map((r) => r.data));
  }

  // Today & queue
  today(scope: 'mine' | 'team' = 'mine', userId?: string) { return this.get<TodayData>('/today', { scope, userId, tzOffset: tzOffset() }); }
  queue(filters: { reasons?: string[]; stage?: string; scope?: string } = {}) {
    return this.get<{ items: QueueItem[]; reasons: { key: string; label: string }[] }>('/queue', { reasons: filters.reasons?.join(','), stage: filters.stage, scope: filters.scope, tzOffset: tzOffset() });
  }
  goals() { return this.get<{ id: string; userId: string | null; metric: string; target: number }[]>('/goals'); }
  setGoal(metric: string, target: number | null, userId: string | null = null) { return this.send<unknown>('put', '/goals', { metric, target, userId }); }
  team() { return this.get<{ members: UserRef[] }>('/team'); }

  // Leads
  leads(filters: Record<string, unknown>) { return this.get<LeadList>('/leads', { ...filters, tzOffset: tzOffset() }); }
  stageCounts(owner?: string) { return this.get<{ stage: string; label: string; count: number }[]>('/leads/stage-counts', { owner }); }
  createLead(body: unknown) { return this.send<{ opportunityId: string; discovery?: ContactResearch | null }>('post', '/leads', body); }
  resolveSavedLead(savedLeadId: string) { return this.get<{ opportunityId: string }>(`/leads/resolve-saved/${savedLeadId}`); }
  workspace(id: string) { return this.get<Workspace>(`/leads/${id}`); }
  updateQualification(id: string, body: Partial<Qualification>) { return this.send<Workspace>('patch', `/leads/${id}/qualification`, body); }
  updateBusiness(id: string, body: unknown) { return this.send<Workspace>('patch', `/leads/${id}/business`, body); }
  updateDeal(id: string, body: unknown) { return this.send<Workspace>('patch', `/leads/${id}/deal`, body); }
  addContact(id: string, body: unknown) { return this.send<Workspace>('post', `/leads/${id}/contacts`, body); }
  updateContact(id: string, contactId: string, body: unknown) { return this.send<Workspace>('patch', `/leads/${id}/contacts/${contactId}`, body); }
  addNote(id: string, content: string) { return this.send<LeadNote>('post', `/leads/${id}/notes`, { content }); }
  setNextAction(id: string, body: { at: string | null; type?: string; note?: string }) { return this.send<Workspace>('put', `/leads/${id}/next-action`, body); }
  changeStage(id: string, body: { stage: string; lostReason?: string; closeReasonCode?: string; revisitAt?: string; revisitNote?: string }) { return this.send<Workspace>('put', `/leads/${id}/stage`, body); }
  setDoNotContact(id: string, doNotContact: boolean, reason?: string) { return this.send<Workspace>('put', `/leads/${id}/do-not-contact`, { doNotContact, reason }); }
  logOutcome(id: string, body: unknown) { return this.send<Workspace>('post', `/leads/${id}/outcomes`, body); }
  logReply(id: string, body: unknown) { return this.send<Workspace>('post', `/leads/${id}/replies`, body); }
  replyHandled(id: string) { return this.send<Workspace>('post', `/leads/${id}/reply-handled`); }
  assign(id: string, userId: string) { return this.send<Workspace>('post', `/leads/${id}/assign`, { userId }); }
  archive(id: string) { return this.send<Workspace>('post', `/leads/${id}/archive`); }
  restore(id: string) { return this.send<Workspace>('post', `/leads/${id}/restore`); }
  newDeal(id: string, title: string) { return this.send<{ opportunityId: string }>('post', `/leads/${id}/opportunities`, { title }); }

  // Contact research and the introduction email (ADR 0014)
  contactStatus(ids: string[]) { return this.get<Record<string, ContactResearch>>('/leads/contact-status', { ids: ids.join(',') }); }
  discoverEmail(id: string, force = false) { return this.send<ContactResearch>('post', `/leads/${id}/discover-email`, { force }); }
  updateResearch(id: string, body: { email?: string | null; sourceUrl?: string | null; facebookUrl?: string | null; markNoEmail?: boolean; note?: string }) {
    return this.send<ContactResearch>('put', `/leads/${id}/contact-research`, body);
  }
  updateOutreachReason(id: string, body: { reason: string; evidence: string }) { return this.send<{ outreachReason: string | null; outreachEvidence: string | null }>('put', `/leads/${id}/outreach-reason`, body); }
  draftIntro(id: string, contactId: string | null = null) { return this.send<IntroDraft>('post', `/leads/${id}/draft-intro`, { contactId }); }
  saveEmailDraft(id: string, body: { subject?: string; body?: string; to?: string | null; clear?: boolean }) { return this.send<{ emailDraft: EmailDraft | null }>('put', `/leads/${id}/email-draft`, body); }

  // Outreach
  render(id: string | null, body: { templateId?: string; subject?: string | null; body?: string; contactId?: string | null; paymentRequestId?: string | null; channel?: string }) {
    return id ? this.send<RenderedMessage>('post', `/leads/${id}/render`, body) : this.send<RenderedMessage>('post', '/templates/preview', body);
  }
  sendMessage(id: string, body: unknown) { return this.send<{ activity: { id: string; status: string }; duplicate: boolean }>('post', `/leads/${id}/send`, body); }
  startCall(id: string, body: unknown) { return this.send<{ activity: { id: string; status: string } }>('post', `/leads/${id}/calls`, body); }
  completeCall(id: string, activityId: string, body: unknown) { return this.send<Workspace>('post', `/leads/${id}/calls/${activityId}/outcome`, body); }
  conversations(filters: Record<string, unknown>) { return this.get<{ items: Conversation[]; total: number }>('/conversations', filters); }
  channels() { return this.get<Channels>('/channels'); }
  setMyPhone(phone: string) { return this.send<Channels>('put', '/me/phone', { phone }); }
  templates(filters: Record<string, unknown> = {}) { return this.get<MessageTemplate[]>('/templates', filters); }
  placeholders() { return this.get<Record<string, string>>('/templates/placeholders'); }
  createTemplate(body: unknown) { return this.send<MessageTemplate>('post', '/templates', body); }
  updateTemplate(id: string, body: unknown) { return this.send<MessageTemplate>('patch', `/templates/${id}`, body); }
  copyTemplate(id: string) { return this.send<MessageTemplate>('post', `/templates/${id}/copy`); }

  // Payments
  paymentRequests(id: string) { return this.get<PaymentRequest[]>(`/leads/${id}/payment-requests`); }
  createPaymentRequest(id: string, body: unknown) { return this.send<PaymentRequest>('post', `/leads/${id}/payment-requests`, body); }
  markSent(requestId: string, via: string) { return this.send<PaymentRequest>('post', `/payment-requests/${requestId}/sent`, { via }); }
  deactivate(requestId: string) { return this.send<PaymentRequest>('post', `/payment-requests/${requestId}/deactivate`); }
  regenerate(requestId: string) { return this.send<PaymentRequest>('post', `/payment-requests/${requestId}/regenerate`, { idempotencyKey: actionKey() }); }
  refreshRequest(requestId: string) { return this.send<{ request: PaymentRequest; result: unknown }>('post', `/payment-requests/${requestId}/refresh`); }
  simulatePayment(requestId: string) { return this.send<{ request: PaymentRequest }>('post', `/payment-requests/${requestId}/simulate-payment`); }
  recordManualPayment(id: string, body: unknown) { return this.send<{ payment: SalesPayment; converted: boolean }>('post', `/leads/${id}/manual-payments`, body); }

  // Handoff
  handoff(id: string) { return this.get<Handoff | null>(`/leads/${id}/handoff`); }
  saveHandoff(id: string, body: Partial<HandoffData>) { return this.send<Handoff>('put', `/leads/${id}/handoff`, body); }
  completeHandoff(id: string, body: Partial<HandoffData>) { return this.send<Handoff>('post', `/leads/${id}/handoff/complete`, body); }
  retryHandoff(id: string) { return this.send<Handoff>('post', `/leads/${id}/handoff/retry`); }

  // Stripe
  stripeStatus() { return this.get<StripeStatus>('/stripe/status'); }
  catalog(refresh = false) { return refresh ? this.send<CatalogProduct[]>('post', '/stripe/catalog/refresh') : this.get<CatalogProduct[]>('/stripe/catalog'); }
  searchCustomers(q: string) { return this.get<StripeCustomer[]>('/stripe/customers', { q }); }
  /** Suggested Stripe customers for every unlinked client (ADR 0013) — reviewed, never linked automatically. */
  clientMatches(refresh = false) { return this.get<StripeClientMatches>('/stripe/client-matches', { refresh: refresh ? 1 : undefined }); }
  customerLink(organizationId: string) { return this.get<StripeCustomerLink>(`/businesses/${organizationId}/stripe`); }
  suggestCustomers(organizationId: string) { return this.get<StripeCustomer[]>(`/businesses/${organizationId}/stripe/suggestions`); }
  linkCustomer(organizationId: string, stripeCustomerId: string) { return this.send<StripeCustomerLink>('post', `/businesses/${organizationId}/stripe/link`, { stripeCustomerId }); }
  unlinkCustomer(organizationId: string) { return this.send<StripeCustomerLink>('delete', `/businesses/${organizationId}/stripe/link`); }
  createCustomer(organizationId: string, body: unknown) { return this.send<StripeCustomerLink>('post', `/businesses/${organizationId}/stripe/customer`, body); }
  updateCustomer(organizationId: string, body: unknown) { return this.send<StripeCustomerLink>('patch', `/businesses/${organizationId}/stripe/customer`, body); }
  billing(organizationId: string, live = false) { return this.get<BillingSummary>(`/businesses/${organizationId}/billing`, { live: live ? 1 : undefined }); }

  // Reports
  report(filters: Record<string, unknown>) { return this.get<SalesReport>('/reports', { ...filters, tzOffset: tzOffset() }); }
}

