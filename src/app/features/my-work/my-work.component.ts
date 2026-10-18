import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WorkflowService } from '../../core/services/workflow.service';
import { SalesService } from '../../core/services/sales.service';
import { WorkQueueService } from '../../core/services/work-queue.service';
import { AuthService } from '../../core/services/auth.service';
import { WorkModeService } from '../../core/services/work-mode.service';
import { MyWork } from '../../core/models/workflow.model';
import { QueueItem } from '../../core/models/sales.model';
import { IconComponent } from '../../shared/icon/icon.component';

const ALL_REASONS = ['reply', 'overdue', 'due_today', 'payment', 'new_lead', 'stalled', 'no_next_step'];

interface Row { link: unknown[]; query?: Record<string, unknown>; title: string; sub: string; tag?: string; tone?: string }

/**
 * My Work (ADR 0016): the home page. One obvious thing to start, and a
 * short list of what's next — for the role the person is working as.
 * Details live one click away, not here.
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

      @let d = data();
      @if (!d) {
        <div class="loading-state"><div class="spinner"></div></div>
      } @else {
        @switch (mode()) {
          @case ('sales') {
            <!-- Main track plus focused options (ADR 0016): like qualifying, one lead at a time. -->
            <section class="card hero">
              <p class="eyebrow">Main track</p>
              <h1>@if (queue().length) { {{ queue().length }} lead{{ queue().length === 1 ? '' : 's' }} to work } @else { You’re all caught up }</h1>
              <p>@if (queue().length) { Replies first, then overdue follow-ups, today’s follow-ups and new leads — one at a time, with the next step laid out. } @else { No replies, follow-ups or new leads are waiting. }</p>
              @if (queue().length) { <button class="btn btn-primary btn-xl" (click)="workNext()" [disabled]="starting()"><lz-icon name="play" [size]="18" /> Start working</button> }
            </section>
            @if (tracks().length) {
              <h2 class="list-title">Or focus on one thing</h2>
              <div class="tracks">
                @for (t of tracks(); track t.key) {
                  <button type="button" class="track-tile" [attr.data-tone]="t.tone" (click)="startTrack(t)" [disabled]="!t.count">
                    <span class="t-count">{{ t.count }}</span>
                    <span class="t-label">{{ t.label }}</span>
                    <span class="t-hint">{{ t.hint }}</span>
                  </button>
                }
              </div>
            }
          }
          @case ('qualifier') {
            <section class="card hero">
              <h1>Qualify businesses</h1>
              <p>Pick what and where, then go through the businesses one at a time: worth it or not, links, contact, reason, decide.</p>
              <div class="hero-actions">
                <a routerLink="/app/qualify" class="btn btn-primary btn-xl"><lz-icon name="play" [size]="18" /> Start qualifying</a>
                <a routerLink="/app/qualify/new" class="btn btn-ghost">or add one by hand</a>
              </div>
              @if (d.qualifier; as q) { <p class="stat">{{ q.stats.completedThisWeek }} completed this week · {{ q.stats.pendingReview }} waiting for review · {{ q.stats.accepted }} accepted</p> }
            </section>
          }
          @case ('client_manager') {
            @let first = rows()[0];
            <section class="card hero">
              <h1>@if (rows().length) { {{ rows().length }} client{{ rows().length === 1 ? '' : 's' }} to onboard } @else { No onboarding waiting }</h1>
              <p>Collect what the team needs to start: details, branding, content, requirements and access.</p>
              @if (first) { <a class="btn btn-primary btn-xl" [routerLink]="first.link"><lz-icon name="play" [size]="18" /> Start with {{ first.title }}</a> }
            </section>
          }
          @case ('admin') {
            <section class="card hero">
              <h1>@if (adminTotal()) { {{ adminTotal() }} thing{{ adminTotal() === 1 ? '' : 's' }} need you } @else { Nothing waiting }</h1>
              <p>Approve sales, review qualifications, and fix team time.</p>
            </section>
          }
          @default { <section class="card hero"><h1>Welcome</h1><p>Your account doesn’t have a work role yet. Ask an admin to add one in Settings → Team.</p></section> }
        }

        @if (rows().length) {
          <h2 class="list-title">{{ listTitle() }}</h2>
          <ul class="rows card">
            @for (r of rows().slice(0, 8); track $index) {
              <li><a [routerLink]="r.link" [queryParams]="r.query ?? null">
                <span class="main"><strong>{{ r.title }}</strong><span class="sub">{{ r.sub }}</span></span>
                @if (r.tag) { <span class="tag" [attr.data-tone]="r.tone">{{ r.tag }}</span> }
                <lz-icon name="arrow-right" [size]="14" />
              </a></li>
            }
          </ul>
          @if (rows().length > 8) { <p class="more">and {{ rows().length - 8 }} more</p> }
        }
        @if (d.timer.abandoned) { <p class="note"><a routerLink="/app/time">You left a timer running — fix it</a> so your time counts.</p> }
      }
    </div>
  `,
  styles: [`
    .my-work { max-width: 760px; margin: 0 auto; padding: 8px 4px 40px; }
    .hello { color: var(--text-muted); margin: 0 0 10px; font-size: .9rem; }
    .hero { padding: 28px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      h1 { font-family: var(--font-display); font-size: 1.6rem; margin: 0; letter-spacing: -.02em; } p { margin: 0; color: var(--text-muted); } }
    .btn-xl { padding: 14px 26px; font-size: 1.05rem; border-radius: 12px; margin-top: 6px; display: inline-flex; gap: 8px; align-items: center; }
    .hero-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .eyebrow { margin: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--primary); font-weight: 700; }
    .tracks { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .track-tile { --c: var(--primary); text-align: left; border: 1px solid var(--border); border-top: 3px solid var(--c); background: var(--card); border-radius: 12px; padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 2px;
      &[data-tone='danger'] { --c: var(--danger); } &[data-tone='warning'] { --c: var(--warning); } &[data-tone='info'] { --c: var(--info, #0ea5e9); }
      &[data-tone='success'] { --c: var(--success); } &[data-tone='muted'] { --c: #94a3b8; }
      &:hover:not(:disabled) { box-shadow: 0 2px 10px rgba(15, 23, 42, .07); border-color: var(--primary-200); border-top-color: var(--c); }
      &:disabled { opacity: .55; cursor: default; }
      .t-count { font-size: 1.5rem; font-weight: 800; font-family: var(--font-display); line-height: 1.1; color: var(--text-primary); }
      .t-label { font-weight: 600; font-size: .88rem; color: var(--text-primary); } .t-hint { font-size: .72rem; color: var(--text-muted); } }
    .stat { font-size: .82rem; }
    .list-title { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); margin: 24px 0 8px; }
    .rows { list-style: none; margin: 0; padding: 6px; }
    .rows a { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--radius); text-decoration: none; color: var(--text-muted); &:hover { background: var(--bg); } }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; strong { color: var(--text-primary); font-size: .95rem; }
      .sub { font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .tag[data-tone='danger'] { background: var(--danger-bg); color: var(--danger-text); }
    .tag[data-tone='warning'] { background: var(--warning-bg); }
    .tag[data-tone='success'] { background: var(--success-bg, #dcfce7); color: var(--success); }
    .more, .note { font-size: .8rem; color: var(--text-muted); margin: 8px 4px; }
  `],
})
export class MyWorkComponent implements OnInit {
  private readonly workflow = inject(WorkflowService);
  private readonly sales = inject(SalesService);
  private readonly workQueue = inject(WorkQueueService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly workMode = inject(WorkModeService);

  readonly mode = this.workMode.mode;
  readonly data = signal<MyWork | null>(null);
  readonly queue = signal<QueueItem[]>([]);
  readonly error = signal('');
  readonly starting = signal(false);
  readonly finished = signal(false);

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = this.auth.currentUser()?.name?.split(' ')[0];
    return name ? `${part}, ${name}` : part;
  });

  readonly adminTotal = computed(() => {
    const a = this.data()?.admin;
    return a ? a.closingsToApprove + a.creditsToReview + a.abandonedTimers + a.readyForAssignment + a.failedHandoffs : 0;
  });

  readonly listTitle = computed(() => ({
    sales: 'Up next', qualifier: 'Your research', client_manager: 'Onboarding', admin: 'Needs you',
  } as Record<string, string>)[this.mode() ?? ''] ?? '');

  /** The short list under the main action, for the role being worked. */
  readonly rows = computed<Row[]>(() => {
    const d = this.data();
    if (!d) return [];
    switch (this.mode()) {
      case 'sales': {
        const closing: Row[] = (d.sales?.closing ?? []).filter((c) => c.closingStatus !== 'submitted').map((c) => ({
          link: ['/app/work', c.opportunityId], title: c.businessName, sub: c.closingStatus === 'returned' ? `Sent back: ${c.reviewNote}` : 'Payment received — submit the sale', tag: 'Close it', tone: 'success',
        }));
        const tone: Record<string, string> = { reply: 'danger', overdue: 'warning' };
        return [...closing, ...this.queue().map((q) => ({
          link: ['/app/work', q.opportunityId], title: q.businessName, sub: [q.city, q.stageLabel].filter(Boolean).join(' · '), tag: q.label, tone: tone[q.reason],
        }))];
      }
      case 'qualifier': {
        const q = d.qualifier;
        if (!q) return [];
        return [
          ...q.corrections.map((c) => ({ link: ['/app/qualify', c.opportunityId], title: c.businessName, sub: c.note || 'Returned for correction', tag: 'Fix', tone: 'danger' })),
          ...q.feedback.map((f) => ({ link: ['/app/qualify', f.opportunityId], title: f.businessName, sub: f.note || '', tag: f.status === 'rejected' ? 'Not accepted' : 'Feedback', tone: 'warning' })),
          ...q.inProgress.map((c) => ({ link: ['/app/qualify', c.opportunityId], title: c.businessName, sub: c.status === 'needs_research' ? `Needs more info${c.note ? ` — ${c.note}` : ''}` : `Step ${c.step} of 5`, tag: 'Continue' })),
          ...q.ready.map((c) => ({ link: ['/app/qualify', c.opportunityId], title: c.businessName, sub: 'Qualified — choose a salesperson', tag: 'Assign' })),
        ];
      }
      case 'client_manager': {
        const cm = d.clientManager;
        if (!cm) return [];
        return [...cm.newHandoffs, ...cm.incomplete].map((h) => ({
          link: ['/app/onboarding', h.opportunityId],
          title: h.businessName,
          sub: h.status === 'failed' ? 'Client setup failed — ask an admin' : `${h.openItems} item${h.openItems === 1 ? '' : 's'} to collect`,
          tag: h.status === 'failed' ? 'Problem' : undefined,
          tone: 'danger',
        }));
      }
      case 'admin': {
        const a = d.admin;
        if (!a) return [];
        const out: Row[] = [];
        const add = (n: number, title: string, sub: string, tab: string) => { if (n) out.push({ link: ['/app/team-work'], query: { tab }, title, sub, tag: String(n) }); };
        add(a.closingsToApprove, 'Sales to approve', 'Check the payment, choose a client manager, approve', 'approvals');
        add(a.creditsToReview, 'Qualifications to review', 'Accept, send back or mark paid', 'credits');
        add(a.abandonedTimers, 'Timers left running', 'They count as zero until corrected', 'time');
        const ready = d.qualifier?.ready[0];
        if (a.readyForAssignment && ready) out.push({ link: ['/app/qualify', ready.opportunityId], title: 'Leads ready to assign', sub: 'Qualified — choose a salesperson', tag: String(a.readyForAssignment) });
        if (a.failedHandoffs) out.push({ link: ['/app/leads'], title: 'Client setups that failed', sub: 'Open the lead and retry', tag: String(a.failedHandoffs), tone: 'danger' });
        return out;
      }
      default: return [];
    }
  });

  constructor() {
    // Switching "Working as" reloads only what that role needs.
    effect(() => {
      const mode = this.mode();
      if (mode === 'sales') this.loadQueue();
    });
  }

  ngOnInit(): void {
    this.finished.set(this.route.snapshot.queryParamMap.get('finished') === '1');
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

  /** Starts at the top of the queue and walks through it one lead at a time. */
  /** Focused sessions, each a slice of the same queue (or meetings / closing). */
  readonly tracks = computed(() => {
    const q = this.queue();
    const s = this.data()?.sales;
    const count = (reasons: string[]) => q.filter((i) => reasons.includes(i.reason)).length;
    const asItems = (cards: { opportunityId: string; businessName: string; city?: string | null; stageLabel?: string }[], label: string): QueueItem[] => cards.map((c) => ({
      opportunityId: c.opportunityId, businessName: c.businessName, city: c.city ?? null, stage: 'contacting', stageLabel: c.stageLabel ?? '', reason: label, label, dueAt: null,
    } as QueueItem));
    const tiles = [
      { key: 'reply', label: 'Replies', hint: 'They answered — reply first', tone: 'danger', reasons: ['reply'], count: count(['reply']) },
      { key: 'overdue', label: 'Overdue', hint: 'Follow-ups you missed', tone: 'warning', reasons: ['overdue'], count: count(['overdue']) },
      { key: 'due_today', label: 'Due today', hint: 'Today’s follow-ups', tone: 'primary', reasons: ['due_today'], count: count(['due_today']) },
      { key: 'new_lead', label: 'New leads', hint: 'First contact', tone: 'info', reasons: ['new_lead'], count: count(['new_lead']) },
      { key: 'payment', label: 'Payments', hint: 'Links to send or chase', tone: 'success', reasons: ['payment'], count: count(['payment']) },
      { key: 'stalled', label: 'Stalled', hint: 'Gone quiet or no next step', tone: 'muted', reasons: ['stalled', 'no_next_step'], count: count(['stalled', 'no_next_step']) },
      { key: 'meetings', label: 'Meetings', hint: 'Record how they went', tone: 'primary', reasons: [], count: s?.meetings.length ?? 0, items: asItems(s?.meetings ?? [], 'Meeting') },
      { key: 'closing', label: 'Closing', hint: 'Paid — submit for approval', tone: 'success', reasons: [], count: (s?.closing ?? []).filter((c) => c.closingStatus !== 'submitted').length, items: asItems((s?.closing ?? []).filter((c) => c.closingStatus !== 'submitted'), 'Closing') },
    ];
    return tiles.filter((t) => t.count || ['reply', 'overdue', 'due_today', 'new_lead'].includes(t.key));
  });

  startTrack(t: { key: string; reasons: string[]; items?: QueueItem[] }): void {
    const items = t.items ?? this.queue().filter((i) => t.reasons.includes(i.reason));
    const first = this.workQueue.start(items, { reasons: t.reasons.length ? t.reasons : [t.key], stage: '' });
    if (first) this.router.navigate(['/app/work', first.opportunityId], { queryParams: { queue: 1 } });
  }

  workNext(): void {
    const items = this.queue();
    if (!items.length) return;
    this.starting.set(true);
    const first = this.workQueue.start(items, { reasons: ALL_REASONS, stage: '' });
    this.starting.set(false);
    if (first) this.router.navigate(['/app/work', first.opportunityId], { queryParams: { queue: 1 } });
  }
}
