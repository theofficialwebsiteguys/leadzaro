import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { PhoneInputDirective } from '../../../shared/forms/formatted-inputs';
import { ClientService } from '../../../core/services/client.service';
import { SettingsService } from '../../../core/services/settings.service';
import { DomainService } from '../../../core/services/domain.service';
import { DomainLookupState } from '../../domains/domain-lookup';
import { DomainMatchComponent } from '../../domains/domain-match.component';
import {
  BILLING_FREQUENCIES, BILLING_FREQUENCY_LABELS, BillingFrequency, ExistingClientInput, PAYMENT_STATUSES, PaymentStatus, PossibleDuplicate, TeamMember,
} from '../../../core/models/client.model';
import { ServicesInputComponent } from '../services-input/services-input.component';

interface ExistingClientForm {
  name: string;
  websiteUrl: string;
  contact: { name: string; email: string; phone: string; title: string };
  accountManagerUserId: string;
  services: string[];
  clientSince: string;
  recurringPrice: number | null;
  billingFrequency: BillingFrequency | '';
  paymentStatus: PaymentStatus | '';
  nextActionAt: string;
  nextActionNote: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Add existing client" (ADR 0013): a business that already pays us, added
 * directly — never counted as a new sale. The server checks Leads and
 * Clients for the same business first; the matches are shown here so the
 * person can open the existing record, turn a lead into this client, or
 * confirm it's a different business.
 */
@Component({
  selector: 'app-add-client-dialog',
  standalone: true,
  imports: [FormsModule, RouterLink, DialogComponent, PhoneInputDirective, DomainMatchComponent, ServicesInputComponent],
  template: `
    <app-dialog title="Add an existing client" [open]="open()" (closed)="close()" [wide]="true">
      @if (duplicates().length) {
        <div class="dupes" role="alert">
          <p><strong>This business may already be in Leadzaro.</strong> Adding it again would create a duplicate.</p>
          @for (d of duplicates(); track d.organizationId) {
            <div class="dupe">
              <div>
                <strong>{{ d.name }}</strong> <span class="tag" [class.tag-success]="d.isClient" [class.tag-info]="!d.isClient">{{ d.isClient ? 'Client' : 'Lead' }}</span>
                <div class="text-xs text-muted">Matched on {{ d.reasons.join(', ') }}@if (d.stageLabel) { · {{ d.stageLabel }} }@if (d.assignedTo) { · {{ d.assignedTo.name }} }</div>
              </div>
              <div class="dupe-actions">
                @if (d.isClient) {
                  <a class="btn btn-outline btn-sm" [routerLink]="['/app/clients', d.organizationId]" (click)="close()">Open client</a>
                } @else {
                  @if (d.opportunityId) { <a class="btn btn-ghost btn-sm" [routerLink]="['/app/leads', d.opportunityId]" (click)="close()">Open lead</a> }
                  <button type="button" class="btn btn-primary btn-sm" [disabled]="saving()" (click)="submit({ useOrganizationId: d.organizationId })">Make this lead the client</button>
                }
              </div>
            </div>
          }
          <button type="button" class="btn btn-ghost btn-sm" [disabled]="saving()" (click)="submit({ confirmNew: true })">It’s a different business — add it anyway</button>
        </div>
      }

      <form id="existing-client-form" (ngSubmit)="submit()" novalidate>
        <p class="form-hint intro">For a business that’s already a client. It’s added to your client base but not counted as a new sale.</p>
        <div class="grid">
          <div class="form-group span2">
            <label class="form-label" for="ec-name">Business name <span class="req">*</span></label>
            <input id="ec-name" class="form-control" name="name" [(ngModel)]="form.name" required maxlength="255" autocomplete="off" [class.is-invalid]="tried && !form.name.trim()" />
            @if (tried && !form.name.trim()) { <span class="form-error">Enter the business name.</span> }
          </div>
          <div class="form-group span2">
            <label class="form-label" for="ec-web">Website</label>
            <input id="ec-web" class="form-control" name="websiteUrl" [(ngModel)]="form.websiteUrl" placeholder="example.com" autocomplete="off" (blur)="websiteLookup.check(form.websiteUrl)" />
            <app-domain-match [lookup]="websiteLookup.result()" [checking]="websiteLookup.checking()" [lookupFailed]="websiteLookup.failed()" />
          </div>

          <p class="eyebrow span2">Main contact</p>
          <div class="form-group">
            <label class="form-label" for="ec-cname">Name</label>
            <input id="ec-cname" class="form-control" name="cname" [(ngModel)]="form.contact.name" maxlength="255" autocomplete="off" [class.is-invalid]="contactNameMissing()" />
            @if (contactNameMissing()) { <span class="form-error">Add their name, or clear the contact fields.</span> }
          </div>
          <div class="form-group">
            <label class="form-label" for="ec-ctitle">Role</label>
            <input id="ec-ctitle" class="form-control" name="ctitle" [(ngModel)]="form.contact.title" maxlength="150" placeholder="e.g. Owner" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label" for="ec-cemail">Email</label>
            <input id="ec-cemail" type="email" class="form-control" name="cemail" [(ngModel)]="form.contact.email" autocomplete="off" [class.is-invalid]="emailInvalid()" />
            @if (emailInvalid()) { <span class="form-error">That email doesn’t look right.</span> }
          </div>
          <div class="form-group">
            <label class="form-label" for="ec-cphone">Phone</label>
            <input id="ec-cphone" class="form-control" name="cphone" [(ngModel)]="form.contact.phone" lzPhone autocomplete="off" />
          </div>

          <p class="eyebrow span2">Account</p>
          <div class="form-group">
            <label class="form-label" for="ec-mgr">Client manager</label>
            <select id="ec-mgr" class="form-select" name="mgr" [(ngModel)]="form.accountManagerUserId">
              <option value="">No one yet</option>
              @for (m of team(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }
            </select>
            <span class="form-hint">Who looks after this client day to day.</span>
          </div>
          <div class="form-group">
            <label class="form-label" for="ec-since">Client since</label>
            <input id="ec-since" type="date" class="form-control" name="since" [(ngModel)]="form.clientSince" [max]="today" />
            <span class="form-hint">Roughly when they started — leave blank if unsure.</span>
          </div>
          <div class="form-group span2">
            <label class="form-label" for="ec-services">Services they have</label>
            <app-services-input inputId="ec-services" [(services)]="form.services" [suggestions]="kitServices()" />
          </div>

          <details class="span2" [open]="billingOpen">
            <summary>Billing (optional)</summary>
            <div class="grid inner">
              <div class="form-group">
                <label class="form-label" for="ec-price">Recurring price ($)</label>
                <input id="ec-price" type="number" min="0" step="0.01" class="form-control" name="price" [(ngModel)]="form.recurringPrice" />
              </div>
              <div class="form-group">
                <label class="form-label" for="ec-freq">Billed</label>
                <select id="ec-freq" class="form-select" name="freq" [(ngModel)]="form.billingFrequency">
                  <option value="">—</option>
                  @for (f of frequencies; track f) { <option [value]="f">{{ frequencyLabels[f] }}</option> }
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="ec-pay">Payment status</label>
                <select id="ec-pay" class="form-select" name="pay" [(ngModel)]="form.paymentStatus">
                  <option value="">—</option>
                  @for (s of paymentStatuses; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
            </div>
            <p class="form-hint">If they pay through Stripe, link their Stripe customer from the client’s Billing tab (or “Match with Stripe” on the Clients page) instead.</p>
          </details>

          <div class="form-group">
            <label class="form-label" for="ec-next">Next client action</label>
            <input id="ec-next" type="date" class="form-control" name="next" [(ngModel)]="form.nextActionAt" />
          </div>
          <div class="form-group">
            <label class="form-label" for="ec-nextnote">What needs doing</label>
            <input id="ec-nextnote" class="form-control" name="nextnote" [(ngModel)]="form.nextActionNote" maxlength="255" placeholder="e.g. Quarterly check-in call" />
          </div>
        </div>
        @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
        <button type="submit" form="existing-client-form" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Adding…' : 'Add client' }}</button>
      </ng-container>
    </app-dialog>
  `,
  styles: [`
    .intro { margin: 0 0 10px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; @media (max-width: 640px) { grid-template-columns: 1fr; } }
    .grid.inner { margin-top: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); @media (max-width: 640px) { grid-template-columns: 1fr; } }
    .span2 { grid-column: 1 / -1; }
    .eyebrow { margin: 8px 0 0; }
    .req { color: var(--danger); }
    details { border: 1px solid var(--border-light); border-radius: var(--radius); padding: 10px 12px; summary { cursor: pointer; font-size: .85rem; font-weight: 600; color: var(--text-secondary); } }
    .dupes { background: var(--warning-bg); border: 1px solid var(--warning); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 8px;
      p { margin: 0; font-size: .85rem; color: var(--warning-text); } }
    .dupe { display: flex; justify-content: space-between; gap: 12px; align-items: center; background: var(--card); border-radius: var(--radius); padding: 8px 10px; flex-wrap: wrap; font-size: .85rem; }
    .dupe-actions { display: flex; gap: 6px; }
  `],
})
export class AddClientDialogComponent {
  private readonly clients = inject(ClientService);
  private readonly settings = inject(SettingsService);
  readonly websiteLookup = new DomainLookupState(inject(DomainService));

  readonly open = input(false);
  readonly team = input<TeamMember[]>([]);
  readonly currentUserId = input<string | null>(null);
  readonly closed = output<void>();
  readonly created = output<{ id: string; createdFrom: 'new' | 'lead'; openDeals: number }>();

  readonly frequencies = BILLING_FREQUENCIES;
  readonly frequencyLabels = BILLING_FREQUENCY_LABELS;
  readonly paymentStatuses = PAYMENT_STATUSES;
  readonly today = new Date().toISOString().slice(0, 10);

  readonly saving = signal(false);
  readonly error = signal('');
  readonly duplicates = signal<PossibleDuplicate[]>([]);
  readonly kitServices = signal<string[]>([]);
  form: ExistingClientForm = this.blank();
  tried = false;
  billingOpen = false;
  private kitLoaded = false;

  constructor() {
    effect(() => {
      if (this.open()) this.reset();
    });
  }

  private blank(): ExistingClientForm {
    return {
      name: '',
      websiteUrl: '',
      contact: {
        name: '', email: '', phone: '', title: '',
      },
      accountManagerUserId: this.currentUserId() || '',
      services: [],
      clientSince: '',
      recurringPrice: null,
      billingFrequency: '',
      paymentStatus: '',
      nextActionAt: '',
      nextActionNote: '',
    };
  }

  private reset(): void {
    this.form = this.blank();
    this.tried = false;
    this.error.set('');
    this.duplicates.set([]);
    this.websiteLookup.reset();
    if (!this.kitLoaded) {
      this.kitLoaded = true;
      this.settings.workspace().subscribe({
        next: (w) => this.kitServices.set((w.salesKit?.services || []).map((s) => s.name)),
        error: () => this.kitServices.set([]),
      });
    }
  }

  emailInvalid(): boolean {
    return Boolean(this.form.contact.email.trim()) && !EMAIL.test(this.form.contact.email.trim());
  }

  contactNameMissing(): boolean {
    const c = this.form.contact;
    return this.tried && !c.name.trim() && Boolean(c.email.trim() || c.phone.trim());
  }

  close(): void {
    this.closed.emit();
  }

  submit(extra: { confirmNew?: boolean; useOrganizationId?: string } = {}): void {
    this.tried = true;
    if (!this.form.name.trim() || this.emailInvalid() || this.contactNameMissing() || this.saving()) return;
    const f = this.form;
    const contact = f.contact.name.trim() || f.contact.email.trim() || f.contact.phone.trim()
      ? {
        name: f.contact.name.trim(), email: f.contact.email.trim(), phone: f.contact.phone.trim(), title: f.contact.title.trim(),
      }
      : null;
    const body: ExistingClientInput = {
      name: f.name.trim(),
      websiteUrl: f.websiteUrl.trim() || null,
      services: f.services,
      accountManagerUserId: f.accountManagerUserId || null,
      clientSince: f.clientSince || null,
      recurringPriceCents: f.recurringPrice !== null && f.recurringPrice !== undefined && String(f.recurringPrice) !== '' ? Math.round(Number(f.recurringPrice) * 100) : null,
      billingFrequency: f.billingFrequency || null,
      paymentStatus: f.paymentStatus || null,
      nextActionAt: f.nextActionAt || null,
      nextActionNote: f.nextActionNote.trim() || null,
      contact,
      ...extra,
    };
    this.saving.set(true);
    this.error.set('');
    this.clients.createExisting(body).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.created.emit({ id: res.data.client.id, createdFrom: res.data.createdFrom, openDeals: res.data.openDeals });
      },
      error: (err) => {
        this.saving.set(false);
        const dupes = err.error?.details?.possibleDuplicates as PossibleDuplicate[] | undefined;
        if (err.status === 409 && dupes?.length) {
          this.duplicates.set(dupes);
          return;
        }
        const existing = err.error?.details?.existingClientId as string | undefined;
        this.duplicates.set([]);
        this.error.set(existing ? `${err.error.message}. Open it from the Clients list instead.` : (err.error?.message || 'The client couldn’t be added — your details are still here.'));
      },
    });
  }
}
