import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { WorkflowService } from '../../core/services/workflow.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import {
  CREDIT_LABELS, CreditItem, PendingClosing, PersonWork, WORK_TYPE_LABELS, WorkSessionItem, downloadCsv,
} from '../../core/models/workflow.model';
import { MoneyPipe } from '../sales/shared/sales-format';

type Tab = 'approvals' | 'people' | 'credits' | 'time';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Team work (ADR 0016): closing approvals, who did what and when,
 * qualification credits for compensation review, and recorded time. Counts
 * come from recorded facts; recorded time is what people chose to record.
 */
@Component({
  selector: 'app-team-work',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe],
  template: `
    <div class="page team-work">
      <header class="tw-head">
        <div><h1>Team work</h1><p class="sub">Approvals, attribution, compensation review and recorded time.</p></div>
        @if (tab() !== 'approvals') {
          <div class="filters">
            <label>From <input type="date" class="form-control" [(ngModel)]="from" (change)="reload()" /></label>
            <label>To <input type="date" class="form-control" [(ngModel)]="to" (change)="reload()" /></label>
            <select class="form-select" [(ngModel)]="userId" (change)="reload()" aria-label="Employee">
              <option value="">Everyone</option>
              @for (p of everyone(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
            </select>
          </div>
        }
      </header>

      <nav class="line-tabs" role="tablist">
        @if (canApprove()) { <button role="tab" [class.active]="tab() === 'approvals'" (click)="setTab('approvals')">Sales to approve @if (closings().length) { <span class="count">{{ closings().length }}</span> }</button> }
        @if (canReview()) {
          <button role="tab" [class.active]="tab() === 'people'" (click)="setTab('people')">People</button>
          <button role="tab" [class.active]="tab() === 'credits'" (click)="setTab('credits')">Qualification review</button>
          <button role="tab" [class.active]="tab() === 'time'" (click)="setTab('time')">Recorded time</button>
        }
      </nav>

      @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
      @if (notice()) { <div class="alert alert-success">{{ notice() }}</div> }
      @if (loading()) { <div class="loading-state"><div class="spinner"></div></div> }

      @switch (tab()) {
        @case ('approvals') {
          @for (c of closings(); track c.opportunityId) {
            <section class="card approval">
              <div class="ap-main">
                <h3><a [routerLink]="['/app/leads', c.opportunityId]">{{ c.businessName }}</a>@if (c.isExistingClient) { <span class="tag tag-muted">existing client</span> }</h3>
                <p class="muted">{{ c.city }}@if (c.state) {, {{ c.state }}} · submitted {{ c.submittedAt | date: 'MMM d, h:mm a' }} by {{ c.submittedBy?.name }} · salesperson {{ c.salesperson?.name || '—' }}@if (c.qualifiedBy) { · qualified by {{ c.qualifiedBy.name }} }</p>
                <dl class="facts">
                  <dt>Payment</dt><dd>
                    @if (c.payment) { <strong class="ok">{{ c.payment.amountCents | money: c.payment.currency }} confirmed</strong> {{ c.payment.paidAt | date: 'MMM d' }} · {{ c.payment.source === 'stripe' ? 'Stripe' + (c.payment.stripeMode && c.payment.stripeMode !== 'live' ? ' (' + c.payment.stripeMode + ')' : '') : 'recorded manually (' + c.payment.method + ')' }} }
                    @else { <strong class="warn">No confirmed payment</strong> — approving needs an exception reason }
                  </dd>
                  <dt>Offer</dt><dd>@if (c.offer) { {{ c.offer.title }} · {{ c.offer.initialAmountCents | money: c.offer.currency }}@if (c.offer.recurringAmountCents) { then {{ c.offer.recurringAmountCents | money: c.offer.currency }}/{{ c.offer.recurringInterval }} } · link {{ c.offer.status }} }
                    @else if (c.proposal) { {{ c.proposal.service }}@if (c.proposal.setupCents) { · {{ c.proposal.setupCents | money }} setup }@if (c.proposal.recurringCents) { · {{ c.proposal.recurringCents | money }}/{{ c.proposal.interval }} } } @else { — }</dd>
                  @if (c.note) { <dt>Note</dt><dd>{{ c.note }}</dd> }
                </dl>
              </div>
              <div class="ap-form">
                <select class="form-select" [(ngModel)]="approval[c.opportunityId].manager" aria-label="Client manager">
                  <option value="">Client manager…</option>
                  @for (m of managers(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }
                </select>
                @if (!c.payment) { <input class="form-control" [(ngModel)]="approval[c.opportunityId].exception" placeholder="Exception reason *" aria-label="Exception reason" /> }
                <button class="btn btn-primary btn-sm" (click)="approve(c)" [disabled]="busy()">Approve &amp; create client</button>
                <input class="form-control" [(ngModel)]="approval[c.opportunityId].reason" placeholder="Reason to return" aria-label="Reason to return" />
                <button class="btn btn-ghost btn-sm" (click)="returnSale(c)" [disabled]="busy() || !approval[c.opportunityId].reason.trim()">Return to sales</button>
              </div>
            </section>
          } @empty { @if (!loading()) { <div class="card empty">No sales are waiting for approval.</div> } }
        }
        @case ('people') {
          <div class="table-actions"><button class="btn btn-ghost btn-sm" (click)="exportPeople()">Export CSV</button></div>
          <div class="card table-wrap"><table class="table">
            <thead><tr><th>Person</th><th>Researched</th><th>Qualified</th><th>Accepted</th><th>Returned / rejected</th><th>Unsuitable / dup.</th><th>Downstream</th>
              <th>Attempts</th><th>Contacted</th><th>Replies</th><th>Follow-ups</th><th>Overdue</th><th>Meetings</th><th>Pricing</th><th>Paid</th><th>Approved</th><th>Time</th></tr></thead>
            <tbody>
              @for (p of people(); track p.user.id) {
                <tr>
                  <td><strong>{{ p.user.name }}</strong><br /><span class="muted">{{ p.user.roles.join(', ') }}</span></td>
                  <td>{{ p.qualifier.researched }}</td>
                  <td><button class="link-btn" (click)="drill(p, 'qualifications')">{{ p.qualifier.completed }}</button>@if (p.qualifier.assigned) { <span class="muted"> ({{ p.qualifier.assigned }} assigned)</span> }</td>
                  <td>{{ p.qualifier.accepted }}@if (p.qualifier.pending) { <span class="muted"> · {{ p.qualifier.pending }} pending</span> }</td>
                  <td>{{ p.qualifier.returned }} / {{ p.qualifier.rejected }}</td>
                  <td>{{ p.qualifier.unsuitable }} / {{ p.qualifier.duplicates }}</td>
                  <td class="muted">{{ p.qualifier.downstream.contacted }} contacted · {{ p.qualifier.downstream.meetings }} mtg · {{ p.qualifier.downstream.won }} won</td>
                  <td><button class="link-btn" (click)="drill(p, 'activities')">{{ p.sales.attempts }}</button>@if (p.sales.attemptsByChannel.length) { <br /><span class="muted">{{ channelText(p) }}</span> }</td>
                  <td>{{ p.sales.uniqueContacted }}</td>
                  <td>{{ p.sales.replies }}</td>
                  <td>{{ p.sales.followUpsDone }}</td>
                  <td [class.warn]="p.sales.overdueNow">{{ p.sales.overdueNow }}</td>
                  <td>{{ p.sales.meetings }}</td>
                  <td>{{ p.sales.pricingSent }}</td>
                  <td><button class="link-btn" (click)="drill(p, 'payments')">{{ p.sales.paymentsConfirmed }}</button></td>
                  <td>{{ p.sales.approvedClients }}</td>
                  <td><button class="link-btn" (click)="drill(p, 'time')">{{ hours(p.time.minutes) }}</button>@if (p.time.corrected) { <br /><span class="muted">{{ p.time.corrected }} corrected</span> }</td>
                </tr>
              } @empty { <tr><td colspan="17" class="muted">No recorded work in this range.</td></tr> }
            </tbody>
          </table></div>
          <p class="note">Counts are recorded facts in the date range. “Downstream” follows the leads a person qualified in the range. Time is what people recorded themselves — not tracked activity.</p>
          @if (drillRows(); as rows) {
            <section class="card drill">
              <header><h3>{{ drillTitle() }}</h3><button class="btn btn-ghost btn-sm" (click)="drillRows.set(null)">Close</button></header>
              <table class="table"><tbody>
                @for (r of rows; track $index) { <tr>@for (c of drillCols(); track c) { <td>{{ cell(r[c]) }}</td> }</tr> } @empty { <tr><td class="muted">Nothing recorded.</td></tr> }
              </tbody></table>
            </section>
          }
        }
        @case ('credits') {
          <div class="table-actions">
            <select class="form-select" [(ngModel)]="creditStatus" (change)="reload()" aria-label="Status">
              <option value="">Any status</option>@for (s of creditStatuses; track s) { <option [value]="s">{{ creditLabels[s] }}</option> }
            </select>
            <span class="spacer"></span>
            @if (selected().size) {
              <input class="form-control note-input" [(ngModel)]="reviewNote" placeholder="Note (needed to return or reject)" aria-label="Review note" />
              <button class="btn btn-outline btn-sm" (click)="review('accepted')" [disabled]="busy()">Accept</button>
              <button class="btn btn-ghost btn-sm" (click)="review('needs_correction')" [disabled]="busy()">Needs correction</button>
              <button class="btn btn-ghost btn-sm" (click)="review('rejected')" [disabled]="busy()">Reject</button>
              <button class="btn btn-primary btn-sm" (click)="review('paid')" [disabled]="busy()">Mark paid</button>
            }
            <button class="btn btn-ghost btn-sm" (click)="exportCredits()">Export CSV</button>
          </div>
          <div class="card table-wrap"><table class="table">
            <thead><tr><th><input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" aria-label="Select all" /></th><th>Completed</th><th>Qualifier</th><th>Business</th><th>Reason</th><th>Now</th><th>Corrections</th><th>Review</th></tr></thead>
            <tbody>
              @for (c of credits(); track c.id) {
                <tr>
                  <td><input type="checkbox" [checked]="selected().has(c.id)" (change)="toggle(c.id)" [attr.aria-label]="'Select ' + c.businessName" /></td>
                  <td>{{ c.earnedAt | date: 'MMM d' }}</td>
                  <td>{{ c.user.name }}</td>
                  <td><a [routerLink]="['/app/qualify', c.opportunityId]">{{ c.businessName }}</a><br /><span class="muted">{{ c.location }}</span></td>
                  <td class="reason">{{ c.reason }}</td>
                  <td class="muted">{{ c.qualificationLabel }} · {{ c.stageLabel }}@if (c.salesperson) { · {{ c.salesperson.name }} }@if (c.contacted) { · contacted }@if (c.paymentConfirmed) { · paid }</td>
                  <td>{{ c.correctionCount }}@if (c.lastCorrectionReason) { <br /><span class="muted">{{ c.lastCorrectionReason }}</span> }</td>
                  <td><span class="tag" [attr.data-status]="c.status">{{ creditLabels[c.status] }}</span>@if (c.reviewNote) { <br /><span class="muted">{{ c.reviewNote }}</span> }</td>
                </tr>
              } @empty { <tr><td colspan="8" class="muted">No qualifications in this range.</td></tr> }
            </tbody>
          </table></div>
          <p class="note">Reviewing a credit never moves the lead or holds up outreach. Pay rates aren’t set in Leadzaro — export accepted work to calculate pay. You can’t review your own work.</p>
        }
        @case ('time') {
          <div class="table-actions"><span class="muted">Total recorded: {{ hours(timeTotal()) }}</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" (click)="exportTime()">Export CSV</button></div>
          <div class="card table-wrap"><table class="table">
            <thead><tr><th>Person</th><th>Started</th><th>Work</th><th>Lead</th><th>Minutes</th><th>How</th><th>Note</th><th>Review</th></tr></thead>
            <tbody>
              @for (s of sessions(); track s.id) {
                <tr [class.warn]="s.status === 'abandoned'">
                  <td>{{ s.user?.name }}</td>
                  <td>{{ s.startedAt | date: 'MMM d, h:mm a' }}</td>
                  <td>{{ workTypes[s.workType] || s.workType }}</td>
                  <td>{{ s.businessName || '—' }}</td>
                  <td>{{ s.status === 'abandoned' ? 'left running — 0' : s.minutes }}@if (s.originalMinutes !== null) { <br /><span class="muted">was {{ s.originalMinutes }}: {{ s.correctionReason }}</span> }</td>
                  <td>{{ s.source === 'manual' ? 'Added by hand' : 'Timer' }}{{ s.status === 'running' || s.status === 'paused' ? ' (open)' : '' }}</td>
                  <td>{{ s.note }}</td>
                  <td>
                    <select class="form-select sm" [ngModel]="s.reviewStatus" (ngModelChange)="reviewTime(s, $event)" aria-label="Review">
                      <option value="unreviewed">Unreviewed</option><option value="approved">Approved</option><option value="flagged">Flagged</option>
                    </select>
                  </td>
                </tr>
              } @empty { <tr><td colspan="8" class="muted">No time recorded in this range.</td></tr> }
            </tbody>
          </table></div>
        }
      }
    </div>
  `,
  styles: [`
    .tw-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
      h1 { font-family: var(--font-display); font-size: 1.6rem; margin: 0; } .sub { color: var(--text-muted); margin: 4px 0 0; font-size: .875rem; } }
    .filters { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; label { font-size: .75rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 2px; } }
    .line-tabs { margin-bottom: 14px; }
    .approval { padding: 16px 18px; display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; margin-bottom: 12px; @media (max-width: 860px) { grid-template-columns: 1fr; }
      h3 { margin: 0; font-size: 1rem; display: flex; gap: 8px; align-items: center; } }
    .ap-form { display: flex; flex-direction: column; gap: 6px; }
    .facts { display: grid; grid-template-columns: 80px 1fr; gap: 4px 10px; margin: 8px 0 0; font-size: .85rem; dt { color: var(--text-muted); } dd { margin: 0; } }
    .ok { color: var(--success); } .warn { color: var(--danger-text); }
    .muted { color: var(--text-muted); font-size: .78rem; }
    .empty { padding: 20px; color: var(--text-muted); }
    .table-wrap { overflow-x: auto; }
    .table { width: 100%; font-size: .8125rem; td, th { vertical-align: top; } }
    .reason { max-width: 260px; }
    .table-actions { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; .spacer { flex: 1; } .note-input { width: 240px; } }
    .link-btn { background: none; border: 0; color: var(--primary); cursor: pointer; padding: 0; text-decoration: underline; font: inherit; }
    .note { font-size: .75rem; color: var(--text-muted); margin: 8px 0 16px; }
    .drill { padding: 14px 16px; header { display: flex; justify-content: space-between; align-items: center; h3 { margin: 0; font-size: .95rem; } } }
    .tag[data-status='accepted'], .tag[data-status='paid'] { background: var(--success-bg, #dcfce7); color: var(--success); }
    .tag[data-status='needs_correction'] { background: var(--warning-bg); }
    .tag[data-status='rejected'] { background: var(--danger-bg); color: var(--danger-text); }
    .form-select.sm { padding: 2px 6px; font-size: .78rem; }
    tr.warn td { background: var(--warning-bg); }
  `],
})
export class TeamWorkComponent implements OnInit {
  private readonly workflow = inject(WorkflowService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly org = inject(OrganizationContextService);

  readonly creditLabels = CREDIT_LABELS;
  readonly creditStatuses = Object.keys(CREDIT_LABELS);
  readonly workTypes = WORK_TYPE_LABELS;
  readonly tab = signal<Tab>('approvals');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly closings = signal<PendingClosing[]>([]);
  readonly managers = signal<{ id: string; name: string }[]>([]);
  readonly people = signal<PersonWork[]>([]);
  readonly everyone = signal<{ id: string; name: string }[]>([]);
  readonly credits = signal<CreditItem[]>([]);
  readonly sessions = signal<WorkSessionItem[]>([]);
  readonly timeTotal = signal(0);
  readonly selected = signal(new Set<string>());
  readonly drillRows = signal<Record<string, unknown>[] | null>(null);
  readonly drillTitle = signal('');
  readonly drillCols = signal<string[]>([]);
  readonly canApprove = computed(() => this.org.hasPermission('sales.approve_close'));
  readonly canReview = computed(() => this.org.hasPermission('team.review_work'));
  readonly allSelected = computed(() => this.credits().length > 0 && this.credits().every((c) => this.selected().has(c.id)));

  approval: Record<string, { manager: string; exception: string; reason: string }> = {};
  from = isoDay(new Date(Date.now() - 30 * 86400000));
  to = isoDay(new Date());
  userId = '';
  creditStatus = '';
  reviewNote = '';

  ngOnInit(): void {
    const requested = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    const fallback: Tab = this.canApprove() ? 'approvals' : 'people';
    this.tab.set(requested && (requested !== 'approvals' || this.canApprove()) && (requested === 'approvals' || this.canReview()) ? requested : fallback);
    if (this.canReview()) {
      this.workflow.teamWork({ from: this.from, to: `${this.to}T23:59:59` }).subscribe({
        next: (r) => this.everyone.set(r.people.map((p) => ({ id: p.user.id, name: p.user.name }))), error: () => undefined,
      });
    }
    this.reload();
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.drillRows.set(null);
    this.router.navigate([], { queryParams: { tab }, replaceUrl: true });
    this.reload();
  }

  private range() {
    return { from: this.from, to: `${this.to}T23:59:59`, userId: this.userId || undefined };
  }

  private fail = (err: { error?: { message?: string } }) => { this.loading.set(false); this.busy.set(false); this.error.set(err.error?.message || 'That didn’t load — try again.'); };

  reload(): void {
    this.error.set('');
    this.loading.set(true);
    switch (this.tab()) {
      case 'approvals':
        this.workflow.pendingClosings().subscribe({
          next: (r) => {
            this.closings.set(r.items);
            this.managers.set(r.clientManagers);
            for (const c of r.items) this.approval[c.opportunityId] ??= { manager: r.clientManagers.length === 1 ? r.clientManagers[0].id : '', exception: '', reason: '' };
            this.loading.set(false);
          },
          error: this.fail,
        });
        break;
      case 'people':
        this.workflow.teamWork(this.range()).subscribe({ next: (r) => { this.people.set(r.people); this.loading.set(false); }, error: this.fail });
        break;
      case 'credits':
        this.workflow.credits({ ...this.range(), status: this.creditStatus || undefined }).subscribe({
          next: (r) => { this.credits.set(r.items); this.selected.set(new Set()); this.loading.set(false); }, error: this.fail,
        });
        break;
      case 'time':
        this.workflow.timeEntries(this.range()).subscribe({ next: (r) => { this.sessions.set(r.items); this.timeTotal.set(r.totalMinutes); this.loading.set(false); }, error: this.fail });
        break;
      default: break;
    }
  }

  approve(c: PendingClosing): void {
    const a = this.approval[c.opportunityId];
    this.busy.set(true);
    this.workflow.approveClosing(c.opportunityId, { clientManagerUserId: a.manager || null, exceptionReason: a.exception || undefined }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notice.set(r.converted === false && r.error ? `${c.businessName} approved, but client setup failed: ${r.error}` : `${c.businessName} approved — client created and handed to onboarding.`);
        this.reload();
      },
      error: this.fail,
    });
  }

  returnSale(c: PendingClosing): void {
    this.busy.set(true);
    this.workflow.returnClosing(c.opportunityId, this.approval[c.opportunityId].reason).subscribe({
      next: () => { this.busy.set(false); this.notice.set(`${c.businessName} returned to sales.`); this.reload(); },
      error: this.fail,
    });
  }

  toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected.set(next);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.credits().map((c) => c.id)));
  }

  review(status: string): void {
    this.busy.set(true);
    this.workflow.reviewCredits([...this.selected()], status, this.reviewNote).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notice.set(`${r.updated.length} updated${r.skipped.length ? ` · ${r.skipped.length} skipped (not allowed from their current status, or your own work)` : ''}.`);
        this.reviewNote = '';
        this.reload();
      },
      error: this.fail,
    });
  }

  reviewTime(s: WorkSessionItem, reviewStatus: string): void {
    this.workflow.reviewTime(s.id, reviewStatus).subscribe({ next: (u) => this.sessions.set(this.sessions().map((x) => (x.id === u.id ? { ...x, reviewStatus: u.reviewStatus } : x))), error: this.fail });
  }

  drill(p: PersonWork, kind: string): void {
    const titles: Record<string, string> = {
      qualifications: 'Qualifications', activities: 'Outreach and logged activity', payments: 'Confirmed payments', time: 'Recorded time',
    };
    const cols: Record<string, string[]> = {
      qualifications: ['earnedAt', 'businessName', 'status', 'stageLabel'],
      activities: ['at', 'businessName', 'channel', 'direction', 'origin', 'status', 'outcome', 'subject'],
      payments: ['at', 'businessName', 'amountCents', 'source', 'stripeMode'],
      time: ['startedAt', 'workType', 'businessName', 'minutes', 'source', 'note'],
    };
    this.workflow.records({ ...this.range(), userId: p.user.id, kind }).subscribe({
      next: (r) => { this.drillTitle.set(`${titles[kind]} — ${p.user.name}`); this.drillCols.set(cols[kind]); this.drillRows.set(r.items); },
      error: this.fail,
    });
  }

  cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return String(value);
  }

  channelText(p: PersonWork): string {
    return p.sales.attemptsByChannel.map((c) => `${c.count} ${c.channel}`).join(', ');
  }

  hours(minutes: number): string {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }

  exportPeople(): void {
    downloadCsv(`team-work-${this.from}-to-${this.to}.csv`, [
      ['Person', 'Roles', 'Researched', 'Qualified', 'Assigned', 'Accepted', 'Pending review', 'Returned', 'Rejected', 'Unsuitable', 'Duplicates', 'Downstream contacted', 'Downstream won',
        'Attempts', 'Unique contacted', 'Conversations', 'Replies', 'Follow-ups done', 'Overdue now', 'Meetings', 'Pricing sent', 'Payments confirmed', 'Approved clients', 'Recorded minutes'],
      ...this.people().map((p) => [p.user.name, p.user.roles.join('; '), p.qualifier.researched, p.qualifier.completed, p.qualifier.assigned, p.qualifier.accepted, p.qualifier.pending,
        p.qualifier.returned, p.qualifier.rejected, p.qualifier.unsuitable, p.qualifier.duplicates, p.qualifier.downstream.contacted, p.qualifier.downstream.won,
        p.sales.attempts, p.sales.uniqueContacted, p.sales.conversations, p.sales.replies, p.sales.followUpsDone, p.sales.overdueNow, p.sales.meetings, p.sales.pricingSent,
        p.sales.paymentsConfirmed, p.sales.approvedClients, p.time.minutes]),
    ]);
  }

  exportCredits(): void {
    downloadCsv(`qualifications-${this.from}-to-${this.to}.csv`, [
      ['Completed', 'Qualifier', 'Business', 'Location', 'Reason', 'Review status', 'Review note', 'Reviewed by', 'Paid on', 'Corrections', 'Salesperson', 'Stage'],
      ...this.credits().map((c) => [isoDay(new Date(c.earnedAt)), c.user.name, c.businessName, c.location, c.reason, CREDIT_LABELS[c.status], c.reviewNote, c.reviewedBy?.name,
        c.paidAt ? isoDay(new Date(c.paidAt)) : '', c.correctionCount, c.salesperson?.name, c.stageLabel]),
    ]);
  }

  exportTime(): void {
    downloadCsv(`time-${this.from}-to-${this.to}.csv`, [
      ['Person', 'Started', 'Ended', 'Work', 'Lead', 'Minutes', 'Original minutes', 'Correction reason', 'Source', 'Status', 'Review', 'Note'],
      ...this.sessions().map((s) => [s.user?.name, s.startedAt, s.endedAt, WORK_TYPE_LABELS[s.workType] || s.workType, s.businessName, s.status === 'abandoned' ? 0 : s.minutes,
        s.originalMinutes, s.correctionReason, s.source, s.status, s.reviewStatus, s.note]),
    ]);
  }
}
