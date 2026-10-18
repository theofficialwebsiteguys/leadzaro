import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { WorkflowService } from '../../core/services/workflow.service';
import { WORK_TYPE_LABELS, WorkSessionItem } from '../../core/models/workflow.model';
import { toLocalInput } from '../sales/shared/sales-format';

/**
 * My time (ADR 0016): what you recorded, time worked outside the app, and
 * corrections. A correction keeps the original minutes and your reason.
 */
@Component({
  selector: 'app-my-time',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page my-time">
      <header><h1>My time</h1><p class="sub">Time you recorded in the last 30 days: <strong>{{ hours(total()) }}</strong>. Only what you record counts — Leadzaro doesn’t track activity.</p></header>

      <section class="card block">
        <h2>Add time worked outside Leadzaro</h2>
        <div class="grid">
          <label>Started <input class="form-control" type="datetime-local" [(ngModel)]="manual.startedAt" /></label>
          <label>Minutes <input class="form-control" type="number" min="1" max="720" [(ngModel)]="manual.minutes" /></label>
          <label>Work <select class="form-select" [(ngModel)]="manual.workType">@for (t of typeList; track t.key) { <option [value]="t.key">{{ t.label }}</option> }</select></label>
        </div>
        <input class="form-control" [(ngModel)]="manual.note" maxlength="1000" placeholder="What you worked on, e.g. Called 6 roofers from my phone" aria-label="What you worked on" />
        <div class="actions"><button class="btn btn-primary btn-sm" (click)="addManual()" [disabled]="busy() || !manual.minutes || !manual.note.trim()">Add time</button></div>
      </section>

      @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
      @if (notice()) { <div class="alert alert-success">{{ notice() }}</div> }

      <div class="card"><table class="table">
        <thead><tr><th>Started</th><th>Work</th><th>Lead</th><th>Minutes</th><th>How</th><th>Note</th><th></th></tr></thead>
        <tbody>
          @for (s of items(); track s.id) {
            <tr [class.warn]="s.status === 'abandoned'">
              <td>{{ s.startedAt | date: 'MMM d, h:mm a' }}</td>
              <td>{{ types[s.workType] }}</td>
              <td>{{ s.businessName || '—' }}</td>
              <td>@if (s.status === 'abandoned') { Left running — counts as 0 } @else { {{ s.minutes }} }@if (s.originalMinutes !== null) { <br /><span class="muted">was {{ s.originalMinutes }}: {{ s.correctionReason }}</span> }</td>
              <td>{{ s.source === 'manual' ? 'Added by hand' : 'Timer' }}{{ s.status === 'running' || s.status === 'paused' ? ' (open)' : '' }}</td>
              <td>{{ s.note }}</td>
              <td>
                @if (s.status === 'stopped' || s.status === 'abandoned') {
                  @if (editing() === s.id) {
                    <div class="fix"><input class="form-control" type="number" min="0" max="720" [(ngModel)]="fix.minutes" aria-label="Minutes" />
                      <input class="form-control" [(ngModel)]="fix.reason" placeholder="Why" aria-label="Why" />
                      <button class="btn btn-primary btn-sm" (click)="saveFix(s)" [disabled]="busy() || !fix.reason.trim()">Save</button></div>
                  } @else { <button class="btn btn-ghost btn-sm" (click)="startFix(s)">Correct</button> }
                }
              </td>
            </tr>
          } @empty { <tr><td colspan="7" class="muted">Nothing recorded yet. Start the timer in the sidebar, or add time above.</td></tr> }
        </tbody>
      </table></div>
    </div>
  `,
  styles: [`
    header { margin-bottom: 14px; h1 { font-family: var(--font-display); font-size: 1.6rem; margin: 0; } .sub { color: var(--text-muted); font-size: .875rem; margin: 4px 0 0; } }
    .block { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; h2 { margin: 0; font-size: .95rem; } }
    .grid { display: grid; grid-template-columns: 1fr 120px 1fr; gap: 8px; label { display: flex; flex-direction: column; font-size: .75rem; color: var(--text-muted); gap: 2px; } @media (max-width: 600px) { grid-template-columns: 1fr; } }
    .actions { display: flex; justify-content: flex-end; }
    .table { width: 100%; font-size: .8125rem; }
    .muted { color: var(--text-muted); font-size: .78rem; }
    .fix { display: flex; gap: 4px; input[type=number] { width: 70px; } }
    tr.warn td { background: var(--warning-bg); }
  `],
})
export class MyTimeComponent implements OnInit {
  private readonly workflow = inject(WorkflowService);
  readonly types = WORK_TYPE_LABELS;
  readonly typeList = Object.entries(WORK_TYPE_LABELS).map(([key, label]) => ({ key, label }));
  readonly items = signal<WorkSessionItem[]>([]);
  readonly total = signal(0);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly editing = signal<string | null>(null);
  manual = { startedAt: toLocalInput(new Date(Date.now() - 3600000)), minutes: 30, workType: 'research', note: '' };
  fix = { minutes: 0, reason: '' };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.workflow.timeEntries({}).subscribe({
      next: (r) => { this.items.set(r.items); this.total.set(r.totalMinutes); },
      error: (err) => this.error.set(err.error?.message || 'Couldn’t load your time.'),
    });
  }

  addManual(): void {
    this.busy.set(true);
    this.error.set('');
    this.workflow.addManualTime({ ...this.manual, minutes: Number(this.manual.minutes), startedAt: new Date(this.manual.startedAt).toISOString() }).subscribe({
      next: (r) => { this.busy.set(false); this.items.set(r.items); this.total.set(r.totalMinutes); this.manual.note = ''; this.notice.set('Time added.'); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not added — try again.'); },
    });
  }

  startFix(s: WorkSessionItem): void {
    this.fix = { minutes: s.minutes ?? 0, reason: '' };
    this.editing.set(s.id);
  }

  saveFix(s: WorkSessionItem): void {
    this.busy.set(true);
    this.workflow.correctTime(s.id, Number(this.fix.minutes), this.fix.reason).subscribe({
      next: () => { this.busy.set(false); this.editing.set(null); this.notice.set('Corrected — the original is kept with your reason.'); this.load(); this.workflow.refreshTimer().subscribe({ error: () => undefined }); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved.'); },
    });
  }

  hours(minutes: number): string {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
}
