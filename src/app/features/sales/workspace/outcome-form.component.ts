import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { SalesService, actionKey } from '../../../core/services/sales.service';
import {
  CHANNEL_LABELS, NEXT_ACTION_LABELS, OUTCOMES, Outcome, Qualification, QualificationKey, UserRef, Workspace,
} from '../../../core/models/sales.model';
import { suggestDate, toLocalInput } from '../shared/sales-format';

// Outcomes where a real conversation happened — the moment to capture what was learned.
const CONVERSATION_OUTCOMES: Outcome[] = ['connected', 'interested', 'meeting_arranged'];

/**
 * Quick "what happened + what's next" form (ADR 0011), used after every
 * interaction. After a real conversation it also captures what was
 * learned (ADR 0013 progressive qualification); closing or parking a deal
 * asks for a structured reason, and parking asks when to revisit.
 */
@Component({
  selector: 'app-outcome-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="save(false)" class="outcome-form">
      @if (!activityId()) {
        <div class="form-group">
          <span class="form-label" id="oc-channel">How did you reach out?</span>
          <div class="seg" role="radiogroup" aria-labelledby="oc-channel">
            @for (c of channels; track c) {
              <button type="button" role="radio" [attr.aria-checked]="channel === c" [class.active]="channel === c" (click)="channel = c">{{ channelLabels[c] }}</button>
            }
          </div>
        </div>
      } @else {
        <p class="muted-box">Your phone should be ringing — Leadzaro connects the lead when you answer. When the call ends, record what happened.</p>
      }

      <div class="form-group">
        <span class="form-label" id="oc-outcome">What happened? *</span>
        <div class="outcomes" role="radiogroup" aria-labelledby="oc-outcome">
          @for (o of outcomes; track o.key) {
            <button type="button" role="radio" class="outcome" [attr.aria-checked]="outcome() === o.key" [class.active]="outcome() === o.key"
              [class.danger]="o.key === 'do_not_contact'" (click)="pick(o.key)">
              <strong>{{ o.label }}</strong><small>{{ o.hint }}</small>
            </button>
          }
        </div>
      </div>

      @if (ws().contacts.length > 1) {
        <div class="form-group">
          <label class="form-label" for="oc-contact">Who with?</label>
          <select id="oc-contact" class="form-select" [(ngModel)]="contactId" name="contactId">
            <option value="">The business</option>
            @for (c of ws().contacts; track c.id) { <option [value]="c.id">{{ c.name }}{{ c.title ? ' — ' + c.title : '' }}</option> }
          </select>
        </div>
      }

      @if (talked()) {
        <fieldset class="learned">
          <legend class="form-label">What did you learn? <span class="text-muted">(fill in what you know — the rest can come later)</span></legend>
          @for (f of ws().pipeline.qualificationFields; track f.key) {
            <div class="form-group">
              <label class="form-label" [for]="'oc-q-' + f.key">{{ f.label }}</label>
              @if (f.key === 'qualNeed') {
                <textarea [id]="'oc-q-' + f.key" class="form-control" rows="2" [name]="f.key" [(ngModel)]="qual[f.key]" maxlength="2000" placeholder="e.g. Their site doesn’t work on phones and they get no enquiries"></textarea>
              } @else {
                <input [id]="'oc-q-' + f.key" class="form-control" [name]="f.key" [(ngModel)]="qual[f.key]" maxlength="200" [placeholder]="placeholders[f.key]" />
              }
            </div>
          }
        </fieldset>
      }

      @if (outcome() === 'not_interested') {
        <div class="seg" role="radiogroup" aria-label="Close or park">
          <button type="button" role="radio" [attr.aria-checked]="!nurture" [class.active]="!nurture" (click)="setNurture(false)">Close as lost</button>
          <button type="button" role="radio" [attr.aria-checked]="nurture" [class.active]="nurture" (click)="setNurture(true)">Park in Nurture — revisit later</button>
        </div>
        <div class="form-group">
          <label class="form-label" for="oc-reason">Reason *</label>
          <select id="oc-reason" class="form-select" name="closeReason" [(ngModel)]="closeReasonCode">
            <option value="">Choose a reason…</option>
            @for (r of (nurture ? ws().pipeline.nurtureReasons : ws().pipeline.closeReasons); track r.key) { <option [value]="r.key">{{ r.label }}</option> }
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="oc-lost">Details {{ closeReasonCode === 'other' ? '*' : '(optional)' }}</label>
          <input id="oc-lost" class="form-control" [(ngModel)]="lostReason" name="lostReason" maxlength="255" placeholder="e.g. Signed with their nephew’s agency last month" />
        </div>
      }
      @if (outcome() === 'do_not_contact') {
        <div class="alert alert-warning">All outreach to this business stops, and it leaves every queue. You can undo this from the lead.</div>
      }
      @if (outcome() === 'wrong_contact' && !contactId) {
        <p class="form-hint">Choose the contact above to remove them, or add the right person in Details.</p>
      }

      <div class="form-group">
        <label class="form-label" for="oc-note">Notes</label>
        <textarea id="oc-note" class="form-control" rows="3" [(ngModel)]="note" name="note" placeholder="What did they say? Never write passwords or card numbers."></textarea>
      </div>

      @if (needsNext()) {
        <fieldset class="next">
          <legend class="form-label">{{ outcome() === 'not_interested' && nurture ? 'Revisit on *' : 'Next step *' }}</legend>
          <div class="quick">
            @for (q of (outcome() === 'not_interested' && nurture ? revisitDates : quickDates); track q.label) {
              <button type="button" class="btn btn-sm" [class.btn-primary]="nextAt === q.value" [class.btn-ghost]="nextAt !== q.value" (click)="nextAt = q.value">{{ q.label }}</button>
            }
          </div>
          <div class="next-row">
            <input class="form-control" type="datetime-local" [(ngModel)]="nextAt" name="nextAt" aria-label="Next step date and time" />
            <select class="form-select" [(ngModel)]="nextType" name="nextType" aria-label="Next step type">
              @for (t of nextTypes; track t.key) { <option [value]="t.key">{{ t.label }}</option> }
            </select>
          </div>
          <input class="form-control" [(ngModel)]="nextNote" name="nextNote" placeholder="What to do (optional), e.g. Send the proposal" aria-label="Next step note" />
        </fieldset>
      }

      @if (owner()) {
        <div class="alert alert-warning owner" role="alert">
          <span><strong>{{ owner()!.name }}</strong> owns this lead. Check with them so you don’t both contact the same business.</span>
          <button type="button" class="btn btn-outline btn-sm" (click)="confirmOwner = true; save(lastGoNext)">Log it anyway</button>
        </div>
      }
      @if (error()) { <div class="alert alert-error">{{ error() }}</div> }

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">Cancel</button>
        @if (inQueue()) {
          <button type="button" class="btn btn-outline" (click)="save(false)" [disabled]="saving()">Save</button>
          <button type="button" class="btn btn-primary" (click)="save(true)" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save & next lead' }}</button>
        } @else {
          <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        }
      </div>
    </form>
  `,
  styles: [`
    .outcome-form { display: flex; flex-direction: column; gap: 14px; }
    .outcomes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .outcome {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
      padding: 9px 11px; border: 1.5px solid var(--border); border-radius: var(--radius); background: var(--card); cursor: pointer;
      strong { font-size: .8125rem; color: var(--text-primary); } small { font-size: .7rem; color: var(--text-muted); }
      &:hover { border-color: var(--primary-200); }
      &.active { border-color: var(--primary); background: var(--primary-50); }
      &.danger.active { border-color: var(--danger); background: var(--danger-bg); }
      &:focus-visible { outline: 2px solid var(--primary-light); }
    }
    .learned { border: 1px solid var(--primary-light); background: var(--primary-50); border-radius: var(--radius); padding: 12px; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
      legend { padding: 0 4px; } .form-group:first-of-type { grid-column: 1 / -1; }
      @media (max-width: 560px) { grid-template-columns: 1fr; } }
    .next { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; margin: 0; }
    .quick { display: flex; gap: 6px; flex-wrap: wrap; }
    .next-row { display: grid; grid-template-columns: 1fr 180px; gap: 8px; @media (max-width: 520px) { grid-template-columns: 1fr; } }
    .owner { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .form-actions { display: flex; justify-content: flex-end; gap: 8px; }
  `],
})
export class OutcomeFormComponent implements OnInit {
  private readonly sales = inject(SalesService);

  readonly ws = input.required<Workspace>();
  readonly presetChannel = input<string>('call');
  readonly activityId = input<string | null>(null);
  readonly inQueue = input(false);
  readonly saved = output<{ workspace: Workspace; next: boolean }>();
  readonly cancelled = output<void>();

  readonly outcomes = OUTCOMES;
  readonly channelLabels = CHANNEL_LABELS;
  readonly channels = ['call', 'email', 'sms', 'in_person', 'other'];
  readonly nextTypes = Object.entries(NEXT_ACTION_LABELS).map(([key, label]) => ({ key, label }));
  readonly quickDates = [
    { label: 'Tomorrow', value: toLocalInput(suggestDate(1)) },
    { label: 'In 2 days', value: toLocalInput(suggestDate(2)) },
    { label: 'Next week', value: toLocalInput(suggestDate(7)) },
    { label: 'In 2 weeks', value: toLocalInput(suggestDate(14)) },
  ];
  readonly revisitDates = [
    { label: 'In 1 month', value: toLocalInput(suggestDate(30)) },
    { label: 'In 3 months', value: toLocalInput(suggestDate(90)) },
    { label: 'In 6 months', value: toLocalInput(suggestDate(182)) },
  ];
  readonly placeholders: Record<string, string> = {
    qualService: 'e.g. New website + care plan', qualDecisionMaker: 'e.g. Maria (owner) decides', qualTiming: 'e.g. Before spring season', qualBudget: 'e.g. Around $2k',
  };

  readonly outcome = signal<Outcome | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly owner = signal<UserRef | null>(null);
  private readonly nurtureSignal = signal(false);
  readonly needsNext = computed(() => !['do_not_contact'].includes(this.outcome() ?? '') && !(this.outcome() === 'not_interested' && !this.nurtureSignal()));
  readonly talked = computed(() => CONVERSATION_OUTCOMES.includes(this.outcome() as Outcome));
  private key = actionKey();

  channel = 'call';
  contactId = '';
  note = '';
  lostReason = '';
  closeReasonCode = '';
  nextAt = '';
  nextType = 'follow_up';
  nextNote = '';
  confirmOwner = false;
  lastGoNext = false;
  qual: Record<QualificationKey, string> = {
    qualNeed: '', qualService: '', qualDecisionMaker: '', qualTiming: '', qualBudget: '',
  };

  get nurture(): boolean { return this.nurtureSignal(); }
  set nurture(value: boolean) { this.nurtureSignal.set(value); }

  ngOnInit(): void {
    this.channel = this.presetChannel();
    this.contactId = this.ws().primaryContact?.id ?? '';
    const known: Qualification = this.ws().opportunity.qualification;
    for (const key of Object.keys(this.qual) as QualificationKey[]) this.qual[key] = known?.[key] ?? '';
  }

  pick(outcome: Outcome): void {
    this.outcome.set(outcome);
    this.error.set('');
    const defaults: Partial<Record<Outcome, [number, string]>> = {
      no_answer: [1, 'call'], voicemail: [2, 'call'], connected: [2, 'follow_up'], interested: [1, 'send_offer'], meeting_arranged: [2, 'meeting'], wrong_contact: [1, 'call'],
    };
    const d = defaults[outcome];
    if (d && !this.nextAt) {
      this.nextAt = toLocalInput(suggestDate(d[0]));
      this.nextType = d[1];
    }
  }

  setNurture(on: boolean): void {
    this.nurture = on;
    this.closeReasonCode = '';
    if (on) {
      this.nextAt = this.revisitDates[1].value;
      this.nextType = 'follow_up';
    }
  }

  /** Qualification answers that changed, trimmed. */
  private qualChanges(): Partial<Qualification> {
    if (!this.talked()) return {};
    const known = this.ws().opportunity.qualification;
    const changes: Partial<Qualification> = {};
    for (const key of Object.keys(this.qual) as QualificationKey[]) {
      const value = this.qual[key].trim();
      if (value !== (known?.[key] ?? '')) changes[key] = value || null;
    }
    return changes;
  }

  save(goNext: boolean): void {
    this.lastGoNext = goNext;
    const outcome = this.outcome();
    if (!outcome) {
      this.error.set('Choose what happened.');
      return;
    }
    if (outcome === 'not_interested' && !this.closeReasonCode) {
      this.error.set(this.nurture ? 'Choose why they’re not ready yet.' : 'Choose why the deal was lost — it keeps the reports honest.');
      return;
    }
    if (outcome === 'not_interested' && this.closeReasonCode === 'other' && !this.lostReason.trim()) {
      this.error.set('Add a few words about why.');
      return;
    }
    if (this.needsNext() && !this.nextAt) {
      this.error.set(this.nurture ? 'Pick when to revisit this business.' : 'Every open lead needs a next step — pick a date.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.owner.set(null);
    const activityId = this.activityId();
    const body = {
      channel: this.channel,
      outcome,
      contactId: this.contactId || null,
      note: this.note || null,
      nurture: this.nurture,
      closeReasonCode: outcome === 'not_interested' ? this.closeReasonCode : null,
      lostReason: this.lostReason || null,
      nextAction: this.needsNext() && this.nextAt ? { at: new Date(this.nextAt).toISOString(), type: this.nextType, note: this.nextNote || null } : null,
      idempotencyKey: this.key,
      origin: this.channel === 'call' || this.channel === 'in_person' ? 'manual' : 'external',
      // A call placed through Leadzaro was already confirmed when it started.
      confirmOwner: this.confirmOwner || Boolean(activityId),
    };
    const id = this.ws().opportunity.id;
    const log = (): Observable<Workspace> => (activityId ? this.sales.completeCall(id, activityId, body) : this.sales.logOutcome(id, body));
    const finish = () => log().subscribe({
      next: (workspace) => {
        this.saving.set(false);
        this.key = actionKey();
        this.saved.emit({ workspace, next: goNext });
      },
      error: (err) => {
        this.saving.set(false);
        if (err.status === 409 && err.error?.code === 'owned_by_other') {
          this.owner.set(err.error.owner || { id: '', name: 'Someone else' });
          return;
        }
        this.error.set(err.error?.message || 'Not saved. Your entries are still here — try again.');
      },
    });
    const changes = this.qualChanges();
    if (Object.keys(changes).length) {
      this.sales.updateQualification(id, changes).subscribe({
        next: () => finish(),
        error: (err) => { this.saving.set(false); this.error.set(err.error?.message || 'What you learned wasn’t saved — nothing was logged yet. Try again.'); },
      });
    } else finish();
  }
}
