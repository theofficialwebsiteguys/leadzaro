import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProjectFile } from '../models/file.model';

@Injectable({ providedIn: 'root' })
export class FileUploadService {
  private http = inject(HttpClient);

  list(projectId: string): Observable<{ data: { files: ProjectFile[] } }> {
    return this.http.get<{ data: { files: ProjectFile[] } }>(`/api/v1/projects/${projectId}/files`);
  }

  upload(projectId: string, file: File, scope: string, isPrivate: boolean, relatedId?: string): Observable<{ data: { file: ProjectFile } }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('scope', scope);
    formData.append('isPrivate', String(isPrivate));
    if (relatedId) formData.append('relatedId', relatedId);
    return this.http.post<{ data: { file: ProjectFile } }>(`/api/v1/projects/${projectId}/files`, formData);
  }

  getSignedUrl(projectId: string, fileId: string, variant?: string): Observable<{ data: { url: string } }> {
    const params: Record<string, string> = {};
    if (variant) params['variant'] = variant;
    return this.http.get<{ data: { url: string } }>(`/api/v1/projects/${projectId}/files/${fileId}/signed-url`, { params });
  }

  delete(projectId: string, fileId: string): Observable<{ data: { deleted: boolean } }> {
    return this.http.delete<{ data: { deleted: boolean } }>(`/api/v1/projects/${projectId}/files/${fileId}`);
  }
}
