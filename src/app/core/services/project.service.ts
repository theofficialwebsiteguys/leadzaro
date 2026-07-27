import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Project, ProjectAssignment, ProjectFinancials, ProjectDashboard,
} from '../models/project.model';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private http = inject(HttpClient);

  list(): Observable<{ data: { projects: Project[] } }> {
    return this.http.get<{ data: { projects: Project[] } }>('/api/v1/projects');
  }

  getById(id: string): Observable<{ data: { project: Project } }> {
    return this.http.get<{ data: { project: Project } }>(`/api/v1/projects/${id}`);
  }

  changeStage(id: string, stage: string, options: { confirmed?: boolean; overrideReason?: string } = {}): Observable<{ data: { project: Project } }> {
    return this.http.patch<{ data: { project: Project } }>(`/api/v1/projects/${id}/stage`, { stage, ...options });
  }

  updateHealthStatus(id: string, healthStatus: string): Observable<{ data: { project: Project } }> {
    return this.http.patch<{ data: { project: Project } }>(`/api/v1/projects/${id}/health`, { healthStatus });
  }

  listAssignments(id: string): Observable<{ data: { assignments: ProjectAssignment[] } }> {
    return this.http.get<{ data: { assignments: ProjectAssignment[] } }>(`/api/v1/projects/${id}/assignments`);
  }

  addAssignment(id: string, userId: string, roleSlot: string): Observable<{ data: { assignment: ProjectAssignment } }> {
    return this.http.post<{ data: { assignment: ProjectAssignment } }>(`/api/v1/projects/${id}/assignments`, { userId, roleSlot });
  }

  removeAssignment(id: string, assignmentId: string): Observable<{ data: { removed: boolean } }> {
    return this.http.delete<{ data: { removed: boolean } }>(`/api/v1/projects/${id}/assignments/${assignmentId}`);
  }

  getFinancials(id: string): Observable<{ data: { financials: ProjectFinancials | null } }> {
    return this.http.get<{ data: { financials: ProjectFinancials | null } }>(`/api/v1/projects/${id}/financials`);
  }

  updateFinancials(id: string, payload: { estimatedCostCents?: number; actualCostCents?: number; marginNotes?: string }): Observable<{ data: { financials: ProjectFinancials } }> {
    return this.http.patch<{ data: { financials: ProjectFinancials } }>(`/api/v1/projects/${id}/financials`, payload);
  }

  getDashboard(id: string): Observable<{ data: { dashboard: ProjectDashboard } }> {
    return this.http.get<{ data: { dashboard: ProjectDashboard } }>(`/api/v1/projects/${id}/dashboard`);
  }
}
