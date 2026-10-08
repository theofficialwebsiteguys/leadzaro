import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ClientDomainsView, ConnectionStatus, ConnectionSummary, ConnectionTestResult, CreateFromDomainInput, CredentialsInput,
  DomainManualInput, DomainMatch, DomainBrief, Expense, ExpenseInput, HostingPlanInput, HostingPlanView, LookupResult,
  RenewalWindow, RenewalsResponse, ReviewQueue, InventoryFilter, InventoryResponse, DomainDetail,
} from '../models/domain.model';

type ApiResponse<T> = { data: T; message?: string };

/** Domains & Hosting, the review queue, renewals, and the admin-only Namecheap connection (ADR 0009). */
@Injectable({ providedIn: 'root' })
export class DomainService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/domains';
  private readonly integrations = '/api/v1/integrations/namecheap';

  // ─── Connection (administrators) ─────────────────────────────────────
  getConnectionStatus(): Observable<ApiResponse<{ connection: ConnectionStatus }>> {
    return this.http.get<ApiResponse<{ connection: ConnectionStatus }>>(this.integrations);
  }

  saveCredentials(input: CredentialsInput): Observable<ApiResponse<{ connection: ConnectionStatus; test: ConnectionTestResult }>> {
    return this.http.put<ApiResponse<{ connection: ConnectionStatus; test: ConnectionTestResult }>>(this.integrations, input);
  }

  testConnection(): Observable<ApiResponse<{ connection: ConnectionStatus; test: ConnectionTestResult }>> {
    return this.http.post<ApiResponse<{ connection: ConnectionStatus; test: ConnectionTestResult }>>(`${this.integrations}/test`, {});
  }

  syncNow(): Observable<ApiResponse<{ connection: ConnectionStatus; started: boolean }>> {
    return this.http.post<ApiResponse<{ connection: ConnectionStatus; started: boolean }>>(`${this.integrations}/sync`, {});
  }

  disconnect(): Observable<ApiResponse<{ connection: ConnectionStatus }>> {
    return this.http.delete<ApiResponse<{ connection: ConnectionStatus }>>(this.integrations);
  }

  detectIp(): Observable<ApiResponse<{ ip: string; source: string }>> {
    return this.http.post<ApiResponse<{ ip: string; source: string }>>(`${this.integrations}/detect-ip`, {});
  }

  // ─── Workspace-wide ──────────────────────────────────────────────────
  connection(): Observable<ApiResponse<{ connection: ConnectionSummary }>> {
    return this.http.get<ApiResponse<{ connection: ConnectionSummary }>>(`${this.base}/connection`);
  }

  renewals(window: RenewalWindow): Observable<ApiResponse<RenewalsResponse>> {
    return this.http.get<ApiResponse<RenewalsResponse>>(`${this.base}/renewals`, { params: { window } });
  }

  review(): Observable<ApiResponse<ReviewQueue>> {
    return this.http.get<ApiResponse<ReviewQueue>>(`${this.base}/review`);
  }

  lookup(url: string, clientId?: string | null): Observable<ApiResponse<{ match: LookupResult }>> {
    let params = new HttpParams().set('url', url);
    if (clientId) params = params.set('clientId', clientId);
    return this.http.get<ApiResponse<{ match: LookupResult }>>(`${this.base}/lookup`, { params });
  }

  updateDomain(domainId: string, input: DomainManualInput): Observable<ApiResponse<{ id: string; changed: string[] }>> {
    return this.http.patch<ApiResponse<{ id: string; changed: string[] }>>(`${this.base}/${domainId}`, input);
  }

  ignore(domainId: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${domainId}/ignore`, {});
  }

  unignore(domainId: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${domainId}/unignore`, {});
  }

  link(domainId: string, clientId: string, projectId: string | null): Observable<ApiResponse<{ match: DomainMatch }>> {
    return this.http.post<ApiResponse<{ match: DomainMatch }>>(`${this.base}/${domainId}/link`, { clientId, projectId });
  }

  createClient(domainId: string, input: CreateFromDomainInput): Observable<ApiResponse<{ client: { id: string; name: string }; project: { id: string; name: string } | null; domainMatch: DomainMatch }>> {
    return this.http.post<ApiResponse<{ client: { id: string; name: string }; project: { id: string; name: string } | null; domainMatch: DomainMatch }>>(`${this.base}/${domainId}/create-client`, input);
  }

  checkAgain(domainId: string): Observable<ApiResponse<{ check: { checked: boolean; found?: boolean; reason?: string }; domain: DomainBrief; label: string }>> {
    return this.http.post<ApiResponse<{ check: { checked: boolean; found?: boolean; reason?: string }; domain: DomainBrief; label: string }>>(`${this.base}/${domainId}/check`, {});
  }

  // ─── Payments ────────────────────────────────────────────────────────
  addDomainExpense(domainId: string, input: ExpenseInput): Observable<ApiResponse<{ expense: Expense }>> {
    return this.http.post<ApiResponse<{ expense: Expense }>>(`${this.base}/${domainId}/expenses`, input);
  }

  planExpenses(planId: string): Observable<ApiResponse<{ expenses: Expense[] }>> {
    return this.http.get<ApiResponse<{ expenses: Expense[] }>>(`${this.base}/hosting-plans/${planId}/expenses`);
  }

  addPlanExpense(planId: string, input: ExpenseInput): Observable<ApiResponse<{ expense: Expense }>> {
    return this.http.post<ApiResponse<{ expense: Expense }>>(`${this.base}/hosting-plans/${planId}/expenses`, input);
  }

  deleteExpense(expenseId: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(`${this.base}/expenses/${expenseId}`);
  }

  // ─── Hosting plans ───────────────────────────────────────────────────
  plans(includeArchived = false): Observable<ApiResponse<{ plans: HostingPlanView[] }>> {
    return this.http.get<ApiResponse<{ plans: HostingPlanView[] }>>(`${this.base}/hosting-plans`, { params: includeArchived ? { archived: '1' } : {} });
  }

  createPlan(input: HostingPlanInput): Observable<ApiResponse<{ plan: HostingPlanView }>> {
    return this.http.post<ApiResponse<{ plan: HostingPlanView }>>(`${this.base}/hosting-plans`, input);
  }

  updatePlan(planId: string, input: HostingPlanInput): Observable<ApiResponse<{ plan: HostingPlanView }>> {
    return this.http.patch<ApiResponse<{ plan: HostingPlanView }>>(`${this.base}/hosting-plans/${planId}`, input);
  }

  setPlanClient(planId: string, clientId: string, body: { projectIds?: string[]; allocatedCents?: number | null }): Observable<ApiResponse<{ plan: HostingPlanView }>> {
    return this.http.put<ApiResponse<{ plan: HostingPlanView }>>(`${this.base}/hosting-plans/${planId}/clients/${clientId}`, body);
  }

  removePlanClient(planId: string, clientId: string): Observable<ApiResponse<{ plan: HostingPlanView }>> {
    return this.http.delete<ApiResponse<{ plan: HostingPlanView }>>(`${this.base}/hosting-plans/${planId}/clients/${clientId}`);
  }

  // ─── Inventory & management (ADR 0010) ───────────────────────────────
  inventory(filter: InventoryFilter, q: string): Observable<ApiResponse<InventoryResponse>> {
    return this.http.get<ApiResponse<InventoryResponse>>(`${this.base}/inventory`, { params: { filter, q } });
  }

  detail(domainId: string): Observable<ApiResponse<{ domain: DomainDetail }>> {
    return this.http.get<ApiResponse<{ domain: DomainDetail }>>(`${this.base}/${domainId}`);
  }

  refresh(domainId: string): Observable<ApiResponse<{ domain: DomainDetail }>> {
    return this.http.post<ApiResponse<{ domain: DomainDetail }>>(`${this.base}/${domainId}/refresh`, {});
  }

  // ─── Client- and project-scoped ──────────────────────────────────────
  clientDomains(clientId: string): Observable<ApiResponse<ClientDomainsView>> {
    return this.http.get<ApiResponse<ClientDomainsView>>(`/api/v1/clients/${clientId}/domains`);
  }

  projectDomains(projectId: string): Observable<ApiResponse<ClientDomainsView>> {
    return this.http.get<ApiResponse<ClientDomainsView>>(`/api/v1/projects/${projectId}/domains`);
  }

  addClientDomain(clientId: string, body: { domain: string; projectId?: string | null; isPrimary?: boolean }): Observable<ApiResponse<{ match: DomainMatch }>> {
    return this.http.post<ApiResponse<{ match: DomainMatch }>>(`/api/v1/clients/${clientId}/domains`, body);
  }

  updateDomainLink(clientId: string, linkId: string, body: { decision?: 'confirm' | 'reject' | 'automatic'; isPrimary?: boolean; projectId?: string | null }): Observable<ApiResponse<{ match: DomainMatch }>> {
    return this.http.patch<ApiResponse<{ match: DomainMatch }>>(`/api/v1/clients/${clientId}/domain-links/${linkId}`, body);
  }

  removeDomainLink(clientId: string, linkId: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(`/api/v1/clients/${clientId}/domain-links/${linkId}`);
  }
}
