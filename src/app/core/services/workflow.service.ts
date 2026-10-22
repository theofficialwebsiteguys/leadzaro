import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { Workspace } from '../models/sales.model';
import {
  CreditItem, DraftSummary, ExistingMatch, MyWork, Onboarding, PendingClosing, PersonWork, QualificationResponse, TimerState, WorkSessionItem,
} from '../models/workflow.model';

export interface ChainFilterSettings {
  brands: { key: string; name: string; domains: string[]; aliases: string[]; source: 'default' | 'custom'; enabled: boolean }[];
  allowedPlaces: { googlePlaceId: string; name: string | null; byName: string | null; at: string }[];
  canEditBrands: boolean;
  canAllowPlaces: boolean;
  limits: string;
}
import { tzOffset } from './sales.service';

const API = '/api/v1/sales';

function params(values: Record<string, unknown>): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') p = p.set(key, String(value));
  }
  return p;
}

/** Guided workflow API (ADR 0016). Every call is authorized on the server. */
@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private http = inject(HttpClient);

  /** The caller's open work timer, shared by the sidebar tracker and pages that start one. */
  readonly timer = signal<TimerState | null>(null);
  readonly running = computed(() => this.timer()?.session ?? null);
  /** The lead open on screen, so a timer started now can be linked to it. */
  readonly focusLead = signal<{ id: string; name: string } | null>(null);

  private get<T>(url: string, query: Record<string, unknown> = {}): Observable<T> {
    return this.http.get<{ data: T }>(`${API}${url}`, { params: params(query) }).pipe(map((r) => r.data));
  }

  private send<T>(method: 'post' | 'put' | 'patch', url: string, body: unknown = {}): Observable<T> {
    return this.http.request<{ data: T }>(method.toUpperCase(), `${API}${url}`, { body }).pipe(map((r) => r.data));
  }

  myWork() { return this.get<MyWork>('/my-work', { tzOffset: tzOffset() }).pipe(tap((w) => this.timer.set(w.timer))); }

  // Qualification: a search result is qualified first, and only then created as a lead.
  qualifySetup() { return this.get<{ assignees: { id: string; name: string }[]; reasonOptions: { key: string; label: string; text: string }[] }>('/qualification-setup'); }
  createQualified(body: unknown) { return this.send<QualificationResponse>('post', '/qualification', body); }
  claimResearch(body: { googlePlaceId: string; name: string; takeOver?: boolean }) {
    return this.send<{
      claimed?: boolean; claimedBy?: { id: string; name: string }; since?: string; savedProgress?: boolean; draft?: unknown;
      existing?: ExistingMatch;
    }>('post', '/qualification/claim', body);
  }
  /** Is this business already in Leadzaro? (read-only) */
  checkExisting(body: unknown) { return this.send<{ matches: ExistingMatch[] }>('post', '/qualification/check', body); }
  resolveReview(id: string, body: { action: 'separate' | 'merge' | 'dismiss'; targetOpportunityId?: string; note?: string }) {
    return this.send<{ resolved: string; opportunityId: string }>('post', `/qualification/${id}/review`, body);
  }
  // Saved qualification progress (ADR 0017).
  drafts() { return this.get<{ items: DraftSummary[] }>('/qualification/drafts'); }
  draft(key: string) { return this.get<{ key: string; start: unknown; draft: unknown; savedAt: string }>(`/qualification/drafts/${encodeURIComponent(key)}`); }
  saveDraft(key: string, body: { start: unknown; draft: unknown; takeOver?: boolean }) {
    return this.send<{ saved: boolean; savedAt?: string; claimedBy?: { id: string; name: string }; since?: string }>('put', `/qualification/drafts/${encodeURIComponent(key)}`, body);
  }
  discardDraft(key: string) { return this.http.delete<{ data: unknown }>(`${API}/qualification/drafts/${encodeURIComponent(key)}`).pipe(map((r) => r.data)); }
  // The sales handoff (ADR 0017).
  acceptLead(id: string) { return this.send<Workspace>('post', `/leads/${id}/accept`); }
  addReasonNote(id: string, text: string) { return this.send<Workspace>('post', `/leads/${id}/outreach-reason/notes`, { text }); }
  // Chain filter for searches (ADR 0017).
  chainFilter() { return this.get<ChainFilterSettings>('/chain-filter'); }
  updateChainBrands(body: { action: 'add' | 'remove' | 'disable' | 'enable'; name?: string; domains?: string; key?: string }) { return this.send<ChainFilterSettings>('put', '/chain-filter/brands', body); }
  allowPlace(googlePlaceId: string, name: string) { return this.send<ChainFilterSettings>('post', '/chain-filter/allowed-places', { googlePlaceId, name }); }
  removeAllowedPlace(googlePlaceId: string) { return this.http.delete<{ data: ChainFilterSettings }>(`${API}/chain-filter/allowed-places/${encodeURIComponent(googlePlaceId)}`).pipe(map((r) => r.data)); }
  releaseResearch(placeId: string) { return this.http.delete<{ data: unknown }>(`${API}/qualification/claim/${encodeURIComponent(placeId)}`).pipe(map((r) => r.data)); }
  createDraft(body: unknown) { return this.send<{ opportunityId: string; qualificationStatus: string | null }>('post', '/leads', body); }
  qualification(id: string) { return this.get<QualificationResponse>(`/qualification/${id}`); }
  saveResearch(id: string, body: unknown) { return this.send<QualificationResponse>('put', `/qualification/${id}`, body); }
  setQualificationStatus(id: string, status: string, note: string) { return this.send<QualificationResponse>('put', `/qualification/${id}/status`, { status, note }); }
  completeQualification(id: string, assigneeUserId: string | null) { return this.send<QualificationResponse>('post', `/qualification/${id}/complete`, { assigneeUserId }); }
  findEmail(id: string, force = false) { return this.send<QualificationResponse>('post', `/qualification/${id}/discover-email`, { force }); }
  returnToQualifier(id: string, reason: string) { return this.send<{ returned: boolean }>('post', `/leads/${id}/return-to-qualifier`, { reason }); }

  // Deal steps
  setInterest(id: string, level: string) { return this.send<Workspace>('put', `/leads/${id}/interest`, { level }); }
  saveMeeting(id: string, body: unknown) { return this.send<Workspace>('put', `/leads/${id}/meeting`, body); }
  saveProposal(id: string, body: unknown) { return this.send<Workspace>('put', `/leads/${id}/proposal`, body); }

  // Closing
  submitClosing(id: string, note: string) { return this.send<Workspace>('post', `/leads/${id}/closing/submit`, { note }); }
  pendingClosings() { return this.get<{ items: PendingClosing[]; clientManagers: { id: string; name: string }[] }>('/closings'); }
  approveClosing(id: string, body: { clientManagerUserId: string | null; exceptionReason?: string }) { return this.send<{ closingStatus: string; converted?: boolean; error?: string }>('post', `/leads/${id}/closing/approve`, body); }
  returnClosing(id: string, reason: string) { return this.send<{ closingStatus: string }>('post', `/leads/${id}/closing/return`, { reason }); }

  // Onboarding
  onboarding(id: string) { return this.get<Onboarding>(`/onboarding/${id}`); }
  saveOnboarding(id: string, body: unknown, complete = false) { return this.send<Onboarding>(complete ? 'post' : 'put', complete ? `/onboarding/${id}/complete` : `/onboarding/${id}`, body); }

  // Time
  refreshTimer() { return this.get<TimerState>('/time/current').pipe(tap((t) => this.timer.set(t))); }
  startTimer(workType: string, opportunityId: string | null = null) { return this.send<TimerState>('post', '/time/start', { workType, opportunityId }).pipe(tap((t) => this.timer.set(t))); }
  pauseTimer() { return this.send<TimerState>('post', '/time/pause').pipe(tap((t) => this.timer.set(t))); }
  resumeTimer() { return this.send<TimerState>('post', '/time/resume').pipe(tap((t) => this.timer.set(t))); }
  stopTimer(note: string | null) { return this.send<TimerState>('post', '/time/stop', { note }).pipe(tap((t) => this.timer.set(t))); }
  addManualTime(body: unknown) { return this.send<{ items: WorkSessionItem[]; totalMinutes: number }>('post', '/time/manual', body); }
  timeEntries(query: Record<string, unknown> = {}) { return this.get<{ items: WorkSessionItem[]; totalMinutes: number }>('/time', query); }
  correctTime(id: string, minutes: number, reason: string) { return this.send<WorkSessionItem>('patch', `/time/${id}`, { minutes, reason }); }
  reviewTime(id: string, reviewStatus: string) { return this.send<WorkSessionItem>('post', `/time/${id}/review`, { reviewStatus }); }

  // Team work
  teamWork(query: Record<string, unknown>) { return this.get<{ from: string; to: string; people: PersonWork[] }>('/team-work', query); }
  credits(query: Record<string, unknown>) { return this.get<{ items: CreditItem[]; statuses: string[] }>('/team-work/credits', query); }
  reviewCredits(ids: string[], status: string, note = '') { return this.send<{ updated: string[]; skipped: unknown[] }>('post', '/team-work/credits/review', { ids, status, note }); }
  records(query: Record<string, unknown>) { return this.get<{ items: Record<string, unknown>[] }>('/team-work/records', query); }
}
