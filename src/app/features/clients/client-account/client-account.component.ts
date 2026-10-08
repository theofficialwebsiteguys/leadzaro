import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalesService } from '../../../core/services/sales.service';
import { ClientService } from '../../../core/services/client.service';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { ClientProfileFields, WaitingOn } from '../../../core/models/client.model';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { CentsPipe } from '../../../shared/pipes/cents.pipe';
import { ServicesInputComponent } from '../services-input/services-input.component';
import { ClientStore } from '../client.store';

interface AccountForm {
  accountManagerUserId: string;
  services: string[];
  scopeNotes: string;
  waitingOn: WaitingOn | '';
  waitingOnNote: string;
  nextActionAt: string;
  nextActionNote: string;
  clientSince: string;
  ended: boolean;
  clientEndedAt: string;
  endReason: string;
}

/**
 * The account panel on a client's overview (ADR 0013): who manages the
 * client, what they bought, who it's waiting on, the next client action,
 * and anything that needs attention — with one-click updates for the
 * common changes and a dialog for the rest.
 */
@Component({
  selector: 'app-client-account',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, DialogComponent, CentsPipe, ServicesInputComponent],
  template: `
    @if (store.detail(); as d) {
      @if (openDeals()) {
        <div class="alert alert-info" role="status">This business came from Leads and still has {{ openDeals() }} open deal{{ openDeals() === 1 ? '' : 's' }} — see Sales &amp; payments below. Close any that were really this existing client.</div>
      }
      @if (d.health.reasons.length) {
        <section class="attention" aria-label="Needs attention">
          <strong>Needs attention</strong>
          <ul>
            @for (r of d.health.reasons; track r.text) {
              <li [class]="'sev-' + r.severity">
                <span>{{ r.text }}</span>
                @switch (r.flag) {
                  @case ('onboarding') { @if (d.health.onboarding) { <a [routerLink]="['/app/leads', d.health.onboarding.opportunityId]" [queryParams]="{ tab: 'handoff' }">Open handoff</a> } }
                  @case ('billing') { <a routerLink="../billing">Open billing</a> }
                  @case ('tasks_overdue') { <button type="button" class="linkish" (click)="scrollToWork()">See tasks</button> }
                  @case ('waiting_us') { @if (canEdit()) { <button type="button" class="linkish" (click)="quickWaiting(null)">Mark done</button> } }
                  @case ('next_overdue') { @if (canEdit()) { <button type="button" class="linkish" (click)="openDialog()">Reschedule</button> } }
                }
              </li>
            }
          </ul>
        </section>
      }

      <section class="card account" aria-label="Account">
        <div class="head">
          <h2>Account</h2>
          @if (canEdit()) { <button type="button" class="btn btn-outline btn-sm" (click)="openDialog()">Update account</button> }
        </div>
        @if (flash()) { <div class="alert alert-success flash" role="status">{{ flash() }}</div> }
        <dl class="grid">
          <div>
            <dt>Client manager</dt>
            <dd>
              @if (d.manager) { {{ d.manager.name }}@if (d.manager.inactive) { <span class="text-muted"> (no longer on the team)</span> } }
              @else {
                <span class="text-muted">Not assigned</span>
                @if (canEdit() && userId()) { <button type="button" class="linkish" (click)="assignMe()" [disabled]="saving()">Assign to me</button> }
              }
            </dd>
          </div>
          <div>
            <dt>Waiting on</dt>
            <dd>
              @switch (d.profile.waitingOn) {
                @case ('us') { <span class="tag tag-warning">Us</span> }
                @case ('client') { <span class="tag tag-muted">The client</span> }
                @default { <span class="text-muted">Nobody</span> }
              }
              @if (d.profile.waitingOnNote) { <span class="note"> {{ d.profile.waitingOnNote }}</span> }
              @if (d.profile.waitingOnSince) { <span class="text-xs text-muted"> · since {{ d.profile.waitingOnSince | date: 'MMM d' }}</span> }
              @if (canEdit()) {
                <span class="quick">
                  @if (d.profile.waitingOn !== 'us') { <button type="button" class="linkish" (click)="quickWaiting('us')" [disabled]="saving()">On us</button> }
                  @if (d.profile.waitingOn !== 'client') { <button type="button" class="linkish" (click)="quickWaiting('client')" [disabled]="saving()">On client</button> }
                  @if (d.profile.waitingOn) { <button type="button" class="linkish" (click)="quickWaiting(null)" [disabled]="saving()">Clear</button> }
                </span>
              }
            </dd>
          </div>
          <div>
            <dt>Next client action</dt>
            <dd>
              @if (d.profile.nextActionAt) {
                <span [class.overdue]="d.health.flags.includes('next_overdue')">{{ d.profile.nextActionAt | date: 'EEE, MMM d' : 'UTC' }}</span>
                @if (d.profile.nextActionNote) { <span class="note"> — {{ d.profile.nextActionNote }}</span> }
              } @else { <span class="text-muted">None scheduled</span> }
            </dd>
          </div>
          <div>
            <dt>Client since</dt>
            <dd>
              @if (d.profile.clientSince) { {{ d.profile.clientSince | date: 'MMM d, y' : 'UTC' }} } @else { <span class="text-muted">Not recorded</span> }
              <span class="text-xs text-muted"> · {{ d.profile.acquisitionSource === 'sales' ? 'won through Leadzaro' : 'existing client' }}</span>
              @if (d.profile.clientEndedAt) { <div class="ended">Ended {{ d.profile.clientEndedAt | date: 'MMM d, y' : 'UTC' }}@if (d.profile.endReason) { — {{ d.profile.endReason }} }</div> }
            </dd>
          </div>
          <div class="wide">
            <dt>Services</dt>
            <dd>
              @for (s of d.profile.services || []; track s) { <span class="svc">{{ s }}</span> }
              @empty { <span class="text-muted">Not recorded</span> @if (canEdit()) { <button type="button" class="linkish" (click)="openDialog()">Add services</button> } }
            </dd>
          </div>
          @if (d.profile.scopeNotes) {
            <div class="wide"><dt>Agreed scope &amp; promises</dt><dd class="scope">{{ d.profile.scopeNotes }}</dd></div>
          }
          <div>
            <dt>Billing</dt>
            <dd>
              <span class="tag" [class]="'tag tag-' + billingTone()">{{ d.health.billing.label }}</span>
              @if (d.health.billing.test) { <span class="text-xs text-muted"> test mode</span> }
              <a class="text-xs" routerLink="../billing"> · {{ d.health.stripeLinked ? 'Stripe linked' : 'Not linked to Stripe' }}</a>
            </dd>
          </div>
          <div>
            <dt>Open work</dt>
            <dd>
              {{ d.tasks.open }} open task{{ d.tasks.open === 1 ? '' : 's' }}@if (d.tasks.overdue) { <span class="overdue"> · {{ d.tasks.overdue }} overdue</span> }
              @if (d.health.neededFromClient) { <div class="text-xs text-muted">{{ d.health.neededFromClient }} item{{ d.health.neededFromClient === 1 ? '' : 's' }} still needed from the client</div> }
            </dd>
          </div>
          @if (d.health.onboarding && d.health.onboarding.status !== 'complete') {
            <div>
              <dt>Onboarding</dt>
              <dd><a [routerLink]="['/app/leads', d.health.onboarding.opportunityId]" [queryParams]="{ tab: 'handoff' }">Handoff {{ d.health.onboarding.status === 'failed' ? 'failed — retry' : 'in progress' }}</a>
                @if (d.health.onboarding.missingEssential) { <span class="text-xs text-muted"> · {{ d.health.onboarding.missingEssential }} missing</span> }</dd>
            </div>
          }
          @if (d.health.missing.length) {
            <div class="wide"><dt>Missing</dt><dd class="text-sm text-muted">{{ missingText() }}</dd></div>
          }
        </dl>
        @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
      </section>

      <div class="twocol">
        <section class="card list-card" id="open-work" aria-label="Open tasks">
          <div class="head"><h2>Open tasks</h2>@if (d.projects.length) { <a class="text-sm" [routerLink]="['/app/projects', d.projects[0].id, 'tasks']">All tasks</a> }</div>
          @for (t of d.tasks.items; track t.id) {
            <a class="row" [routerLink]="['/app/projects', t.projectId, 'tasks']">
              <span class="title">{{ t.title }}</span>
              <span class="meta">
                @if (t.dueDate) { <span [class.overdue]="isPast(t.dueDate)">{{ t.dueDate | date: 'MMM d' : 'UTC' }}</span> · }
                {{ t.assignee?.name || 'Unassigned' }}@if (t.status === 'blocked') { · <span class="tag tag-warning">Blocked</span> }
              </span>
            </a>
          } @empty { <p class="text-sm text-muted">No open tasks for this client.</p> }
        </section>

        <section class="card list-card" aria-label="Sales history">
          <div class="head"><h2>Sales &amp; payments</h2></div>
          @if (d.sales.collected.length) {
            <p class="text-sm">Collected: @for (c of d.sales.collected; track c.currency) { <strong>{{ c.amountCents | cents }}</strong> } <span class="text-muted">from {{ d.sales.paymentCount }} payment{{ d.sales.paymentCount === 1 ? '' : 's' }} recorded in Leadzaro</span></p>
          }
          @for (deal of d.sales.deals; track deal.id) {
            <a class="row" [routerLink]="['/app/leads', deal.id]">
              <span class="title">{{ deal.title || 'Deal' }} <span class="stage-chip" [class]="'stage-chip stage-' + deal.stage">{{ deal.stageLabel }}</span></span>
              <span class="meta">{{ deal.wonAt ? 'Won ' + (deal.wonAt | date: 'MMM d, y') : 'Opened ' + (deal.createdAt | date: 'MMM d, y') }}@if (deal.owner) { · {{ deal.owner.name }} }</span>
            </a>
          } @empty { <p class="text-sm text-muted">No deals recorded — this client was added directly.</p> }
          @if (canSell()) {
            @if (dealOpen()) {
              <form class="deal-form" (ngSubmit)="createDeal()">
                <input class="form-control" name="dealTitle" [(ngModel)]="dealTitle" maxlength="200" placeholder="What’s the deal? e.g. SEO package" aria-label="Deal title" />
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="dealSaving()">{{ dealSaving() ? 'Creating…' : 'Create deal' }}</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="dealOpen.set(false)">Cancel</button>
              </form>
              @if (dealError()) { <span class="form-error">{{ dealError() }}</span> }
            } @else {
              <button type="button" class="btn btn-ghost btn-sm upsell" (click)="dealOpen.set(true)">+ New deal for this client</button>
              <span class="text-xs text-muted">Upsells and renewals are tracked as sales to an existing client, never as new clients.</span>
            }
          }
        </section>
      </div>

      <app-dialog title="Update account" [open]="dialogOpen()" (closed)="closeDialog()" [wide]="true">
        <form id="account-form" (ngSubmit)="save()" class="form">
          <div class="grid2">
            <div class="form-group">
              <label class="form-label" for="ac-mgr">Client manager</label>
              <select id="ac-mgr" class="form-select" name="mgr" [(ngModel)]="form.accountManagerUserId">
                <option value="">Not assigned</option>
                @for (m of d.team; track m.id) { <option [value]="m.id">{{ m.name }}</option> }
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="ac-since">Client since</label>
              <input id="ac-since" type="date" class="form-control" name="since" [(ngModel)]="form.clientSince" [max]="today" />
            </div>
            <div class="form-group span2">
              <label class="form-label" for="ac-services">Services</label>
              <app-services-input inputId="ac-services" [(services)]="form.services" [suggestions]="kitServices()" />
            </div>
            <div class="form-group span2">
              <label class="form-label" for="ac-scope">Agreed scope &amp; promises</label>
              <textarea id="ac-scope" class="form-control" rows="3" name="scope" [(ngModel)]="form.scopeNotes" maxlength="10000"
                placeholder="What’s included, anything promised, and what isn’t included. Never passwords."></textarea>
            </div>
            <fieldset class="form-group span2 radios">
              <legend class="form-label">Who is it waiting on?</legend>
              <label><input type="radio" name="waiting" value="" [(ngModel)]="form.waitingOn" /> Nobody</label>
              <label><input type="radio" name="waiting" value="us" [(ngModel)]="form.waitingOn" /> Us</label>
              <label><input type="radio" name="waiting" value="client" [(ngModel)]="form.waitingOn" /> The client</label>
            </fieldset>
            @if (form.waitingOn) {
              <div class="form-group span2">
                <label class="form-label" for="ac-wnote">Waiting for what?</label>
                <input id="ac-wnote" class="form-control" name="wnote" [(ngModel)]="form.waitingOnNote" maxlength="255" [placeholder]="form.waitingOn === 'us' ? 'e.g. Homepage revisions' : 'e.g. Logo files and menu PDF'" />
              </div>
            }
            <div class="form-group">
              <label class="form-label" for="ac-next">Next client action</label>
              <input id="ac-next" type="date" class="form-control" name="next" [(ngModel)]="form.nextActionAt" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ac-nnote">What happens then</label>
              <input id="ac-nnote" class="form-control" name="nnote" [(ngModel)]="form.nextActionNote" maxlength="255" placeholder="e.g. Monthly report call" />
            </div>
            <div class="form-group span2 ended-box">
              <label class="check"><input type="checkbox" name="ended" [(ngModel)]="form.ended" /> This client has ended (no longer a client)</label>
              @if (form.ended) {
                <div class="grid2">
                  <div class="form-group">
                    <label class="form-label" for="ac-end">Ended on</label>
                    <input id="ac-end" type="date" class="form-control" name="endedAt" [(ngModel)]="form.clientEndedAt" [max]="today" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="ac-reason">Why</label>
                    <input id="ac-reason" class="form-control" name="reason" [(ngModel)]="form.endReason" maxlength="255" placeholder="e.g. Closed the business" />
                  </div>
                </div>
                <p class="form-hint">Ended clients leave the active list and count toward retention. Their records are kept.</p>
              }
            </div>
          </div>
          @if (dialogError()) { <div class="alert alert-error">{{ dialogError() }}</div> }
        </form>
        <ng-container dialog-actions>
          <button type="button" class="btn btn-ghost" (click)="closeDialog()">Cancel</button>
          <button type="submit" form="account-form" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </app-dialog>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 14px; }
    h2 { margin: 0; font-size: .95rem; font-weight: 600; }
    .attention { border: 1px solid var(--warning); background: var(--warning-bg); border-radius: var(--radius-lg); padding: 12px 16px; font-size: .85rem;
      strong { color: var(--warning-text); }
      ul { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
      li { display: flex; gap: 10px; justify-content: space-between; align-items: baseline; flex-wrap: wrap; }
      li.sev-high span { color: var(--danger-text); font-weight: 500; } }
    .account { padding: 16px 20px; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; }
    .flash { margin-bottom: 10px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin: 0;
      @media (max-width: 720px) { grid-template-columns: 1fr; }
      dt { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); font-weight: 600; margin-bottom: 3px; }
      dd { margin: 0; font-size: .875rem; color: var(--text-primary); }
      .wide { grid-column: 1 / -1; } }
    .note { color: var(--text-secondary); }
    .quick { margin-left: 8px; display: inline-flex; gap: 8px; }
    .linkish { border: none; background: none; padding: 0; color: var(--primary); cursor: pointer; font-size: .8rem; text-decoration: underline; &:disabled { opacity: .5; } }
    .svc { display: inline-block; background: var(--primary-50); color: var(--primary-dark); border-radius: var(--radius-full); padding: 2px 10px; font-size: .78rem; margin: 0 6px 4px 0; }
    .scope { white-space: pre-wrap; color: var(--text-secondary); }
    .overdue { color: var(--danger-text); font-weight: 600; }
    .ended { color: var(--text-muted); font-size: .8rem; margin-top: 2px; }
    .twocol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; @media (max-width: 900px) { grid-template-columns: 1fr; } }
    .list-card { padding: 14px 18px; display: flex; flex-direction: column; gap: 4px; }
    .row { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-top: 1px solid var(--border-light); text-decoration: none; color: inherit; font-size: .85rem; flex-wrap: wrap;
      &:hover .title { color: var(--primary-dark); } }
    .title { color: var(--text-primary); font-weight: 500; }
    .meta { color: var(--text-muted); font-size: .78rem; }
    .upsell { align-self: flex-start; margin-top: 6px; }
    .deal-form { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; input { flex: 1; min-width: 180px; } }
    .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; @media (max-width: 640px) { grid-template-columns: 1fr; } }
    .span2 { grid-column: 1 / -1; }
    .radios { border: none; padding: 0; margin: 0; display: flex; gap: 16px; flex-wrap: wrap; legend { margin-bottom: 4px; } label { font-size: .875rem; display: inline-flex; gap: 6px; align-items: center; } }
    .ended-box { border-top: 1px solid var(--border-light); padding-top: 10px; }
    .check { font-size: .875rem; display: inline-flex; gap: 8px; align-items: center; }
  `],
})
export class ClientAccountComponent {
  readonly store = inject(ClientStore);
  private readonly clients = inject(ClientService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly org = inject(OrganizationContextService);
  private readonly sales = inject(SalesService);
  private readonly router = inject(Router);

  readonly openDeals = signal(Number(inject(ActivatedRoute).snapshot.queryParamMap.get('openDeals')) || 0);
  readonly dealOpen = signal(false);
  readonly dealSaving = signal(false);
  readonly dealError = signal('');
  dealTitle = '';

  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));
  readonly canSell = computed(() => this.org.hasPermission('leads.save'));
  readonly userId = computed(() => this.auth.currentUser()?.id ?? null);
  readonly today = new Date().toISOString().slice(0, 10);

  readonly saving = signal(false);
  readonly error = signal('');
  readonly flash = signal('');
  readonly dialogOpen = signal(false);
  readonly dialogError = signal('');
  readonly kitServices = signal<string[]>([]);
  private kitLoaded = false;
  form: AccountForm = this.formFromProfile();

  readonly missingText = computed(() => (this.store.detail()?.health.missing || []).map((m) => m.label).join(', '));

  billingTone(): string {
    const state = this.store.detail()?.health.billing.state;
    if (state === 'problem') return 'danger';
    if (state === 'cancelling') return 'warning';
    if (state === 'subscribed' || state === 'paid') return 'success';
    return 'muted';
  }

  isPast(date: string): boolean {
    return date < this.today;
  }

  private formFromProfile(): AccountForm {
    const p = this.store.detail()?.profile;
    return {
      accountManagerUserId: p?.accountManagerUserId || '',
      services: [...(p?.services || [])],
      scopeNotes: p?.scopeNotes || '',
      waitingOn: p?.waitingOn || '',
      waitingOnNote: p?.waitingOnNote || '',
      nextActionAt: p?.nextActionAt ? String(p.nextActionAt).slice(0, 10) : '',
      nextActionNote: p?.nextActionNote || '',
      clientSince: p?.clientSince || '',
      ended: Boolean(p?.clientEndedAt),
      clientEndedAt: p?.clientEndedAt || '',
      endReason: p?.endReason || '',
    };
  }

  openDialog(): void {
    this.form = this.formFromProfile();
    this.dialogError.set('');
    this.dialogOpen.set(true);
    if (!this.kitLoaded) {
      this.kitLoaded = true;
      this.settings.workspace().subscribe({ next: (w) => this.kitServices.set((w.salesKit?.services || []).map((s) => s.name)), error: () => undefined });
    }
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  save(): void {
    const f = this.form;
    const p = this.store.detail()?.profile;
    if (!p || this.saving()) return;
    if (f.ended && (!f.clientEndedAt || !f.endReason.trim())) {
      this.dialogError.set('Add the end date and why the client ended.');
      return;
    }
    if (f.ended && !p.clientEndedAt && !confirm('Mark this client as ended? They’ll leave the active client list.')) return;
    const patch: Partial<ClientProfileFields> = {
      accountManagerUserId: f.accountManagerUserId || null,
      services: f.services,
      scopeNotes: f.scopeNotes.trim() || null,
      waitingOn: f.waitingOn || null,
      waitingOnNote: f.waitingOn ? (f.waitingOnNote.trim() || null) : null,
      nextActionAt: f.nextActionAt || null,
      nextActionNote: f.nextActionNote.trim() || null,
      clientSince: f.clientSince || null,
      clientEndedAt: f.ended ? f.clientEndedAt : null,
      endReason: f.ended ? f.endReason.trim() : null,
    };
    this.saving.set(true);
    this.dialogError.set('');
    this.clients.update(this.store.clientId, patch).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.flash.set('Account updated.');
        this.store.refresh();
      },
      error: (err) => {
        this.saving.set(false);
        this.dialogError.set(err.error?.message || 'Not saved — your changes are still here.');
      },
    });
  }

  private quickSave(patch: Partial<ClientProfileFields>, message: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.clients.update(this.store.clientId, patch).subscribe({
      next: () => {
        this.saving.set(false);
        this.flash.set(message);
        this.store.refresh();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.error?.message || 'That change wasn’t saved.');
      },
    });
  }

  /** Waiting on someone asks what for (in the dialog); clearing it is one click. */
  quickWaiting(waitingOn: WaitingOn | null): void {
    if (waitingOn) {
      this.openDialog();
      this.form.waitingOn = waitingOn;
      this.form.waitingOnNote = '';
      return;
    }
    this.quickSave({ waitingOn: null, waitingOnNote: null }, 'Cleared — not waiting on anyone.');
  }

  scrollToWork(): void {
    document.getElementById('open-work')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  createDeal(): void {
    if (this.dealSaving()) return;
    this.dealSaving.set(true);
    this.dealError.set('');
    this.sales.createLead({
      existingOrganizationId: this.store.clientId, title: this.dealTitle.trim() || null, leadData: { name: this.store.detail()?.client.name },
    }).subscribe({
      next: (res) => {
        this.dealSaving.set(false);
        this.router.navigate(['/app/leads', res.opportunityId]);
      },
      error: (err) => {
        this.dealSaving.set(false);
        this.dealError.set(err.error?.message || 'The deal couldn’t be created.');
      },
    });
  }

  assignMe(): void {
    const id = this.userId();
    if (id) this.quickSave({ accountManagerUserId: id }, 'You’re now the client manager.');
  }
}
