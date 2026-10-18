import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { WorkflowService } from '../../core/services/workflow.service';
import { WORK_TYPE_LABELS } from '../../core/models/workflow.model';
import { IconComponent } from '../../shared/icon/icon.component';

/**
 * The sidebar work timer (ADR 0016). Employees start, pause and stop it
 * themselves; it links to the lead on screen when there is one. It records
 * only what the person chooses — it does not watch activity.
 */
@Component({
  selector: 'app-time-tracker',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="tracker" [class.on]="session()">
      @if (session(); as s) {
        <div class="row">
          <lz-icon name="clock" [size]="14" />
          <span class="elapsed">{{ elapsed() }}</span>
          <span class="what">{{ types[s.workType] }}@if (s.businessName) { · {{ s.businessName }} }</span>
        </div>
        @if (stopping()) {
          <input class="note" [(ngModel)]="note" placeholder="What did you work on? (optional)" aria-label="Note" />
          <div class="row btns"><button (click)="stopping.set(false)">Back</button><button class="primary" (click)="stop()" [disabled]="busy()">Save time</button></div>
        } @else {
          <div class="row btns">
            @if (s.status === 'running') { <button (click)="pause()" [disabled]="busy()">Pause</button> } @else { <button (click)="resume()" [disabled]="busy()">Resume</button> }
            <button class="primary" (click)="stopping.set(true)">Stop</button>
          </div>
          @if (s.status === 'paused') { <span class="paused">Paused</span> }
        }
      } @else if (picking()) {
        <select class="note" [(ngModel)]="workType" aria-label="Kind of work">
          @for (t of typeList; track t.key) { <option [value]="t.key">{{ t.label }}</option> }
        </select>
        @if (workflow.focusLead(); as lead) { <label class="link"><input type="checkbox" [(ngModel)]="linkLead" /> On {{ lead.name }}</label> }
        <div class="row btns"><button (click)="picking.set(false)">Cancel</button><button class="primary" (click)="start()" [disabled]="busy()">Start</button></div>
      } @else {
        <div class="row"><button class="start" (click)="picking.set(true)"><lz-icon name="play" [size]="12" /> Start work timer</button><a routerLink="/app/time" class="mine">My time</a></div>
      }
      @if (error()) { <p class="err">{{ error() }}</p> }
    </div>
  `,
  styles: [`
    .tracker { margin: 0 10px 8px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); font-size: .78rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 6px;
      &.on { border-color: rgba(129,140,248,.6); background: rgba(99,102,241,.12); } }
    .row { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .elapsed { font-variant-numeric: tabular-nums; font-weight: 700; color: #fff; }
    .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; }
    .btns { justify-content: flex-end; button { background: rgba(255,255,255,.08); border: 0; color: #e2e8f0; border-radius: 6px; padding: 4px 9px; cursor: pointer; font-size: .75rem; }
      .primary { background: #6366f1; color: #fff; } }
    .start { background: none; border: 0; color: #cbd5e1; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 0; font-size: .78rem; }
    .mine { margin-left: auto; color: #94a3b8; font-size: .72rem; text-decoration: none; }
    .note { width: 100%; background: rgba(15,23,42,.6); color: #fff; border: 1px solid rgba(255,255,255,.15); border-radius: 6px; padding: 4px 6px; font-size: .75rem; }
    .link { display: flex; gap: 6px; align-items: center; color: #94a3b8; }
    .paused { color: #fbbf24; font-size: .7rem; }
    .err { color: #fca5a5; margin: 0; font-size: .72rem; }
  `],
})
export class TimeTrackerComponent implements OnInit, OnDestroy {
  readonly workflow = inject(WorkflowService);
  readonly types = WORK_TYPE_LABELS;
  readonly typeList = Object.entries(WORK_TYPE_LABELS).map(([key, label]) => ({ key, label }));
  readonly session = this.workflow.running;
  readonly picking = signal(false);
  readonly stopping = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly now = signal(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;
  workType = 'research';
  linkLead = true;
  note = '';

  readonly elapsed = computed(() => {
    const s = this.session();
    if (!s) return '';
    const end = s.pausedAt ? new Date(s.pausedAt).getTime() : this.now();
    const seconds = Math.max(0, Math.floor((end - new Date(s.startedAt).getTime()) / 1000) - s.pausedSeconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  });

  ngOnInit(): void {
    this.workflow.refreshTimer().subscribe({ error: () => undefined });
    this.ticker = setInterval(() => this.now.set(Date.now()), 30000);
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  private act(request: ReturnType<WorkflowService['pauseTimer']>, after?: () => void): void {
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: () => { this.busy.set(false); this.now.set(Date.now()); after?.(); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Timer not updated.'); this.workflow.refreshTimer().subscribe({ error: () => undefined }); },
    });
  }

  start(): void {
    const lead = this.linkLead ? this.workflow.focusLead()?.id ?? null : null;
    this.act(this.workflow.startTimer(this.workType, lead), () => this.picking.set(false));
  }

  pause(): void { this.act(this.workflow.pauseTimer()); }
  resume(): void { this.act(this.workflow.resumeTimer()); }
  stop(): void {
    this.act(this.workflow.stopTimer(this.note || null), () => { this.stopping.set(false); this.note = ''; });
  }
}
