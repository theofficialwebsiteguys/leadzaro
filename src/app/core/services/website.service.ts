import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Website, WebsiteVersion, WebsiteEditorAssignment, WebsiteVersionComparison, WebsiteComment, WebsitePresenceEntry, WebsiteRepository, WebsiteDeployment, WebsiteDevelopmentHandoff,
  WebsiteDomain, WebsitePublicFormSubmission, WebsiteAnalyticsEvent, WebsiteAnalyticsSummaryRow, WebsiteExportBundle,
} from '../models/website.model';

@Injectable({ providedIn: 'root' })
export class WebsiteService {
  private http = inject(HttpClient);

  get(projectId: string): Observable<{ data: { website: Website } }> {
    return this.http.get<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website`);
  }

  create(
    projectId: string,
    name: string,
    startingMode: string,
    options?: { designSystemTemplateId?: string; sectionComponentKeys?: string[] }
  ): Observable<{ data: { website: Website } }> {
    return this.http.post<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website`, {
      name, startingMode, ...options,
    });
  }

  saveDraft(projectId: string, draftSchema: unknown): Observable<{ data: { website: Website } }> {
    return this.http.patch<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website/draft`, { draftSchema });
  }

  listVersions(projectId: string): Observable<{ data: { versions: WebsiteVersion[] } }> {
    return this.http.get<{ data: { versions: WebsiteVersion[] } }>(`/api/v1/projects/${projectId}/website/versions`);
  }

  createCheckpoint(projectId: string, label: string): Observable<{ data: { version: WebsiteVersion } }> {
    return this.http.post<{ data: { version: WebsiteVersion } }>(`/api/v1/projects/${projectId}/website/versions`, { label });
  }

  restoreVersion(projectId: string, versionId: string): Observable<{ message: string; data: { website: Website; preservedSectionIds: string[] } }> {
    return this.http.post<{ message: string; data: { website: Website; preservedSectionIds: string[] } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/restore`, {});
  }

  publishVersion(projectId: string, versionId: string): Observable<{ data: { version: WebsiteVersion } }> {
    return this.http.post<{ data: { version: WebsiteVersion } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/publish`, {});
  }

  listEditors(projectId: string): Observable<{ data: { assignments: WebsiteEditorAssignment[] } }> {
    return this.http.get<{ data: { assignments: WebsiteEditorAssignment[] } }>(`/api/v1/projects/${projectId}/website/editors`);
  }

  addEditor(projectId: string, userId: string, editingLevel: string): Observable<{ data: { assignment: WebsiteEditorAssignment } }> {
    return this.http.post<{ data: { assignment: WebsiteEditorAssignment } }>(`/api/v1/projects/${projectId}/website/editors`, { userId, editingLevel });
  }

  removeEditor(projectId: string, assignmentId: string): Observable<{ data: { removed: boolean } }> {
    return this.http.delete<{ data: { removed: boolean } }>(`/api/v1/projects/${projectId}/website/editors/${assignmentId}`);
  }

  createAutosave(projectId: string): Observable<{ data: { version: WebsiteVersion } }> {
    return this.http.post<{ data: { version: WebsiteVersion } }>(`/api/v1/projects/${projectId}/website/versions/autosave`, {});
  }

  compareVersions(projectId: string, fromVersionId: string, toVersionId: string): Observable<{ data: { comparison: WebsiteVersionComparison } }> {
    return this.http.get<{ data: { comparison: WebsiteVersionComparison } }>(`/api/v1/projects/${projectId}/website/versions/compare`, {
      params: { from: fromVersionId, to: toVersionId },
    });
  }

  submitTestForm(projectId: string, pageId: string, sectionId: string, values: unknown): Observable<{ data: { clientRequest: { id: string; category: string } } }> {
    return this.http.post<{ data: { clientRequest: { id: string; category: string } } }>(`/api/v1/projects/${projectId}/website/forms/test-submit`, { pageId, sectionId, values });
  }

  listComments(projectId: string): Observable<{ data: { comments: WebsiteComment[] } }> {
    return this.http.get<{ data: { comments: WebsiteComment[] } }>(`/api/v1/projects/${projectId}/website/comments`);
  }

  createComment(projectId: string, anchorKey: string, body: string, isInternal: boolean): Observable<{ data: { comment: WebsiteComment } }> {
    return this.http.post<{ data: { comment: WebsiteComment } }>(`/api/v1/projects/${projectId}/website/comments`, { anchorKey, body, isInternal });
  }

  resolveComment(projectId: string, commentId: string): Observable<{ data: { comment: WebsiteComment } }> {
    return this.http.post<{ data: { comment: WebsiteComment } }>(`/api/v1/projects/${projectId}/website/comments/${commentId}/resolve`, {});
  }

  heartbeatPresence(projectId: string, sectionKey?: string): Observable<{ data: { presence: WebsitePresenceEntry } }> {
    return this.http.post<{ data: { presence: WebsitePresenceEntry } }>(`/api/v1/projects/${projectId}/website/presence`, { sectionKey });
  }

  listPresence(projectId: string): Observable<{ data: { presence: WebsitePresenceEntry[] } }> {
    return this.http.get<{ data: { presence: WebsitePresenceEntry[] } }>(`/api/v1/projects/${projectId}/website/presence`);
  }

  getRepository(projectId: string): Observable<{ data: { repository: WebsiteRepository | null } }> {
    return this.http.get<{ data: { repository: WebsiteRepository | null } }>(`/api/v1/projects/${projectId}/website/repository`);
  }

  provisionRepository(projectId: string): Observable<{ data: { repository: WebsiteRepository } }> {
    return this.http.post<{ data: { repository: WebsiteRepository } }>(`/api/v1/projects/${projectId}/website/repository`, {});
  }

  generateWebsite(projectId: string, versionId: string): Observable<{ data: { fileCount: number; branch: string } }> {
    return this.http.post<{ data: { fileCount: number; branch: string } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/generate`, {});
  }

  listDeployments(projectId: string): Observable<{ data: { deployments: WebsiteDeployment[] } }> {
    return this.http.get<{ data: { deployments: WebsiteDeployment[] } }>(`/api/v1/projects/${projectId}/website/deployments`);
  }

  deployPreview(projectId: string, versionId: string): Observable<{ data: { deployment: WebsiteDeployment } }> {
    return this.http.post<{ data: { deployment: WebsiteDeployment } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/deploy-preview`, {});
  }

  listDevelopmentHandoffs(projectId: string): Observable<{ data: { handoffs: WebsiteDevelopmentHandoff[] } }> {
    return this.http.get<{ data: { handoffs: WebsiteDevelopmentHandoff[] } }>(`/api/v1/projects/${projectId}/website/development-handoffs`);
  }

  promoteToDevelopment(projectId: string, versionId: string, technicalHandoffNotes: string): Observable<{ data: { handoff: WebsiteDevelopmentHandoff } }> {
    return this.http.post<{ data: { handoff: WebsiteDevelopmentHandoff } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/promote-to-development`, { technicalHandoffNotes });
  }

  mergeBack(projectId: string, branchName: string, title: string): Observable<{ data: { branchName: string; baseBranch: string } }> {
    return this.http.post<{ data: { branchName: string; baseBranch: string } }>(`/api/v1/projects/${projectId}/website/merge-back`, { branchName, title });
  }

  // --- Phase 7: domain management ---

  getDomain(projectId: string): Observable<{ data: { domain: WebsiteDomain | null } }> {
    return this.http.get<{ data: { domain: WebsiteDomain | null } }>(`/api/v1/projects/${projectId}/website/domain`);
  }

  checkDomainAvailability(projectId: string, domain: string): Observable<{ data: { domain: string; available: boolean } }> {
    return this.http.post<{ data: { domain: string; available: boolean } }>(`/api/v1/projects/${projectId}/website/domain/check-availability`, { domain });
  }

  registerDomain(projectId: string, domain: string, years?: number): Observable<{ data: { domain: WebsiteDomain } }> {
    return this.http.post<{ data: { domain: WebsiteDomain } }>(`/api/v1/projects/${projectId}/website/domain/register`, { domain, years });
  }

  updateDomainDnsRecords(projectId: string, records: Array<{ type: string; host: string; value: string }>): Observable<{ data: { domain: WebsiteDomain } }> {
    return this.http.post<{ data: { domain: WebsiteDomain } }>(`/api/v1/projects/${projectId}/website/domain/dns-records`, { records });
  }

  mapDocumentRoot(projectId: string, path: string): Observable<{ data: { domain: WebsiteDomain } }> {
    return this.http.post<{ data: { domain: WebsiteDomain } }>(`/api/v1/projects/${projectId}/website/domain/map-document-root`, { path });
  }

  checkDomainRenewal(projectId: string): Observable<{ data: { noticeSent: boolean; reason?: string } }> {
    return this.http.post<{ data: { noticeSent: boolean; reason?: string } }>(`/api/v1/projects/${projectId}/website/domain/check-renewal`, {});
  }

  initiateDomainTransfer(projectId: string): Observable<{ data: { domain: WebsiteDomain } }> {
    return this.http.post<{ data: { domain: WebsiteDomain } }>(`/api/v1/projects/${projectId}/website/domain/initiate-transfer`, {});
  }

  // --- Phase 7: production deployment + rollback ---

  deployToProduction(projectId: string, versionId: string): Observable<{ message: string; data: { deployment: WebsiteDeployment } }> {
    return this.http.post<{ message: string; data: { deployment: WebsiteDeployment } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/deploy-production`, {});
  }

  listProductionDeployments(projectId: string): Observable<{ data: { deployments: WebsiteDeployment[] } }> {
    return this.http.get<{ data: { deployments: WebsiteDeployment[] } }>(`/api/v1/projects/${projectId}/website/production-deployments`);
  }

  getCurrentLiveDeployment(projectId: string): Observable<{ data: { deployment: WebsiteDeployment | null } }> {
    return this.http.get<{ data: { deployment: WebsiteDeployment | null } }>(`/api/v1/projects/${projectId}/website/production-deployments/current`);
  }

  // --- Phase 7: public form submission triage ---

  listPublicFormSubmissions(projectId: string, status?: string): Observable<{ data: { submissions: WebsitePublicFormSubmission[] } }> {
    return this.http.get<{ data: { submissions: WebsitePublicFormSubmission[] } }>(`/api/v1/projects/${projectId}/website/public-form-submissions`, {
      params: status ? { status } : {},
    });
  }

  convertPublicFormSubmission(projectId: string, submissionId: string): Observable<{ data: { submission: WebsitePublicFormSubmission; clientRequest: { id: string } } }> {
    return this.http.post<{ data: { submission: WebsitePublicFormSubmission; clientRequest: { id: string } } }>(`/api/v1/projects/${projectId}/website/public-form-submissions/${submissionId}/convert`, {});
  }

  updatePublicFormSubmissionStatus(projectId: string, submissionId: string, status: 'discarded' | 'spam'): Observable<{ data: { submission: WebsitePublicFormSubmission } }> {
    return this.http.post<{ data: { submission: WebsitePublicFormSubmission } }>(`/api/v1/projects/${projectId}/website/public-form-submissions/${submissionId}/status`, { status });
  }

  // --- Phase 7: hybrid analytics + guided Google Analytics connection ---

  listAnalyticsEvents(projectId: string): Observable<{ data: { events: WebsiteAnalyticsEvent[] } }> {
    return this.http.get<{ data: { events: WebsiteAnalyticsEvent[] } }>(`/api/v1/projects/${projectId}/website/analytics/events`);
  }

  getAnalyticsSummary(projectId: string, rangeDays?: number): Observable<{ data: { summary: WebsiteAnalyticsSummaryRow[] } }> {
    return this.http.get<{ data: { summary: WebsiteAnalyticsSummaryRow[] } }>(`/api/v1/projects/${projectId}/website/analytics/summary`, {
      params: rangeDays ? { rangeDays } : {},
    });
  }

  setGoogleAnalyticsMeasurementId(projectId: string, measurementId: string): Observable<{ data: { website: Website } }> {
    return this.http.post<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website/analytics/google-analytics`, { measurementId });
  }

  // --- Phase 7: employee-controlled full website export ---

  exportWebsite(projectId: string, versionId: string): Observable<{ data: { export: WebsiteExportBundle } }> {
    return this.http.get<{ data: { export: WebsiteExportBundle } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/export`);
  }
}
