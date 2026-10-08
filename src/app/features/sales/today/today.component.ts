import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { SalesService } from '../../../core/services/sales.service';
import { WorkQueueService } from '../../../core/services/work-queue.service';
import { AuthService } from '../../../core/services/auth.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { LeadCard, OPEN_STAGES, STAGE_LABELS, TodayData } from '../../../core/models/sales.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import {
  MoneyPipe, RelativeDayPipe, isOverdue, nextActionLabel,
} from '../shared/sales-format';

interface Section {
  key: keyof Pick<TodayData, 'replies' | 'overdue' | 'dueToday' | 'payments' | 'handoffs' | 'activeDeals' | 'stalled' | 'newLeads'>;
  title: string;
  hint: string;
  tone: 'danger' | 'warning' | 'primary' | 'info' | 'success' | 'muted';
  icon: string;
}

const SECTIONS: Section[] = [
  { key: 'replies', title: 'Replies waiting on you', hint: 'They answered — reply first.', tone: 'danger', icon: 'message' },
  { key: 'overdue', title: 'Overdue follow-ups', hint: 'Scheduled before today and not done yet.', tone: 'warning', icon: 'clock' },
  { key: 'dueToday', title: 'Due today', hint: 'Next steps you scheduled for today.', tone: 'primary', icon: 'calendar' },
  { key: 'payments', title: 'Payments pending', hint: 'Payment links that are unsent, unpaid, failed or expired.', tone: 'warning', icon: 'card' },
  { key: 'handoffs', title: 'Handoffs needing info', hint: 'Paid clients the delivery team is waiting on.', tone: 'info', icon: 'handoff' },
  { key: 'activeDeals', title: 'Warm deals needing a step', hint: 'Interested or in proposal, with no next step scheduled.', tone: 'primary', icon: 'target' },
  { key: 'stalled', title: 'Stalled deals', hint: 'No recorded activity for longer than their stage allows — re-engage or park them in Nurture.', tone: 'warning', icon: 'alert' },
  { key: 'newLeads', title: 'New leads to contact', hint: 'Assigned to you and never contacted.', tone: 'muted', icon: 'leads' },
];

const REASONS = [
  { key: 'reply', label: 'Replies' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_today', label: 'Due today' },
  { key: 'payment', label: 'Payments' },
  { key: 'stalled', label: 'Stalled' },
  { key: 'new_lead', label: 'New leads' },
  { key: 'no_next_step', label: 'No next step' },
];

/**
 * Today (ADR 0011): the daily starting point — what needs attention, in
 * priority order, and the button that starts working through it.
 */
@Component({
  selector: 'app-today',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, IconComponent, DialogComponent, MoneyPipe, RelativeDayPipe],
  templateUrl: './today.component.html',
  styleUrl: './today.component.scss',
})
export class TodayComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly router = inject(Router);
  readonly queue = inject(WorkQueueService);
  readonly auth = inject(AuthService);
  readonly org = inject(OrganizationContextService);

  readonly sections = SECTIONS;
  readonly reasons = REASONS;
  readonly stageOptions = OPEN_STAGES.map((key) => ({ key, label: STAGE_LABELS[key] }));
  readonly data = signal<TodayData | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly scope = signal<'mine' | 'team'>('mine');
  readonly canSeeTeam = computed(() => this.org.hasPermission('sales.view_team'));

  readonly showQueueDialog = signal(false);
  readonly starting = signal(false);
  readonly queueError = signal('');
  selectedReasons = new Set(REASONS.map((r) => r.key));
  queueStage = '';

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = this.auth.currentUser()?.name?.split(' ')[0];
    return name ? `${part}, ${name}` : part;
  });

  readonly totalAttention = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return d.replies.length + d.overdue.length + d.dueToday.length + d.payments.length + d.handoffs.length + d.activeDeals.length + (d.stalled?.length ?? 0) + d.newLeads.length;
  });

  readonly nextActionLabel = nextActionLabel;
  readonly isOverdue = isOverdue;
  readonly today = new Date();

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.sales.today(this.scope()).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); this.error.set(''); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'Today could not be loaded. Check your connection and try again.'); },
    });
  }

  setScope(scope: 'mine' | 'team'): void {
    this.scope.set(scope);
    this.load();
  }

  items(section: Section): LeadCard[] {
    return (this.data()?.[section.key] as LeadCard[]) ?? [];
  }

  toggleReason(key: string): void {
    if (this.selectedReasons.has(key)) this.selectedReasons.delete(key);
    else this.selectedReasons.add(key);
  }

  openQueueDialog(): void {
    const filters = this.queue.filters();
    if (filters.reasons.length) this.selectedReasons = new Set(filters.reasons);
    this.queueStage = filters.stage || '';
    this.queueError.set('');
    this.showQueueDialog.set(true);
  }

  startQueue(): void {
    if (!this.selectedReasons.size) {
      this.queueError.set('Choose at least one kind of lead to work on.');
      return;
    }
    this.starting.set(true);
    const reasons = [...this.selectedReasons];
    this.sales.queue({ reasons, stage: this.queueStage || undefined }).subscribe({
      next: (res) => {
        this.starting.set(false);
        if (!res.items.length) {
          this.queueError.set('Nothing matches — you’re caught up on these. Try including more kinds of leads.');
          return;
        }
        const first = this.queue.start(res.items, { reasons, stage: this.queueStage });
        this.showQueueDialog.set(false);
        if (first) this.router.navigate(['/app/leads', first.opportunityId], { queryParams: { queue: 1 } });
      },
      error: (err) => { this.starting.set(false); this.queueError.set(err.error?.message || 'The queue could not be built.'); },
    });
  }

  resumeQueue(): void {
    const current = this.queue.current();
    if (current) this.router.navigate(['/app/leads', current.opportunityId], { queryParams: { queue: 1 } });
  }

  goalPercent(actual: number, target: number | null): number {
    if (!target) return 0;
    return Math.min(100, Math.round((actual / target) * 100));
  }
}
