import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Website, WebsiteVersion, WebsiteEditorAssignment, WebsiteVersionComparison } from '../models/website.model';

@Injectable({ providedIn: 'root' })
export class WebsiteService {
  private http = inject(HttpClient);

  get(projectId: string): Observable<{ data: { website: Website } }> {
    return this.http.get<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website`);
  }

  create(projectId: string, name: string, startingMode: string): Observable<{ data: { website: Website } }> {
    return this.http.post<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website`, { name, startingMode });
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

  restoreVersion(projectId: string, versionId: string): Observable<{ data: { website: Website } }> {
    return this.http.post<{ data: { website: Website } }>(`/api/v1/projects/${projectId}/website/versions/${versionId}/restore`, {});
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
}
