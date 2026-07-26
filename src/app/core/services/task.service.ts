import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Task, TimeEntry } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private http = inject(HttpClient);

  list(projectId: string): Observable<{ data: { tasks: Task[] } }> {
    return this.http.get<{ data: { tasks: Task[] } }>(`/api/v1/projects/${projectId}/tasks`);
  }

  create(projectId: string, payload: Partial<Task>): Observable<{ data: { task: Task } }> {
    return this.http.post<{ data: { task: Task } }>(`/api/v1/projects/${projectId}/tasks`, payload);
  }

  update(projectId: string, taskId: string, patch: Partial<Task>): Observable<{ data: { task: Task } }> {
    return this.http.patch<{ data: { task: Task } }>(`/api/v1/projects/${projectId}/tasks/${taskId}`, patch);
  }

  archive(projectId: string, taskId: string): Observable<{ data: { task: Task } }> {
    return this.http.post<{ data: { task: Task } }>(`/api/v1/projects/${projectId}/tasks/${taskId}/archive`, {});
  }

  logTime(projectId: string, taskId: string, minutes: number, note?: string): Observable<{ data: { timeEntry: TimeEntry } }> {
    return this.http.post<{ data: { timeEntry: TimeEntry } }>(`/api/v1/projects/${projectId}/tasks/${taskId}/time-entries`, { minutes, note });
  }

  listTimeEntries(projectId: string, taskId: string): Observable<{ data: { timeEntries: TimeEntry[] } }> {
    return this.http.get<{ data: { timeEntries: TimeEntry[] } }>(`/api/v1/projects/${projectId}/tasks/${taskId}/time-entries`);
  }
}
