import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SalesService } from '../../../core/services/sales.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { CHANNEL_LABELS, Ratio, SalesReport, UserRef } from '../../../core/models/sales.model';
import { MoneyPipe, money } from '../shared/sales-format';

const ORIGIN_LABELS: Record<string, string> = { platform: 'sent from Leadzaro', manual: 'logged', external: 'outside Leadzaro' };

/**
 * Sales reports (ADR 0011): personal numbers for everyone, the team view
 * for managers, with every rate showing its numerator and denominator.
 */
@Component({
  selector: 'app-sales-reports',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, MoneyPipe],
  templateUrl: './sales-reports.component.html',
  styleUrl: './sales-reports.component.scss',
})
export class SalesReportsComponent implements OnInit {
  private readonly sales = inject(SalesService);
  readonly org = inject(OrganizationContextService);

  readonly channelLabels = CHANNEL_LABELS;
  readonly originLabels = ORIGIN_LABELS;
  readonly report = signal<SalesReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly members = signal<UserRef[]>([]);
  readonly canTeam = computed(() => this.org.hasPermission('sales.view_team'));

  scope: 'mine' | 'team' = 'mine';
  userId = '';
  preset = '30';
  from = '';
  to = '';
  includeTest = false;

  ngOnInit(): void {
    this.applyPreset('30');
    if (this.canTeam()) this.sales.team().subscribe({ next: (r) => this.members.set(r.members), error: () => undefined });
  }

  applyPreset(preset: string): void {
    this.preset = preset;
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (preset === 'week') {
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      this.from = iso(monday);
    } else if (preset === 'month') {
      this.from = iso(new Date(today.getFullYear(), today.getMonth(), 1));
    } else if (preset !== 'custom') {
      const start = new Date(today);
      start.setDate(today.getDate() - Number(preset) + 1);
      this.from = iso(start);
    }
    if (preset !== 'custom') this.to = iso(today);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.sales.report({
      scope: this.scope, userId: this.scope === 'team' ? this.userId || undefined : undefined, from: this.from, to: this.to, includeTest: this.includeTest || undefined,
    }).subscribe({
      next: (r) => { this.report.set(r); this.loading.set(false); this.error.set(''); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'The report could not be loaded.'); },
    });
  }

  closeTotal(r: SalesReport): number {
    return r.closeReasons.reduce((sum, row) => sum + row.count, 0);
  }

  drill(userId: string): void {
    this.scope = 'team';
    this.userId = userId;
    this.load();
  }

  rate(r: Ratio | null): string {
    if (!r || !r.denominator) return '—';
    return `${Math.round((r.numerator / r.denominator) * 100)}%`;
  }

  amounts(list: { amountCents: number; currency: string }[]): string {
    if (!list.length) return money(0);
    const byCurrency = new Map<string, number>();
    for (const item of list) byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? 0) + item.amountCents);
    return [...byCurrency.entries()].map(([currency, cents]) => money(cents, currency)).join(' + ');
  }

  memberName(id: string | null): string {
    return this.members().find((m) => m.id === id)?.name ?? 'Selected person';
  }
}
