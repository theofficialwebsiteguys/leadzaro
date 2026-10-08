import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ClientDetail, ClientFile, ClientListQuery, ClientListResult, ClientNote, ClientProfileFields, ClientProject, ClientSummary, ExistingClientInput, ProjectInput,
} from '../models/client.model';
import { Contact } from '../models/contact.model';
import { DomainMatch } from '../models/domain.model';

type ApiResponse<T> = { data: T };

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/clients';

  list(): Observable<ApiResponse<{ clients: ClientSummary[] }>> {
    return this.http.get<ApiResponse<{ clients: ClientSummary[] }>>(this.base);
  }

  /** The Clients page (ADR 0013): filtered, searched, sorted and paged on the server. */
  search(query: ClientListQuery): Observable<ApiResponse<ClientListResult>> {
    let params = new HttpParams().set('tzOffset', String(new Date().getTimezoneOffset()));
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<ApiResponse<ClientListResult>>(this.base, { params });
  }

  get(clientId: string): Observable<ApiResponse<ClientDetail>> {
    return this.http.get<ApiResponse<ClientDetail>>(`${this.base}/${clientId}`, { params: { tzOffset: String(new Date().getTimezoneOffset()) } });
  }

  /** Adds an existing client (never counted as a new sale). Answers 409 with details.possibleDuplicates when it may already exist. */
  createExisting(input: ExistingClientInput): Observable<ApiResponse<{ client: { id: string; name: string }; domainMatch: DomainMatch | null; createdFrom: 'new' | 'lead'; openDeals: number }>> {
    return this.http.post<ApiResponse<{ client: { id: string; name: string }; domainMatch: DomainMatch | null; createdFrom: 'new' | 'lead'; openDeals: number }>>(this.base, input);
  }

  assignManager(clientIds: string[], accountManagerUserId: string | null): Observable<ApiResponse<{ changed: number }>> {
    return this.http.post<ApiResponse<{ changed: number }>>(`${this.base}/assign-manager`, { clientIds, accountManagerUserId });
  }

  create(name: string, websiteUrl?: string): Observable<ApiResponse<{ client: { id: string; name: string }; domainMatch: DomainMatch | null }>> {
    return this.http.post<ApiResponse<{ client: { id: string; name: string }; domainMatch: DomainMatch | null }>>(this.base, { name, websiteUrl });
  }

  update(clientId: string, patch: Partial<ClientProfileFields> & { name?: string }): Observable<ApiResponse<{ changed: string[]; domainMatch?: DomainMatch | null }>> {
    return this.http.patch<ApiResponse<{ changed: string[]; domainMatch?: DomainMatch | null }>>(`${this.base}/${clientId}`, patch);
  }

  createContact(clientId: string, contact: Partial<Contact>): Observable<ApiResponse<{ contact: Contact }>> {
    return this.http.post<ApiResponse<{ contact: Contact }>>(`${this.base}/${clientId}/contacts`, contact);
  }

  updateContact(clientId: string, contactId: string, patch: Partial<Contact>): Observable<ApiResponse<{ contact: Contact }>> {
    return this.http.patch<ApiResponse<{ contact: Contact }>>(`${this.base}/${clientId}/contacts/${contactId}`, patch);
  }

  archiveContact(clientId: string, contactId: string): Observable<ApiResponse<{ contact: Contact }>> {
    return this.http.post<ApiResponse<{ contact: Contact }>>(`${this.base}/${clientId}/contacts/${contactId}/archive`, {});
  }

  createProject(clientId: string, project: ProjectInput): Observable<ApiResponse<{ project: ClientProject; domainMatch: DomainMatch | null }>> {
    return this.http.post<ApiResponse<{ project: ClientProject; domainMatch: DomainMatch | null }>>(`${this.base}/${clientId}/projects`, project);
  }

  updateProject(clientId: string, projectId: string, patch: ProjectInput): Observable<ApiResponse<{ project: ClientProject; domainMatch?: DomainMatch | null }>> {
    return this.http.patch<ApiResponse<{ project: ClientProject; domainMatch?: DomainMatch | null }>>(`${this.base}/${clientId}/projects/${projectId}`, patch);
  }

  uploadFile(clientId: string, file: File, projectId?: string | null): Observable<ApiResponse<{ file: ClientFile }>> {
    const form = new FormData();
    form.append('file', file);
    if (projectId) form.append('projectId', projectId);
    return this.http.post<ApiResponse<{ file: ClientFile }>>(`${this.base}/${clientId}/files`, form);
  }

  downloadUrl(clientId: string, fileId: string): Observable<ApiResponse<{ url: string }>> {
    return this.http.get<ApiResponse<{ url: string }>>(`${this.base}/${clientId}/files/${fileId}/download-url`);
  }

  deleteFile(clientId: string, fileId: string): Observable<ApiResponse<{ deleted: boolean }>> {
    return this.http.delete<ApiResponse<{ deleted: boolean }>>(`${this.base}/${clientId}/files/${fileId}`);
  }

  listNotes(clientId: string): Observable<ApiResponse<{ notes: ClientNote[] }>> {
    return this.http.get<ApiResponse<{ notes: ClientNote[] }>>(`${this.base}/${clientId}/notes`);
  }

  createNote(clientId: string, body: string, projectId?: string | null): Observable<ApiResponse<{ note: ClientNote }>> {
    return this.http.post<ApiResponse<{ note: ClientNote }>>(`${this.base}/${clientId}/notes`, { body, projectId: projectId || null });
  }
}
