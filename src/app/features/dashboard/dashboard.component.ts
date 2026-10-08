import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { SettingsService } from '../../core/services/settings.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { AttentionItem, Overview, OverviewMetric } from '../../core/models/settings.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { MoneyPipe, money, relativeDay } from '../sales/shared/sales-format';

const KIND_ICONS: Record<string, string> = {
  payment: 'card', handoff: 'handoff', reply: 'message', follow_up: 'clock', client_info: 'users', client_account: 'users', domain: 'globe', integration: 'alert',
};
const KIND_LINKS: Record<string, { label: string; path: string; query?: Record<string, string> }> = {
  reply: { label: 'Today', path: '/app/today' },
  follow_up: { label: 'Today', path: '/app/today' },
  payment: { label: 'Today', path: '/app/today' },
  handoff: { label: 'Today', path: '/app/today' },
  client_info: { label: 'Clients', path: '/app/clients' },
  client_account: { label: 'Clients needing attention', path: '/app/clients', query: { view: 'attention' } },
  domain: { label: 'Domains', path: '/app/domains' },
  integration: { label: 'Integrations', path: '/app/settings/integrations' },
};

/**
 * The business overview (ADR 0012): how the business is doing, what needs
 * attention, what changed and where to go next. Daily outreach stays on
 * Today; deeper analysis stays in Reports. Everything comes from one
 * server call, scoped on the server to what this person may see.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule, IconComponent, MoneyPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly settings = inject(SettingsService);
  readonly auth = inject(AuthService);
  readonly org = inject(OrganizationContextService);

  /** Client-list views linked from the Client base panel (ADR 0013). */
  readonly clientFlags = [
    { key: 'attention', label: 'Clients needing attention', warn: true },
    { key: 'waiting_us', label: 'Waiting on us', warn: true },
    { key: 'billing', label: 'Billing issues', warn: true },
    { key: 'onboarding', label: 'Onboarding in progress', warn: false },
    { key: 'waiting_client', label: 'Waiting on the client', warn: false },
    { key: 'missing_info', label: 'Missing information', warn: false },
  ];

  goalPercent(active: number, target: number): number {
    return target > 0 ? Math.min(100, Math.round((active / target) * 100)) : 0;
  }

  percent(numerator: number, denominator: number): string {
    return denominator ? `${Math.round((numerator / denominator) * 100)}%` : '—';
  }

  readonly data = signal<Overview | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly showSetup = signal(false);
  readonly kindIcons = KIND_ICONS;
  readonly relativeDay = relativeDay;

  scope: 'mine' | 'team' = this.readPref('scope', 'mine') as 'mine' | 'team';
  period = this.readPref('period', '30');

  readonly isEmployee = computed(() => this.org.membership()?.membershipType === 'employee');
  readonly canSales = computed(() => this.org.hasPermission('leads.read'));
  readonly quickActions = computed(() => {
    const actions: { label: string; icon: string; path: string; primary?: boolean }[] = [];
    if (this.canSales()) actions.push({ label: 'Open Today', icon: 'sun', path: '/app/today', primary: true });
    if (this.org.hasPermission('leads.search')) actions.push({ label: 'Find leads', icon: 'search', path: '/app/search' });
    if (!this.canSales() && this.org.hasPermission('projects.view')) actions.push({ label: 'Clients', icon: 'folder', path: '/app/clients', primary: true });
    if (this.org.hasPermission('sales.view_team')) actions.push({ label: 'Reports', icon: 'chart-bar', path: '/app/sales/reports' });
    return actions.slice(0, 3);
  });
  readonly viewAllLinks = computed(() => {
    const counts = this.data()?.attention.counts ?? {};
    const seen = new Set<string>();
    return Object.keys(counts).map((kind) => KIND_LINKS[kind]).filter((link) => {
      const key = link ? link.path + JSON.stringify(link.query ?? {}) : '';
      return Boolean(link) && !seen.has(key) && Boolean(seen.add(key));
    });
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.settings.overview(this.scope, this.period).subscribe({
      next: (d) => {
        this.data.set(d);
        this.scope = d.scope;
        this.loading.set(false);
        this.error.set('');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.status === 403 ? 'The overview isn’t available for your account.' : 'The overview couldn’t be loaded. Check your connection and try again.');
      },
    });
  }

  setScope(scope: 'mine' | 'team'): void {
    this.scope = scope;
    this.savePref('scope', scope);
    this.load();
  }

  setPeriod(period: string): void {
    this.period = period;
    this.savePref('period', period);
    this.load();
  }

  metricValue(m: OverviewMetric): string {
    if (typeof m.value === 'number') return m.value.toLocaleString();
    const list = m.value;
    const text = list.length ? list.map((v) => money(v.amountCents, v.currency)).join(' + ') : money(0);
    return m.format === 'money_monthly' ? `${text}/mo` : text;
  }

  timeframe(m: OverviewMetric): string {
    return m.timeframe === 'now' ? 'Right now' : this.data()?.period.label ?? '';
  }

  whenText(item: AttentionItem): string {
    if (item.kind === 'follow_up' && item.due) return `Due ${relativeDay(item.due)}`;
    if (item.kind === 'domain' && item.due) return `Expires ${relativeDay(item.due)}`;
    if (item.kind === 'reply' && item.at) return `Since ${relativeDay(item.at)}`;
    return '';
  }

  firstName(): string {
    return this.auth.currentUser()?.name?.split(' ')[0] ?? '';
  }

  private readPref(key: string, fallback: string): string {
    try { return localStorage.getItem(`lz.overview.${key}`) || fallback; } catch { return fallback; }
  }

  private savePref(key: string, value: string): void {
    try { localStorage.setItem(`lz.overview.${key}`, value); } catch { /* storage unavailable */ }
  }
}
