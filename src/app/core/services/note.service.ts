import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ClientNote } from '../models/client.model';

/** Notes pinned to one project — the same feed the client's Notes tab shows. */
@Injectable({ providedIn: 'root' })
export class NoteService {
  private readonly http = inject(HttpClient);

  list(projectId: string): Observable<{ data: { notes: ClientNote[] } }> {
    return this.http.get<{ data: { notes: ClientNote[] } }>(`/api/v1/projects/${projectId}/notes`);
  }

  create(projectId: string, body: string): Observable<{ data: { note: ClientNote } }> {
    return this.http.post<{ data: { note: ClientNote } }>(`/api/v1/projects/${projectId}/notes`, { body });
  }
}
