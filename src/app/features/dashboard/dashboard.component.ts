import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { DashboardData, DashboardService } from '../../core/services/dashboard.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, TitleCasePipe, IconComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly dashService = inject(DashboardService);
  auth = inject(AuthService);

  data    = signal<DashboardData | null>(null);
  loading = signal(true);
  error   = signal('');

  ngOnInit() {
    this.dashService.getDashboard().subscribe({
      next: (res) => { this.data.set(res.data); this.loading.set(false); },
      error: (err) => { this.error.set(err.error?.message || 'Failed to load dashboard'); this.loading.set(false); },
    });
  }

  kpiCards = computed(() => {
    const s = this.data()?.stats;
    if (!s) return [];
    return [
      { label: 'Saved Leads',     value: s.totalSaved,      icon: 'leads',       color: 'blue',   route: '/app/leads'  },
      { label: 'Contacted',       value: s.contacted,       icon: 'phone',       color: 'sky',    route: '/app/leads'  },
      { label: 'Follow-ups Due',  value: s.followUpsDue,    icon: 'bell',        color: 'amber',  route: '/app/leads'  },
      { label: 'Interested',      value: s.interested,      icon: 'star',        color: 'green',  route: '/app/leads'  },
      { label: 'No Website',      value: s.noWebsiteLeads,  icon: 'globe',       color: 'red',    route: '/app/search' },
      { label: 'Closed',          value: s.closed,          icon: 'check-circle',color: 'teal',   route: '/app/leads'  },
    ];
  });

  activityIcon(type: string): string {
    const map: Record<string, string> = { call: 'phone', email: 'mail', visit: 'target', message: 'outreach', linkedin: 'users' };
    return map[type] || 'outreach';
  }
}
