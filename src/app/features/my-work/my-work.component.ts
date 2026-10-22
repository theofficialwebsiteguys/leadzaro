import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WorkflowService } from '../../core/services/workflow.service';
import { SalesService } from '../../core/services/sales.service';
import { WorkQueueService } from '../../core/services/work-queue.service';
import { AuthService } from '../../core/services/auth.service';
import { WorkModeService } from '../../core/services/work-mode.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { MyWork, WorkCard } from '../../core/models/workflow.model';
import { QueueItem } from '../../core/models/sales.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { nextActionLabel, relativeDay, suggestDate } from '../sales/shared/sales-format';

const ALL_REASONS = ['reply', 'overdue', 'due_today', 'payment', 'new_lead', 'stalled', 'no_next_step'];

/** One useful line of work: what it is, where it stands, why, what happened last and what's next — and one main action. */
interface Row {
  key: string;
  link: unknown[];
  query?: Record<string, unknown>;
  title: string;
  where?: string | null;
  status?: string | null;
  reason?: string | null;
  last?: string | null;
  next?: string | null;
  tone?: string;
  action: string;
  /** A sales lead that can be rescheduled or parked from here. */
  opportunityId?: string;
  stage?: string;
  nextType?: string | null;
  detail?: string | null;
}

interface Queue { key: string; label: string; hint: string; tone?: string; rows: Row[]; total?: number; empty: string; work?: boolean }

interface QualifySession { label: string; items: { id: string; name: string }[]; index: number }

/**
 * My Work (ADR 0016, revised by ADR 0017): every role's daily queue and
 * starting point. It answers what to do next, what needs attention today,
 * what's underway, and what happened to work handed off. Counts open the
 * matching queue; each row says why it's there and offers one main
 * action, with details — reschedule, park — one click away.
 */
@Component({
  selector: 'app-my-work',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="my-work">
      <p class="hello">{{ greeting() }}</p>
      @if (finished()) { <div class="alert alert-success">Queue finished — nice work.</div> }
      @if (error()) { <div class="alert alert-error">{{ error() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @if (notice()) { <div class="alert alert-success" role="status">{{ notice() }}</div> }

      @let d = data();
      @if (!d) {
        <div class="loading-state"><div class="spinner"></div></div>
      } @else if (!mode()) {
        <section class="card hero"><h1>Welcome</h1><p>Your account doesn’t have a work role yet. Ask an admin to add one in Settings → Team.</p></section>
      } @else {
        <!-- What to do next -->
        <section class="card hero">
          @switch (mode()) {
            @case ('sales') {
              <p class="eyebrow">Next up</p>
              @if (d.sales?.continueWith; as c) {
                <h1>Pick up {{ c.businessName }}</h1>
                <p>You were working on it {{ when(c.at) }}.@if (c.nextActionAt) { Next: {{ nextLabel(c.nextActionType) }} {{ when(c.nextActionAt) }}. }</p>
                <div class="hero-actions">
                  <a class="btn btn-primary btn-xl" [routerLink]="['/app/work', c.opportunityId]"><lz-icon name="play" [size]="18" /> Continue</a>
                  @if (queue().length) { <button class="btn btn-ghost" (click)="workNext()">or start the main track ({{ queue().length }})</button> }
                </div>
              } @else {
                <h1>@if (queue().length) { {{ queue().length }} lead{{ queue().length === 1 ? '' : 's' }} to work } @else { You’re all caught up }</h1>
                <p>@if (queue().length) { Replies first, then overdue and today’s follow-ups, then new leads — one at a time, with the next step laid out. } @else { No replies, follow-ups or new leads are waiting. }</p>
                @if (queue().length) { <div class="hero-actions"><button class="btn btn-primary btn-xl" (click)="workNext()"><lz-icon name="play" [size]="18" /> Start working</button></div> }
              }
            }
            @case ('qualifier') {
              @let dr = d.qualifier?.drafts?.[0];
              <p class="eyebrow">Next up</p>
              @if (session(); as s) {
                <h1>Continue “{{ s.label }}”</h1>
                <p>Business {{ s.index + 1 }} of {{ s.items.length }} — {{ s.items.length - s.index }} still to research.</p>
                <div class="hero-actions"><a routerLink="/app/qualify" class="btn btn-primary btn-xl"><lz-icon name="play" [size]="18" /> Continue qualifying</a><a routerLink="/app/qualify/new" class="btn btn-ghost">or add one by hand</a></div>
              } @else if (dr) {
                <h1>Finish {{ dr.businessName }}</h1>
                <p>You stopped at step {{ dr.step }} of 5, {{ when(dr.updatedAt) }}. It’s saved — pick up where you left off.</p>
                <div class="hero-actions"><a class="btn btn-primary btn-xl" [routerLink]="['/app/qualify/resume', dr.key]"><lz-icon name="play" [size]="18" /> Resume</a><a routerLink="/app/qualify" class="btn btn-ghost">or find new businesses</a></div>
              } @else {
                <h1>Qualify businesses</h1>
                <p>Pick what and where, then go through the businesses one at a time: worth it or not, links, contact, reason, decide.</p>
                <div class="hero-actions"><a routerLink="/app/qualify" class="btn btn-primary btn-xl"><lz-icon name="play" [size]="18" /> Start qualifying</a><a routerLink="/app/qualify/new" class="btn btn-ghost">or add one by hand</a></div>
              }
              @if (d.qualifier; as q) { <p class="stat">{{ q.stats.completedThisWeek }} completed this week · {{ q.stats.pendingReview }} waiting for review · {{ q.stats.accepted }} accepted</p> }
            }
            @case ('client_manager') {
              @let first = firstRow();
              <p class="eyebrow">Next up</p>
              <h1>@if (first) { Onboard {{ first.title }} } @else { No onboarding waiting }</h1>
              <p>Collect what the team needs to start: details, branding, content, requirements and access.</p>
              @if (first) { <div class="hero-actions"><a class="btn btn-primary btn-xl" [routerLink]="first.link"><lz-icon name="play" [size]="18" /> Start</a></div> }
            }
            @case ('admin') {
              <p class="eyebrow">Next up</p>
              <h1>@if (adminTotal()) { {{ adminTotal() }} thing{{ adminTotal() === 1 ? '' : 's' }} need you } @else { Nothing waiting on you }</h1>
              <p>Approve sales, settle possible duplicates, review qualifications and fix team time.</p>
            }
          }
        </section>

        <!-- Counts that open their queue -->
        @if (queues().length) {
          <div class="chips" role="tablist" aria-label="Queues">
            @for (qq of queues(); track qq.key) {
              <button type="button" role="tab" class="qchip" [attr.data-tone]="qq.tone" [class.on]="qq.key === selected()?.key" [attr.aria-selected]="qq.key === selected()?.key" (click)="select(qq.key)">
                <span class="n">{{ qq.total ?? qq.rows.length }}</span><span class="l">{{ qq.label }}</span>
              </button>
            }
          </div>
        }

        @if (selected(); as sq) {
          <div class="list-head">
            <div><h2 class="list-title">{{ sq.label }}</h2><p class="list-hint">{{ sq.hint }}</p></div>
            @if (sq.work && sq.rows.length > 1) { <button class="btn btn-outline btn-sm" (click)="workQueue(sq)"><lz-icon name="play" [size]="12" /> Work through these</button> }
          </div>
          @if (!sq.rows.length) {
            <p class="empty card">{{ sq.empty }}</p>
          } @else {
            <ul class="rows card">
              @for (r of sq.rows.slice(0, 25); track r.key) {
                <li [class.open]="expanded() === r.key">
                  <div class="row">
                    <button type="button" class="expand" (click)="toggle(r.key)" [attr.aria-expanded]="expanded() === r.key" [attr.aria-label]="'Details for ' + r.title"><lz-icon name="chevron-right" [size]="14" /></button>
                    <div class="main">
                      <div class="line1"><strong>{{ r.title }}</strong>@if (r.where) { <span class="muted"> · {{ r.where }}</span> }@if (r.status) { <span class="status" [attr.data-tone]="r.tone">{{ r.status }}</span> }</div>
                      @if (r.reason) { <div class="reason">{{ r.reason }}</div> }
                      <div class="meta">
                        @if (r.last) { <span><lz-icon name="clock" [size]="11" /> {{ r.last }}</span> }
                        @if (r.next) { <span class="next"><lz-icon name="arrow-right" [size]="11" /> {{ r.next }}</span> }
                      </div>
                    </div>
                    <a class="btn btn-sm" [class.btn-primary]="$first" [class.btn-outline]="!$first" [routerLink]="r.link" [queryParams]="sq.work && r.opportunityId && mode() === 'sales' ? { queue: 1 } : (r.query ?? null)" (click)="openFrom(sq, r)">{{ r.action }}</a>
                  </div>
                  @if (expanded() === r.key) {
                    <div class="details">
                      @if (r.detail) { <p>{{ r.detail }}</p> }
                      @if (r.opportunityId && mode() === 'sales') {
                        <div class="inline-actions">
                          <span class="muted">Reschedule:</span>
                          @for (o of snoozes; track o.days) { <button class="btn btn-ghost btn-sm" (click)="reschedule(r, o.days)" [disabled]="busy()">{{ o.label }}</button> }
                          @if (canPark(r)) { <button class="btn btn-ghost btn-sm" (click)="park(r)" [disabled]="busy()">Park in nurture (3 months)</button> }
                        </div>
                      }
                      @if (!r.detail && !(r.opportunityId && mode() === 'sales')) { <p class="muted">Nothing more to show — open it for the full picture.</p> }
                    </div>
                  }
                </li>
              }
            </ul>
            @if (sq.rows.length > 25) { <p class="more">and {{ sq.rows.length - 25 }} more</p> }
          }
        }
        @if (d.timer.abandoned) { <p class="note"><a routerLink="/app/time">You left a timer running — fix it</a> so your time counts.</p> }
      }
    </div>
  `,
  styles: [`
    .my-work { max-width: 820px; margin: 0 auto; padding: 8px 4px 40px; }
    .hello { color: var(--text-muted); margin: 0 0 10px; font-size: .9rem; }
    .hero { padding: 26px 28px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
      h1 { font-family: var(--font-display); font-size: 1.55rem; margin: 0; letter-spacing: -.02em; } p { margin: 0; color: var(--text-muted); }
      @media (max-width: 520px) { padding: 20px 18px; h1 { font-size: 1.3rem; } } }
    .btn-xl { padding: 13px 24px; font-size: 1.02rem; border-radius: 12px; display: inline-flex; gap: 8px; align-items: center; }
    .hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    .eyebrow { margin: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--primary); font-weight: 700; }
    .stat { font-size: .82rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 6px; }
    .qchip { --c: var(--primary); display: inline-flex; align-items: baseline; gap: 6px; border: 1px solid var(--border); border-bottom: 3px solid var(--c); background: var(--card); border-radius: 10px; padding: 8px 12px; cursor: pointer; color: var(--text-secondary);
      &[data-tone='danger'] { --c: var(--danger); } &[data-tone='warning'] { --c: var(--warning); } &[data-tone='success'] { --c: var(--success); } &[data-tone='muted'] { --c: #94a3b8; }
      .n { font-weight: 800; font-size: 1.05rem; color: var(--text-primary); font-family: var(--font-display); } .l { font-size: .82rem; }
      &.on { background: var(--primary-50); border-color: var(--primary-200); border-bottom-color: var(--c); color: var(--primary-dark); }
      &:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; } }
    .list-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; margin: 16px 0 8px; flex-wrap: wrap; }
    .list-title { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); margin: 0; }
    .list-hint { margin: 2px 0 0; font-size: .8rem; color: var(--text-muted); }
    .empty { padding: 18px; color: var(--text-muted); font-size: .88rem; margin: 0; }
    .rows { list-style: none; margin: 0; padding: 4px; }
    .rows li { border-radius: var(--radius); &:hover, &.open { background: var(--bg); } & + li { border-top: 1px solid var(--border); } }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px 8px; }
    .expand { background: none; border: 0; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; flex-shrink: 0; lz-icon { transition: transform .15s; } }
    li.open .expand lz-icon { transform: rotate(90deg); }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .line1 { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; strong { color: var(--text-primary); font-size: .95rem; } }
    .status { font-size: .7rem; font-weight: 600; border-radius: var(--radius-full); padding: 1px 8px; background: var(--bg-2); color: var(--text-secondary);
      &[data-tone='danger'] { background: var(--danger-bg); color: var(--danger-text); } &[data-tone='warning'] { background: var(--warning-bg); color: var(--warning-text, #92400e); }
      &[data-tone='success'] { background: var(--success-bg, #dcfce7); color: var(--success); } }
    .reason { font-size: .82rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: .75rem; color: var(--text-muted); span { display: inline-flex; gap: 4px; align-items: center; } .next { color: var(--text-secondary); } }
    .details { padding: 0 12px 12px 42px; font-size: .84rem; color: var(--text-secondary); p { margin: 0 0 6px; } }
    .inline-actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .muted { color: var(--text-muted); }
    .more, .note { font-size: .8rem; color: var(--text-muted); margin: 8px 4px; }
    @media (max-width: 560px) { .row { flex-wrap: wrap; } .row .btn { margin-left: 34px; } .reason { white-space: normal; } }
  `],
})
export class MyWorkComponent implements OnInit {
  private readonly workflow = inject(WorkflowService);
  private readonly sales = inject(SalesService);
  private readonly workQueueService = inject(WorkQueueService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly workMode = inject(WorkModeService);
  private readonly org = inject(OrganizationContextService);

  readonly mode = this.workMode.mode;
  readonly data = signal<MyWork | null>(null);
  readonly queue = signal<QueueItem[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal(false);
  readonly finished = signal(false);
  readonly expanded = signal<string | null>(null);
  private readonly chosen = signal<string | null>(null);
  readonly session = signal<QualifySession | null>(this.readSession());
  readonly snoozes = [{ days: 1, label: 'Tomorrow' }, { days: 3, label: 'In 3 days' }, { days: 7, label: 'Next week' }];
  readonly when = relativeDay;
  readonly nextLabel = nextActionLabel;

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = this.auth.currentUser()?.name?.split(' ')[0];
    return name ? `${part}, ${name}` : part;
  });

  readonly adminTotal = computed(() => {
    const a = this.data()?.admin;
    return a ? a.closingsToApprove + a.creditsToReview + a.abandonedTimers + a.readyForAssignment + a.failedHandoffs + (a.duplicatesToReview ?? 0) : 0;
  });

  /** The queues for the role being worked, in the order they should be worked. */
  readonly queues = computed<Queue[]>(() => {
    const d = this.data();
    if (!d) return [];
    switch (this.mode()) {
      case 'sales': return this.salesQueues(d);
      case 'qualifier': return this.qualifierQueues(d);
      case 'client_manager': return this.clientQueues(d);
      case 'admin': return this.adminQueues(d);
      default: return [];
    }
  });

  readonly firstRow = computed<Row | null>(() => this.queues().find((q) => q.rows.length)?.rows[0] ?? null);

  readonly selected = computed<Queue | null>(() => {
    const list = this.queues();
    return list.find((q) => q.key === this.chosen()) ?? list.find((q) => q.rows.length) ?? list[0] ?? null;
  });

  constructor() {
    // Switching "Working as" reloads only what that role needs.
    effect(() => {
      if (this.mode() === 'sales') this.loadQueue();
    });
  }

  ngOnInit(): void {
    this.finished.set(this.route.snapshot.queryParamMap.get('finished') === '1');
    this.chosen.set(this.route.snapshot.queryParamMap.get('queue'));
    this.load();
  }

  load(): void {
    this.error.set('');
    this.workflow.myWork().subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(err.error?.message || 'My Work could not be loaded.'),
    });
  }

  private loadQueue(): void {
    this.sales.queue({ reasons: ALL_REASONS }).subscribe({ next: (r) => this.queue.set(r.items), error: () => this.queue.set([]) });
  }

  /** A count opens its queue; the choice is in the address so refresh and back keep it. */
  select(key: string): void {
    this.chosen.set(key);
    this.expanded.set(null);
    this.router.navigate([], { queryParams: { queue: key, finished: null }, replaceUrl: true });
  }

  toggle(key: string): void {
    this.expanded.set(this.expanded() === key ? null : key);
  }

  // ---- rows for each role

  private salesRow(c: WorkCard | QueueItem, action: string, extra: Partial<Row> = {}): Row {
    const card = c as WorkCard & QueueItem;
    const last = card.lastInteractionAt ? `${card.lastInteractionSummary || 'Last activity'} · ${relativeDay(card.lastInteractionAt)}` : 'Not contacted yet';
    const next = card.replyNeededSince ? `They replied ${relativeDay(card.replyNeededSince)} — reply` : (card.nextActionAt ? `${nextActionLabel(card.nextActionType)} ${relativeDay(card.nextActionAt)}${card.nextActionNote ? ` — ${card.nextActionNote}` : ''}` : 'No next step set');
    return {
      key: card.opportunityId,
      link: ['/app/work', card.opportunityId],
      title: card.businessName,
      where: card.city ?? null,
      status: card.pendingAcceptance ? 'New — not accepted yet' : (card.lifecycleLabel || card.stageLabel || null),
      reason: card.outreachReason ? `Why: ${card.outreachReason}` : null,
      last,
      next,
      action,
      opportunityId: card.opportunityId,
      stage: card.stage,
      nextType: card.nextActionType ?? null,
      detail: card.outreachReason || null,
      ...extra,
    };
  }

  private salesQueues(d: MyWork): Queue[] {
    const s = d.sales;
    if (!s) return [];
    const byReason = (reason: string) => this.queue().filter((q) => q.reason === reason);
    const closing = s.closing.filter((c) => c.closingStatus !== 'submitted');
    return [
      { key: 'new', label: 'New from qualifiers', hint: 'Qualified and assigned to you — accept, then make first contact.', tone: 'primary', rows: s.newlyAssigned.map((c) => this.salesRow(c, c.pendingAcceptance ? 'Accept & start' : 'Start', { status: c.pendingAcceptance ? 'New — not accepted yet' : 'Accepted', detail: c.qualifiedBy ? `Qualified by ${c.qualifiedBy.name}${c.reason ? `: ${c.reason}` : ''}` : (c.reason ?? null), tone: 'success' })), empty: 'Nothing new from qualifiers.', work: true },
      { key: 'replies', label: 'Replies', hint: 'They answered — reply first.', tone: 'danger', rows: byReason('reply').map((q) => this.salesRow(q, 'Reply', { tone: 'danger' })), empty: 'No one is waiting on a reply from you.', work: true },
      { key: 'overdue', label: 'Overdue', hint: 'Follow-ups whose date has passed, oldest first.', tone: 'warning', rows: byReason('overdue').map((q) => this.salesRow(q, 'Follow up', { tone: 'warning' })), empty: 'No overdue follow-ups.', work: true },
      { key: 'today', label: 'Due today', hint: 'Today’s follow-ups, including parked leads whose date has come.', rows: byReason('due_today').map((q) => this.salesRow(q, 'Follow up')), empty: 'Nothing else is due today.', work: true },
      { key: 'waiting', label: 'Awaiting their reply', hint: 'You reached out and the next step is later — underway, nothing to do yet.', tone: 'muted', rows: s.awaitingReply.map((c) => this.salesRow(c, 'Open')), empty: 'No conversations waiting on them.' },
      { key: 'new_leads', label: 'Not contacted', hint: 'Leads you own that nobody has contacted yet.', rows: byReason('new_lead').map((q) => this.salesRow(q, 'Reach out')), empty: 'Every lead you own has been contacted.', work: true },
      { key: 'payments', label: 'Payments', hint: 'Payment links to send or follow up on.', tone: 'success', rows: byReason('payment').map((q) => this.salesRow(q, 'Open')), empty: 'No payment links need you.', work: true },
      { key: 'meetings', label: 'Meetings', hint: 'Booked meetings — record how they went.', rows: s.meetings.map((c) => this.salesRow(c, 'Open', { next: c.at ? `Meeting ${relativeDay(c.at)}${c.method ? ` · ${c.method}` : ''}` : null })), empty: 'No meetings booked.' },
      { key: 'closing', label: 'Closing', hint: 'Paid or sent back — submit for approval.', tone: 'success', rows: closing.map((c) => this.salesRow(c, c.closingStatus === 'returned' ? 'Fix & resubmit' : 'Submit', { status: c.closingStatus === 'returned' ? 'Sent back' : 'Payment received', detail: c.reviewNote ?? null })), empty: 'Nothing to close right now.' },
      { key: 'stalled', label: 'Stalled', hint: 'Gone quiet, or no next step — re-engage or park them.', tone: 'muted', rows: [...byReason('stalled'), ...byReason('no_next_step')].map((q) => this.salesRow(q, 'Re-engage')), empty: 'Nothing has gone quiet.', work: true },
    ].filter((q) => q.rows.length || ['new', 'replies', 'overdue', 'today'].includes(q.key));
  }

  private qualifierQueues(d: MyWork): Queue[] {
    const q = d.qualifier;
    if (!q) return [];
    const card = (c: WorkCard, action: string, extra: Partial<Row> = {}): Row => ({
      key: c.opportunityId,
      link: ['/app/qualify', c.opportunityId],
      title: c.businessName,
      where: c.city ?? null,
      status: c.statusLabel ?? null,
      reason: c.note ? `Note: ${c.note}` : (c.reason ? `Why: ${c.reason}` : null),
      last: c.updatedAt ? `Updated ${relativeDay(c.updatedAt)}` : null,
      action,
      detail: c.reason ?? null,
      ...extra,
    });
    const drafts: Row[] = (q.drafts ?? []).map((dr) => ({
      key: dr.key, link: ['/app/qualify/resume', dr.key], title: dr.businessName, where: dr.city, status: `Step ${dr.step} of 5`, last: `Saved ${relativeDay(dr.updatedAt)}`, action: 'Resume',
    }));
    const legacy = q.inProgress.filter((c) => c.status === 'draft').map((c) => card(c, 'Continue', { status: `Step ${c.step} of 5` }));
    return [
      { key: 'resume', label: 'In progress', hint: 'Research you started — saved, ready to pick up.', rows: [...drafts, ...legacy], empty: 'Nothing half-done. Start qualifying to find new businesses.' },
      { key: 'returned', label: 'Returned to you', hint: 'Sales or a reviewer sent these back — the reason is on each.', tone: 'danger', rows: [
        ...q.corrections.map((c) => card(c, 'Fix', { tone: 'danger', reason: c.note ? `Sent back: ${c.note}` : null })),
        ...q.feedback.map((f) => ({
          key: `fb-${f.opportunityId}`, link: ['/app/qualify', f.opportunityId], title: f.businessName, status: f.status === 'rejected' ? 'Not accepted' : 'Feedback', tone: 'warning', reason: f.note, last: `Reviewed ${relativeDay(f.reviewedAt)}`, action: 'View',
        })),
      ], empty: 'Nothing has been sent back.' },
      { key: 'needs_info', label: 'Needs more info', hint: 'Parked until someone finds a way to reach them.', tone: 'warning', rows: q.inProgress.filter((c) => c.status === 'needs_research').map((c) => card(c, 'Continue')), empty: 'Nothing parked for more information.' },
      { key: 'review', label: 'Duplicate check', hint: 'Saved separately — a manager is checking whether they’re already in Leadzaro.', tone: 'muted', rows: (q.needsReview ?? []).map((c) => card(c, 'View')), empty: 'Nothing waiting on a duplicate check.' },
      { key: 'ready', label: 'Ready to assign', hint: 'Qualified, waiting for a salesperson.', tone: 'success', rows: q.ready.map((c) => card(c, this.org.hasPermission('leads.assign') ? 'Assign' : 'View', { status: 'Qualified' })), empty: 'Nothing waiting for assignment.' },
      { key: 'handoffs', label: 'Recent handoffs', hint: 'What happened after you handed them to sales (last 3 weeks).', tone: 'muted', rows: (q.handoffs ?? []).map((c) => ({
        key: `h-${c.opportunityId}`,
        link: ['/app/qualify', c.opportunityId],
        title: c.businessName,
        where: c.city ?? null,
        status: c.lifecycleLabel ?? null,
        reason: c.assignedTo ? `With ${c.assignedTo.name}${c.acceptedAt ? ` · accepted ${relativeDay(c.acceptedAt)}` : ' · not accepted yet'}` : null,
        last: c.contactedAt ? `Contacted ${relativeDay(c.contactedAt)}` : 'Not contacted yet',
        next: c.qualifiedAt ? `Handed off ${relativeDay(c.qualifiedAt)}` : null,
        action: 'View',
        detail: c.reason ?? null,
      })), empty: 'No handoffs in the last three weeks.' },
    ].filter((x) => x.rows.length || ['resume', 'returned'].includes(x.key));
  }

  private clientQueues(d: MyWork): Queue[] {
    const cm = d.clientManager;
    if (!cm) return [];
    const rows: Row[] = [...cm.newHandoffs, ...cm.incomplete].map((h) => ({
      key: h.opportunityId,
      link: ['/app/onboarding', h.opportunityId],
      title: h.businessName,
      status: h.status === 'failed' ? 'Setup failed' : `${h.openItems} item${h.openItems === 1 ? '' : 's'} to collect`,
      tone: h.status === 'failed' ? 'danger' : undefined,
      reason: h.status === 'failed' ? 'Client setup failed — ask an admin' : null,
      action: 'Open',
    }));
    const clients: Row[] = cm.clients.map((c) => ({
      key: c.id, link: ['/app/clients', c.id], title: c.name, next: c.nextActionAt ? `${c.nextActionNote || 'Next step'} ${relativeDay(c.nextActionAt)}` : null, reason: c.waitingOn ? `Waiting on: ${c.waitingOn}` : null, action: 'Open',
    }));
    return [
      { key: 'onboarding', label: 'Onboarding', hint: 'New clients to set up.', rows, empty: 'No onboarding waiting.' },
      { key: 'clients', label: 'Your clients', hint: 'Clients you look after.', tone: 'muted', rows: clients, empty: 'No clients assigned to you yet.' },
    ];
  }

  private adminQueues(d: MyWork): Queue[] {
    const a = d.admin;
    if (!a) return [];
    const link = (title: string, n: number, sub: string, tab: string, tone?: string): Row => ({
      key: tab, link: ['/app/team-work'], query: { tab }, title, status: `${n} waiting`, reason: sub, tone, action: 'Review',
    });
    const reviews: Row[] = (a.reviews ?? []).map((r) => ({
      key: r.opportunityId, link: ['/app/qualify', r.opportunityId], title: r.businessName, where: r.city ?? null, status: 'Possible duplicate', tone: 'warning',
      reason: r.matches?.length ? `May be: ${r.matches.join(', ')}` : null, last: r.researcher ? `Saved by ${r.researcher.name} ${relativeDay(r.updatedAt)}` : null, action: 'Settle',
    }));
    const ready: Row[] = (d.qualifier?.ready ?? []).map((c) => ({
      key: c.opportunityId, link: ['/app/qualify', c.opportunityId], title: c.businessName, where: c.city ?? null, status: 'Qualified', reason: c.reason ? `Why: ${c.reason}` : null, last: c.researcher ? `By ${c.researcher.name}` : null, action: 'Assign',
    }));
    const other: Row[] = [];
    if (a.closingsToApprove) other.push(link('Sales to approve', a.closingsToApprove, 'Check the payment, choose a client manager, approve', 'approvals', 'success'));
    if (a.creditsToReview) other.push(link('Qualifications to review', a.creditsToReview, 'Accept, send back or mark paid', 'credits'));
    if (a.abandonedTimers) other.push(link('Timers left running', a.abandonedTimers, 'They count as zero until corrected', 'time', 'warning'));
    if (a.failedHandoffs) other.push({ key: 'failed', link: ['/app/leads'], title: 'Client setups that failed', status: `${a.failedHandoffs} waiting`, tone: 'danger', reason: 'Open the lead and retry', action: 'Open' });
    return [
      { key: 'approvals', label: 'Needs you', hint: 'Approvals, reviews and fixes.', rows: other, total: a.closingsToApprove + a.creditsToReview + a.abandonedTimers + a.failedHandoffs, empty: 'Nothing needs you right now.' },
      { key: 'duplicates', label: 'Possible duplicates', hint: 'Research saved separately — decide if it’s the same business.', tone: 'warning', rows: reviews, empty: 'No possible duplicates to settle.' },
      { key: 'assign', label: 'Ready to assign', hint: 'Qualified leads without a salesperson.', tone: 'success', rows: ready, total: a.readyForAssignment, empty: 'Every qualified lead has a salesperson.' },
    ];
  }

  // ---- actions

  /** Opening a row from a sales queue works through that queue, so "next lead" follows on. */
  openFrom(q: Queue, r: Row): void {
    if (this.mode() !== 'sales' || !q.work || !r.opportunityId) return;
    const items = this.itemsFor(q);
    this.workQueueService.start(items, { reasons: [q.key], stage: '' });
    this.workQueueService.focus(r.opportunityId);
  }

  workQueue(q: Queue): void {
    const first = this.workQueueService.start(this.itemsFor(q), { reasons: [q.key], stage: '' });
    if (first) this.router.navigate(['/app/work', first.opportunityId], { queryParams: { queue: 1 } });
  }

  private itemsFor(q: Queue): QueueItem[] {
    return q.rows.filter((r) => r.opportunityId).map((r) => ({
      opportunityId: r.opportunityId!, businessName: r.title, city: r.where ?? null, stage: (r.stage ?? 'contacting') as QueueItem['stage'], stageLabel: r.status ?? '', reason: q.key, label: q.label, dueAt: null,
    }));
  }

  workNext(): void {
    const items = this.queue();
    const first = this.workQueueService.start(items, { reasons: ALL_REASONS, stage: '' });
    if (first) this.router.navigate(['/app/work', first.opportunityId], { queryParams: { queue: 1 } });
  }

  canPark(r: Row): boolean {
    return Boolean(r.opportunityId && r.stage && !['nurture', 'won', 'lost'].includes(r.stage) && this.org.hasPermission('crm.manage_pipeline'));
  }

  reschedule(r: Row, days: number): void {
    if (!r.opportunityId) return;
    this.busy.set(true);
    this.sales.setNextAction(r.opportunityId, { at: suggestDate(days).toISOString(), type: r.nextType || 'follow_up' }).subscribe({
      next: () => { this.busy.set(false); this.flash(`${r.title}: next step moved to ${relativeDay(suggestDate(days))}.`); this.refresh(); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not rescheduled — try again.'); },
    });
  }

  park(r: Row): void {
    if (!r.opportunityId) return;
    this.busy.set(true);
    this.sales.changeStage(r.opportunityId, { stage: 'nurture', closeReasonCode: 'bad_timing', revisitAt: suggestDate(90).toISOString(), revisitNote: 'Revisit — parked from My Work' }).subscribe({
      next: () => { this.busy.set(false); this.flash(`${r.title} is parked in nurture for three months.`); this.refresh(); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not parked — open the lead to change its status.'); },
    });
  }

  private refresh(): void {
    this.expanded.set(null);
    this.load();
    if (this.mode() === 'sales') this.loadQueue();
  }

  private flash(text: string): void {
    this.notice.set(text);
    setTimeout(() => this.notice.set(''), 3500);
  }

  private readSession(): QualifySession | null {
    try {
      const s = JSON.parse(sessionStorage.getItem('lz.qualifySession') || 'null');
      return s && Array.isArray(s.items) && s.index < s.items.length ? s : null;
    } catch { return null; }
  }
}
