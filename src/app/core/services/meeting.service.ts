import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Meeting, TimeSlot } from '../models/meeting.model';

@Injectable({ providedIn: 'root' })
export class MeetingService {
  private http = inject(HttpClient);

  list(projectId: string): Observable<{ data: { meetings: Meeting[] } }> {
    return this.http.get<{ data: { meetings: Meeting[] } }>(`/api/v1/projects/${projectId}/meetings`);
  }

  request(projectId: string, subject: string, proposedSlots: TimeSlot[]): Observable<{ data: { meeting: Meeting } }> {
    return this.http.post<{ data: { meeting: Meeting } }>(`/api/v1/projects/${projectId}/meetings`, { subject, proposedSlots });
  }

  confirm(projectId: string, meetingId: string, confirmedSlot: TimeSlot): Observable<{ data: { meeting: Meeting } }> {
    return this.http.post<{ data: { meeting: Meeting } }>(`/api/v1/projects/${projectId}/meetings/${meetingId}/confirm`, { confirmedSlot });
  }

  decline(projectId: string, meetingId: string): Observable<{ data: { meeting: Meeting } }> {
    return this.http.post<{ data: { meeting: Meeting } }>(`/api/v1/projects/${projectId}/meetings/${meetingId}/decline`, {});
  }

  cancel(projectId: string, meetingId: string): Observable<{ data: { meeting: Meeting } }> {
    return this.http.post<{ data: { meeting: Meeting } }>(`/api/v1/projects/${projectId}/meetings/${meetingId}/cancel`, {});
  }
}
