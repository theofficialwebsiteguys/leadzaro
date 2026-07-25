import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DashboardConfig, DashboardStats, OutreachActivity } from '../models/lead.model';

export interface DashboardData {
  stats: DashboardStats;
  recentActivity: OutreachActivity[];
  dashboardConfig: DashboardConfig;
  userType: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);

  getDashboard(): Observable<{ data: DashboardData }> {
    return this.http.get<{ data: DashboardData }>('/api/dashboard');
  }
}
