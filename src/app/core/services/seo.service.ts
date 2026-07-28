import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Website } from '../models/website.model';
import {
  SeoEntitlementGrant, SeoPageListEntry, WebsitePageSeoSettings, WebsiteRedirect, WebsiteSeoAudit, SeoTaskCycle, SeoDashboard, AgencySeoOverviewRow,
} from '../models/seo.model';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private http = inject(HttpClient);

  // --- Entitlement (organization-scoped) ---

  getEntitlementStatus(organizationId: string): Observable<{ data: { entitled: boolean } }> {
    return this.http.get<{ data: { entitled: boolean } }>(`/api/v1/seo/organizations/${organizationId}/entitlement-status`);
  }

  listEntitlementGrants(organizationId: string): Observable<{ data: { grants: SeoEntitlementGrant[] } }> {
    return this.http.get<{ data: { grants: SeoEntitlementGrant[] } }>(`/api/v1/seo/organizations/${organizationId}/entitlement-grants`);
  }

  grantEntitlement(organizationId: string, reason: string, expiresAt?: string): Observable<{ data: { grant: SeoEntitlementGrant } }> {
    return this.http.post<{ data: { grant: SeoEntitlementGrant } }>(`/api/v1/seo/organizations/${organizationId}/entitlement-grants`, { reason, expiresAt });
  }

  revokeEntitlement(organizationId: string, grantId: string): Observable<{ data: { grant: SeoEntitlementGrant } }> {
    return this.http.post<{ data: { grant: SeoEntitlementGrant } }>(`/api/v1/seo/organizations/${organizationId}/entitlement-grants/${grantId}/revoke`, {});
  }

  getAgencyOverview(): Observable<{ data: { overview: AgencySeoOverviewRow[] } }> {
    return this.http.get<{ data: { overview: AgencySeoOverviewRow[] } }>('/api/v1/seo/agency-overview');
  }

  // --- Page metadata / sitemap / robots.txt (project-scoped) ---

  listPageSettings(projectId: string): Observable<{ data: { pages: SeoPageListEntry[] } }> {
    return this.http.get<{ data: { pages: SeoPageListEntry[] } }>(`/api/v1/projects/${projectId}/website/seo/pages`);
  }

  upsertPageSettings(projectId: string, pageId: string, fields: Partial<WebsitePageSeoSettings>): Observable<{ data: { settings: WebsitePageSeoSettings } }> {
    return this.http.put<{ data: { settings: WebsitePageSeoSettings } }>(`/api/v1/projects/${projectId}/website/seo/pages/${pageId}`, fields);
  }

  // --- Redirects ---

  listRedirects(projectId: string): Observable<{ data: { redirects: WebsiteRedirect[] } }> {
    return this.http.get<{ data: { redirects: WebsiteRedirect[] } }>(`/api/v1/projects/${projectId}/website/seo/redirects`);
  }

  createRedirect(projectId: string, fromPath: string, toPath: string, statusCode?: number): Observable<{ data: { redirect: WebsiteRedirect } }> {
    return this.http.post<{ data: { redirect: WebsiteRedirect } }>(`/api/v1/projects/${projectId}/website/seo/redirects`, { fromPath, toPath, statusCode });
  }

  deleteRedirect(projectId: string, redirectId: string): Observable<{ data: { removed: boolean } }> {
    return this.http.delete<{ data: { removed: boolean } }>(`/api/v1/projects/${projectId}/website/seo/redirects/${redirectId}`);
  }

  // --- Audits ---

  runAudit(projectId: string, versionId: string): Observable<{ message: string; data: { audit: WebsiteSeoAudit } }> {
    return this.http.post<{ message: string; data: { audit: WebsiteSeoAudit } }>(`/api/v1/projects/${projectId}/website/seo/audits`, { versionId });
  }

  listAudits(projectId: string): Observable<{ data: { audits: WebsiteSeoAudit[] } }> {
    return this.http.get<{ data: { audits: WebsiteSeoAudit[] } }>(`/api/v1/projects/${projectId}/website/seo/audits`);
  }

  // --- Recurring task cycles ---

  generateTaskCycle(projectId: string, cyclePeriod?: string): Observable<{ message: string; data: { cycle: SeoTaskCycle } }> {
    return this.http.post<{ message: string; data: { cycle: SeoTaskCycle } }>(`/api/v1/projects/${projectId}/website/seo/task-cycles`, { cyclePeriod });
  }

  listTaskCycles(projectId: string): Observable<{ data: { cycles: SeoTaskCycle[] } }> {
    return this.http.get<{ data: { cycles: SeoTaskCycle[] } }>(`/api/v1/projects/${projectId}/website/seo/task-cycles`);
  }

  // --- Dashboard + Search Console ---

  getDashboard(projectId: string): Observable<{ data: { dashboard: SeoDashboard } }> {
    return this.http.get<{ data: { dashboard: SeoDashboard } }>(`/api/v1/projects/${projectId}/website/seo/dashboard`);
  }

  setSearchConsoleProperty(projectId: string, propertyUrl: string): Observable<{ data: { website: Website } }> {
    return this.http.post<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website/seo/search-console`, { propertyUrl });
  }
}
