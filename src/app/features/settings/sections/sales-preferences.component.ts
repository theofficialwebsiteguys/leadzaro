import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { SettingsService } from '../../../core/services/settings.service';
import { SalesService } from '../../../core/services/sales.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { AuthService } from '../../../core/services/auth.service';
import { Channels, UserRef } from '../../../core/models/sales.model';
import { MySettings } from '../../../core/models/settings.model';
import { HasUnsavedChanges, Snapshot } from '../unsaved-changes.guard';

const METRICS = [
  { key: 'attempts', label: 'Outreach attempts' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'meetings', label: 'Meetings booked' },
  { key: 'paid_sales', label: 'Paid sales' },
];

interface PrefsForm { searchKeywords: string; searchLocation: string; searchRadius: number | null; defaultFollowUpDays: number | null; signature: string }
type GoalRow = Record<string, string>;

/**
 * Sales preferences (ADR 0012). Every field is used somewhere real:
 * search defaults pre-fill Find Leads, the follow-up gap is suggested in
 * the composer, the signature fills {{my_signature}}, and goals feed the
 * progress bars on Today.
 */
@Component({
  selector: 'app-sales-preferences',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>Sales preferences</h2><p>How Leadzaro sets things up for you when you work leads.</p></div>

      @if (loadError()) { <div class="alert alert-error">{{ loadError() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @else if (!me()) { <div class="loading-state"><div class="spinner"></div></div> }
      @else {
        <form class="set-card" (ngSubmit)="savePrefs()">
          <div class="set-card-head"><div><h3>Finding and following up</h3><p>Blank fields fall back to the workspace defaults.</p></div><span class="scope-tag personal">Only you</span></div>
          <div class="set-card-body set-grid">
            <div class="form-group"><label class="form-label" for="s-kw">Search keywords</label>
              <input id="s-kw" class="form-control" name="kw" [(ngModel)]="form.searchKeywords" [placeholder]="workspaceDefault('keywords')" maxlength="150" />
              <span class="form-hint">Pre-filled in Find Leads — you can still change it for each search.</span></div>
            <div class="form-group"><label class="form-label" for="s-loc">Search location</label>
              <input id="s-loc" class="form-control" name="loc" [(ngModel)]="form.searchLocation" [placeholder]="workspaceDefault('location')" maxlength="200" /></div>
            <div class="form-group"><label class="form-label" for="s-rad">Search radius (miles)</label>
              <input id="s-rad" type="number" min="1" max="50" class="form-control" name="radius" [(ngModel)]="form.searchRadius" placeholder="10" /></div>
            <div class="form-group"><label class="form-label" for="s-fu">Follow up after (days)</label>
              <input id="s-fu" type="number" min="1" max="30" class="form-control" name="fu" [(ngModel)]="form.defaultFollowUpDays" [placeholder]="'Workspace default: ' + me()!.effective.defaultFollowUpDays" />
              <span class="form-hint">Suggested next step after you email or text a lead.</span></div>
          </div>

          <div class="set-card-head sub-head"><div><h3>Email signature</h3><p>Fills <code>{{ sigPlaceholder }}</code> in templates. Without one, your name and phone are used.</p></div></div>
          <div class="set-card-body">
            <textarea class="form-control" rows="4" name="signature" [(ngModel)]="form.signature" maxlength="500" [placeholder]="me()!.user.name + (me()!.user.phone ? '\n' + me()!.user.phone : '')" aria-label="Email signature"></textarea>
            @if (channels(); as ch) {
              <p class="form-hint identity">
                @if (ch.email.connected) { Emails you send from Leadzaro go out as <strong>{{ ch.email.from }}</strong>, and replies come to your login email <strong>{{ me()!.user.email }}</strong>. }
                @else { Outreach email isn’t connected, so emails open in your own email app and use that app’s signature too. }
              </p>
            }
          </div>
          <div class="set-actions">
            @if (dirty()) { <span class="dirty">Unsaved changes</span> } @else if (message()) { <span class="saved" role="status">{{ message() }}</span> }
            @if (error()) { <span class="form-error" role="alert">{{ error() }}</span> }
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset()" [disabled]="!dirty()">Discard</button>
            <button type="submit" class="btn btn-primary btn-sm" [disabled]="!dirty() || saving()">{{ saving() ? 'Saving…' : 'Save preferences' }}</button>
          </div>
        </form>

        <div class="set-card">
          <div class="set-card-head"><div><h3>Weekly goals</h3><p>Shown as progress bars on Today. A personal goal replaces the team goal. Leave blank for none.</p></div></div>
          <div class="set-card-body goals">
            <div class="goal-col">
              <p class="eyebrow">My goals <span class="scope-tag personal">Only you</span></p>
              @for (m of metrics; track m.key) {
                <label class="goal-row"><span>{{ m.label }}</span><input class="form-control" type="number" min="0" max="10000" [(ngModel)]="myGoals[m.key]" [placeholder]="teamGoals[m.key] ? 'team: ' + teamGoals[m.key] : 'none'" /></label>
              }
            </div>
            @if (isManager()) {
              <div class="goal-col">
                <p class="eyebrow">Team default <span class="scope-tag workspace">Everyone</span></p>
                @for (m of metrics; track m.key) {
                  <label class="goal-row"><span>{{ m.label }}</span><input class="form-control" type="number" min="0" max="10000" [(ngModel)]="teamGoals[m.key]" /></label>
                }
                <p class="eyebrow mt-4">For one person</p>
                <select class="form-select" [ngModel]="goalPerson" (ngModelChange)="pickPerson($event)" aria-label="Person">
                  <option value="">Choose…</option>
                  @for (p of members(); track p.id) { @if (p.id !== auth.currentUser()?.id) { <option [value]="p.id">{{ p.name }}</option> } }
                </select>
                @if (goalPerson) {
                  @for (m of metrics; track m.key) {
                    <label class="goal-row"><span>{{ m.label }}</span><input class="form-control" type="number" min="0" max="10000" [(ngModel)]="personGoals[m.key]" placeholder="team" /></label>
                  }
                }
              </div>
            }
          </div>
          <div class="set-actions">
            @if (goalsDirty()) { <span class="dirty">Unsaved changes</span> } @else if (goalMessage()) { <span class="saved" role="status">{{ goalMessage() }}</span> }
            @if (goalError()) { <span class="form-error" role="alert">{{ goalError() }}</span> }
            <button type="button" class="btn btn-primary btn-sm" (click)="saveGoals()" [disabled]="!goalsDirty() || savingGoals()">{{ savingGoals() ? 'Saving…' : 'Save goals' }}</button>
          </div>
        </div>

        <div class="set-card">
          <div class="set-card-head"><div><h3>Message templates</h3><p>Your personal templates and the team’s shared ones{{ canShare() ? ' (you can edit shared templates)' : '' }}.</p></div>
            <a class="btn btn-outline btn-sm" routerLink="/app/outreach" [queryParams]="{ tab: 'templates' }">Manage templates</a></div>
          <div class="set-card-body"><p class="form-hint">Use <code>{{ sigPlaceholder }}</code> at the end of your email templates to add your signature.</p></div>
        </div>
      }
    </section>
  `,
  styles: [`
    .sub-head { border-top: 1px solid var(--border-light); padding-top: 16px; }
    code { font-size: .75rem; background: var(--bg-2); padding: 1px 5px; border-radius: 4px; }
    .identity { margin: 0; }
    .goals { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; @media (max-width: 720px) { grid-template-columns: 1fr; } }
    .goal-col { display: flex; flex-direction: column; gap: 8px; .eyebrow { display: flex; gap: 8px; align-items: center; margin: 0; } }
    .goal-row { display: grid; grid-template-columns: 1fr 110px; gap: 10px; align-items: center; font-size: .8125rem; }
  `],
})
export class SalesPreferencesComponent implements OnInit, HasUnsavedChanges {
  private readonly settings = inject(SettingsService);
  private readonly sales = inject(SalesService);
  readonly org = inject(OrganizationContextService);
  readonly auth = inject(AuthService);

  readonly metrics = METRICS;
  readonly sigPlaceholder = '{{my_signature}}';
  readonly me = signal<MySettings | null>(null);
  readonly channels = signal<Channels | null>(null);
  readonly members = signal<UserRef[]>([]);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly savingGoals = signal(false);
  readonly goalMessage = signal('');
  readonly goalError = signal('');
  readonly isManager = computed(() => this.org.hasPermission('sales.view_team'));
  readonly canShare = computed(() => this.org.hasPermission('templates.manage_shared'));

  form: PrefsForm = {
    searchKeywords: '', searchLocation: '', searchRadius: null, defaultFollowUpDays: null, signature: '',
  };
  myGoals: GoalRow = {};
  teamGoals: GoalRow = {};
  personGoals: GoalRow = {};
  goalPerson = '';
  private goals: { userId: string | null; metric: string; target: number }[] = [];
  private workspaceDefaults = { keywords: '', location: '' };
  private readonly prefSnapshot = new Snapshot<PrefsForm>();
  private readonly goalSnapshot = new Snapshot<GoalRow[]>();

  ngOnInit(): void {
    this.load();
    this.sales.channels().subscribe({ next: (c) => this.channels.set(c), error: () => undefined });
    if (this.isManager()) this.sales.team().subscribe({ next: (r) => this.members.set(r.members), error: () => undefined });
  }

  load(): void {
    this.loadError.set('');
    forkJoin({ me: this.settings.me(), workspace: this.settings.workspace() }).subscribe({
      next: ({ me, workspace }) => {
        this.workspaceDefaults = { keywords: workspace.defaults.defaultSearchKeywords ?? '', location: workspace.defaults.defaultSearchLocation ?? '' };
        this.applyPrefs(me);
        this.loadGoals();
      },
      error: (err) => this.loadError.set(err.error?.message || 'Your preferences couldn’t be loaded.'),
    });
  }

  workspaceDefault(kind: 'keywords' | 'location'): string {
    const value = this.workspaceDefaults[kind];
    return value ? `Workspace default: ${value}` : 'None set';
  }

  private applyPrefs(m: MySettings): void {
    this.me.set(m);
    const p = m.salesPreferences;
    this.form = {
      searchKeywords: p.searchKeywords ?? '', searchLocation: p.searchLocation ?? '', searchRadius: p.searchRadius, defaultFollowUpDays: p.defaultFollowUpDays, signature: p.signature ?? '',
    };
    this.prefSnapshot.set(this.form);
  }

  private loadGoals(): void {
    this.sales.goals().subscribe({
      next: (goals) => {
        this.goals = goals;
        const pick = (userId: string | null) => Object.fromEntries(METRICS.map((m) => [m.key, String(goals.find((g) => g.userId === userId && g.metric === m.key)?.target ?? '')]));
        this.myGoals = pick(this.auth.currentUser()?.id ?? null);
        this.teamGoals = pick(null);
        this.personGoals = this.goalPerson ? pick(this.goalPerson) : {};
        this.goalSnapshot.set([this.myGoals, this.teamGoals, this.personGoals]);
      },
      error: () => this.goalError.set('Goals couldn’t be loaded.'),
    });
  }

  pickPerson(userId: string): void {
    if (this.goalsDirty() && !confirm('Discard unsaved goal changes?')) return;
    this.goalPerson = userId;
    this.loadGoals();
  }

  dirty(): boolean {
    return this.prefSnapshot.isDirty(this.form);
  }

  goalsDirty(): boolean {
    return this.goalSnapshot.isDirty([this.myGoals, this.teamGoals, this.personGoals]);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty() || this.goalsDirty();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  reset(): void {
    const m = this.me();
    if (m) this.applyPrefs(m);
  }

  savePrefs(): void {
    this.saving.set(true);
    this.error.set('');
    this.settings.updateSalesPreferences({
      ...this.form,
      searchRadius: this.form.searchRadius || null,
      defaultFollowUpDays: this.form.defaultFollowUpDays || null,
    }).subscribe({
      next: (m) => { this.saving.set(false); this.applyPrefs(m); this.message.set('Preferences saved.'); },
      error: (err) => { this.saving.set(false); this.error.set(err.error?.message || 'Not saved — your changes are still here.'); },
    });
  }

  saveGoals(): void {
    const me = this.auth.currentUser()?.id ?? null;
    const requests = METRICS.flatMap((m) => {
      const list = [this.sales.setGoal(m.key, this.num(this.myGoals[m.key]), me)];
      if (this.isManager()) list.push(this.sales.setGoal(m.key, this.num(this.teamGoals[m.key]), null));
      if (this.isManager() && this.goalPerson) list.push(this.sales.setGoal(m.key, this.num(this.personGoals[m.key]), this.goalPerson));
      return list;
    });
    this.savingGoals.set(true);
    this.goalError.set('');
    forkJoin(requests).subscribe({
      next: () => { this.savingGoals.set(false); this.goalMessage.set('Goals saved.'); this.loadGoals(); },
      error: (err) => { this.savingGoals.set(false); this.goalError.set(err.error?.message || 'Goals couldn’t be saved.'); },
    });
  }

  private num(value: string | undefined): number | null {
    return value === undefined || value === '' || value === null ? null : Number(value);
  }
}
