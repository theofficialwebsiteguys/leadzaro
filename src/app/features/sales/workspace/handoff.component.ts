import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SalesService } from '../../../core/services/sales.service';
import { Handoff, HandoffData, HandoffItem, Workspace } from '../../../core/models/sales.model';
import { MoneyPipe } from '../shared/sales-format';
import { ServicesInputComponent } from '../../clients/services-input/services-input.component';

/**
 * The guided handoff (ADR 0011): what the sale carries into the client
 * record, what’s still missing (as onboarding items, never blockers) and
 * a retry when the client setup failed after payment.
 */
@Component({
  selector: 'app-handoff',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, MoneyPipe, ServicesInputComponent],
  template: `
    @if (!handoff()) {
      <div class="muted-box">
        The handoff starts automatically when the first payment is received — Leadzaro creates the client, carries over what you know and lists what’s still needed.
      </div>
    } @else {
      @let h = handoff()!;
      <div class="handoff">
        <ol class="steps" aria-label="Handoff progress">
          <li class="done"><span class="n">✓</span> Payment received</li>
          <li [class.done]="h.status !== 'failed'" [class.bad]="h.status === 'failed'"><span class="n">{{ h.status === 'failed' ? '!' : '✓' }}</span> Client set up</li>
          <li [class.done]="h.status === 'complete'"><span class="n">{{ h.status === 'complete' ? '✓' : '3' }}</span> Details confirmed for the team</li>
        </ol>

        <div class="status" [attr.data-status]="h.status">
          @switch (h.status) {
            @case ('failed') {
              <div><strong>Payment received, but the client setup didn’t finish.</strong><p>{{ h.lastError }}</p></div>
              <button class="btn btn-primary btn-sm" (click)="retry()" [disabled]="busy()">{{ busy() ? 'Retrying…' : 'Retry client setup' }}</button>
            }
            @case ('complete') { <div><strong>Handed off</strong><p>Completed {{ h.completedAt | date: 'MMM d, y' }}. The client team works from the brief below — you can still update it.</p></div> }
            @case ('needs_info') { <div><strong>{{ h.missingEssential }} essential item{{ h.missingEssential === 1 ? '' : 's' }} still needed</strong><p>Fill in what you know below. Anything still missing when you finish becomes an onboarding item for the team.</p></div> }
            @default { <div><strong>Ready to hand off</strong><p>Check the brief, then mark the handoff complete.</p></div> }
          }
          @if (ws().clientId) { <a class="btn btn-ghost btn-sm" [routerLink]="['/app/clients', ws().clientId]">Open client →</a> }
        </div>

        @if (h.status === 'failed' && error()) { <div class="alert alert-error">{{ error() }}</div> }
        @if (h.status !== 'failed') {
          <!-- The brief: what the client team reads first -->
          <section class="brief" aria-label="Handoff brief">
            <h4>Handoff brief for the client team</h4>
            <div class="brief-grid">
              <div><span class="lbl">What they bought</span>
                @if (h.data.agreedServices.length) { <div class="chips">@for (sv of h.data.agreedServices; track sv) { <span class="chip">{{ sv }}</span> }</div> }
                @else { <span class="missing">Not recorded yet</span> }
                @if (h.data.pricing; as p) { <span class="line">{{ p.initialAmountCents | money: p.currency }} at start@if (p.recurringAmountCents) {, then {{ p.recurringAmountCents | money: p.currency }}/{{ p.recurringInterval }} }</span> }
              </div>
              <div><span class="lbl">Paid</span>
                @if (h.data.payment; as pay) { <span>{{ pay.amountCents | money: pay.currency }} on {{ pay.paidAt | date: 'MMM d, y' }}</span><span class="line">{{ pay.source === 'stripe' ? 'Confirmed by Stripe' : 'Recorded manually' }}</span> }
                @else { <span class="missing">No payment on record</span> }
              </div>
              <div><span class="lbl">Main contact</span>
                @if (primaryContact(h); as c) { <span>{{ c.name }}</span><span class="line">{{ c.email || 'no email' }} · {{ c.phone || 'no phone' }}</span> }
                @else { <span class="missing">No contact — add one on the lead</span> }
              </div>
              <div><span class="lbl">Dates</span>
                <span>Kickoff: {{ h.data.targetDates.kickoff ? (h.data.targetDates.kickoff | date: 'MMM d, y') : 'not set' }}</span>
                <span class="line">Launch: {{ h.data.targetDates.launch ? (h.data.targetDates.launch | date: 'MMM d, y') : 'not set' }}</span>
              </div>
              <div><span class="lbl">Access</span>
                <span>Registrar: {{ accessLabel(h, h.data.registrarAccess) }}</span>
                <span class="line">Hosting: {{ accessLabel(h, h.data.hostingAccess) }}</span>
              </div>
              <div><span class="lbl">Sold by</span><span>{{ h.data.ownerName || '—' }}</span><span class="line">{{ h.data.website || 'No current website' }}</span></div>
              <div class="wide"><span class="lbl">Promised during the sale</span>
                @if (h.data.promisedWork) { <p class="pre">{{ h.data.promisedWork }}</p> } @else { <span class="muted">Nothing extra recorded</span> }
              </div>
              @if (missing(h).length) {
                <div class="wide"><span class="lbl">Still missing</span>
                  <ul class="missing-list">@for (item of missing(h); track item.key) { <li><strong>{{ item.label }}</strong>@if (item.essential) { <span class="tag tag-warning">needed</span> } — {{ item.hint }}</li> }</ul>
                </div>
              }
            </div>
          </section>

          <section class="panel form">
            <h4>Update the brief</h4>
            <p class="step-title">1 · What was sold</p>
            <div class="form-group">
              <label class="form-label" for="ho-services">Agreed services</label>
              <app-services-input inputId="ho-services" [(services)]="services" [suggestions]="kitServices()" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ho-promised">Promised work and extras</label>
              <textarea id="ho-promised" class="form-control" rows="3" [(ngModel)]="draft.promisedWork" placeholder="Anything promised during the sale — pages, features, timelines. What’s NOT included helps too."></textarea>
            </div>

            <p class="step-title">2 · Dates &amp; access</p>
            <div class="row3">
              <div class="form-group"><label class="form-label" for="ho-web">Current website</label><input id="ho-web" class="form-control" [(ngModel)]="draft.website" /></div>
              <div class="form-group"><label class="form-label" for="ho-kick">Kickoff date</label><input id="ho-kick" class="form-control" type="date" [(ngModel)]="draft.targetDates.kickoff" /></div>
              <div class="form-group"><label class="form-label" for="ho-launch">Target launch</label><input id="ho-launch" class="form-control" type="date" [(ngModel)]="draft.targetDates.launch" /></div>
            </div>
            <div class="row2">
              <div class="form-group">
                <label class="form-label" for="ho-reg">Domain registrar access</label>
                <select id="ho-reg" class="form-select" [(ngModel)]="draft.registrarAccess">@for (st of h.accessStates; track st.key) { <option [value]="st.key">{{ st.label }}</option> }</select>
              </div>
              <div class="form-group">
                <label class="form-label" for="ho-host">Hosting access</label>
                <select id="ho-host" class="form-select" [(ngModel)]="draft.hostingAccess">@for (st of h.accessStates; track st.key) { <option [value]="st.key">{{ st.label }}</option> }</select>
              </div>
            </div>
            <p class="form-hint">Record who has access — never passwords. Credentials belong in your password manager.</p>

            <p class="step-title">3 · Brand, content &amp; social</p>
            <div class="checks">
              <label><input type="checkbox" [(ngModel)]="draft.checklist.logo" /> Logo &amp; brand files received</label>
              <label><input type="checkbox" [(ngModel)]="draft.checklist.photos" /> Photos received</label>
              <label><input type="checkbox" [(ngModel)]="draft.checklist.content" /> Website text received</label>
              @if (ws().clientId) { <a class="text-sm" [routerLink]="['/app/clients', ws().clientId, 'media']">Upload files to the client’s Media tab →</a> }
            </div>
            <div class="row2">
              <div class="form-group"><label class="form-label" for="ho-fb">Facebook</label><input id="ho-fb" class="form-control" [(ngModel)]="draft.socialLinks.facebook" placeholder="https://" /></div>
              <div class="form-group"><label class="form-label" for="ho-ig">Instagram</label><input id="ho-ig" class="form-control" [(ngModel)]="draft.socialLinks.instagram" placeholder="https://" /></div>
              <div class="form-group"><label class="form-label" for="ho-li">LinkedIn</label><input id="ho-li" class="form-control" [(ngModel)]="draft.socialLinks.linkedin" placeholder="https://" /></div>
              <div class="form-group"><label class="form-label" for="ho-g">Google profile</label><input id="ho-g" class="form-control" [(ngModel)]="draft.socialLinks.google" placeholder="https://" /></div>
            </div>

            <p class="step-title">4 · Notes for the team</p>
            <div class="form-group">
              <label class="form-label" for="ho-notes">Sales notes (context, personalities, anything to watch for)</label>
              <textarea id="ho-notes" class="form-control" rows="4" [(ngModel)]="draft.salesNotes"></textarea>
            </div>
            @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
            @if (notice()) { <div class="alert alert-success" role="status">{{ notice() }}</div> }
            <div class="actions">
              <span class="text-xs text-muted">Saved details go straight to the client record (services, scope, dates and a summary note).</span>
              <button class="btn btn-outline" (click)="save(false)" [disabled]="busy()">Save</button>
              <button class="btn btn-primary" (click)="save(true)" [disabled]="busy()">{{ h.status === 'complete' ? 'Save changes' : 'Mark handoff complete' }}</button>
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    .handoff { display: flex; flex-direction: column; gap: 14px; }
    .status {
      display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 14px 16px; border-radius: var(--radius-lg); background: var(--primary-50); border: 1px solid var(--primary-100);
      p { margin: 2px 0 0; font-size: .8125rem; color: var(--text-secondary); }
      &[data-status='failed'] { background: var(--danger-bg); border-color: #FCA5A5; }
      &[data-status='complete'] { background: var(--success-bg); border-color: #A7F3D0; }
      &[data-status='needs_info'] { background: var(--warning-bg); border-color: #FCD34D; }
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; @media (max-width: 900px) { grid-template-columns: 1fr; } }
    .panel { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; h4 { margin: 0 0 12px; font-size: .95rem; } }
    .form { display: flex; flex-direction: column; gap: 12px; }
    .items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;
      li { display: flex; gap: 10px; font-size: .8125rem; align-items: flex-start; }
      small { display: block; color: var(--text-muted); font-size: .72rem; }
      .dot { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border); display: grid; place-items: center; font-size: .7rem; flex-shrink: 0; color: #fff; }
      li.done .dot { background: var(--success); border-color: var(--success); }
      li.done > span:last-child { color: var(--text-muted); }
    }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; @media (max-width: 560px) { grid-template-columns: 1fr; } }
    .row3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; @media (max-width: 720px) { grid-template-columns: 1fr; } }
    .checks { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; font-size: .8125rem; label { display: flex; gap: 6px; align-items: center; } input { accent-color: var(--primary); } }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; span { flex: 1; min-width: 200px; } }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; font-size: .8rem; color: var(--text-muted);
      li { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border-radius: var(--radius-full); background: var(--bg-2); }
      .n { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--border); color: #fff; font-size: .7rem; font-weight: 700; }
      li.done { color: var(--success-text); .n { background: var(--success); } }
      li.bad { color: var(--danger-text); .n { background: var(--danger); } } }
    .brief { border: 1px solid var(--primary-light); border-radius: var(--radius-lg); padding: 16px; background: var(--card);
      h4 { margin: 0 0 12px; font-size: 1rem; } }
    .brief-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 18px; font-size: .85rem;
      @media (max-width: 900px) { grid-template-columns: 1fr 1fr; } @media (max-width: 560px) { grid-template-columns: 1fr; }
      > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .wide { grid-column: 1 / -1; }
      .lbl { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); font-weight: 700; margin-bottom: 2px; }
      .line { color: var(--text-secondary); font-size: .8rem; }
      .missing { color: var(--warning-text); }
      .muted { color: var(--text-muted); }
      .pre { white-space: pre-wrap; margin: 0; color: var(--text-secondary); } }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { background: var(--primary-50); color: var(--primary-dark); border-radius: var(--radius-full); padding: 1px 9px; font-size: .78rem; font-weight: 500; }
    .missing-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; color: var(--text-secondary); }
    .step-title { margin: 6px 0 0; font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--primary-dark); }
  `],
})
export class HandoffComponent {
  private readonly sales = inject(SalesService);

  readonly ws = input.required<Workspace>();
  readonly changed = output<void>();

  readonly handoff = computed<Handoff | null>(() => this.ws().handoff);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  draft: HandoffData = this.blank();
  services: string[] = [];
  /** Service names from the Sales kit, so the same service is always named the same way. */
  readonly kitServices = computed(() => (this.ws().salesKit?.services || []).map((sv) => sv.name));

  constructor() {
    effect(() => {
      const h = this.handoff();
      if (!h) return;
      const d = h.data;
      this.draft = {
        ...this.blank(),
        ...d,
        targetDates: { kickoff: d.targetDates?.kickoff ?? null, launch: d.targetDates?.launch ?? null },
        socialLinks: Object.assign({ facebook: '', instagram: '', linkedin: '', google: '' }, d.socialLinks ?? {}),
        checklist: Object.assign({ logo: false, photos: false, content: false }, d.checklist ?? {}),
      };
      this.services = [...(d.agreedServices ?? [])];
    });
  }

  private blank(): HandoffData {
    return {
      businessName: '', website: null, domain: null, phone: null, email: null, address: { line1: null, city: null, state: null, postalCode: null },
      contacts: [], agreedServices: [], pricing: null, payment: null, salesNotes: '', promisedWork: '', targetDates: { kickoff: null, launch: null },
      registrarAccess: 'unknown', hostingAccess: 'unknown', socialLinks: { facebook: '', instagram: '', linkedin: '', google: '' },
      checklist: { logo: false, photos: false, content: false }, ownerName: null,
    };
  }

  missing(h: Handoff): HandoffItem[] {
    return (h.items || []).filter((i) => !i.done).sort((a, b) => Number(b.essential) - Number(a.essential));
  }

  primaryContact(h: Handoff) {
    return (h.data.contacts || []).find((c) => c.isPrimary) ?? h.data.contacts?.[0] ?? null;
  }

  accessLabel(h: Handoff, key: string): string {
    return h.accessStates.find((st) => st.key === key)?.label ?? 'Not asked yet';
  }

  addressText(h: Handoff): string {
    const a = h.data.address;
    return [a?.line1, a?.city, a?.state, a?.postalCode].filter((part) => !!part).join(', ') || '—';
  }

  save(complete: boolean): void {
    const h = this.handoff();
    if (complete && h && h.status !== 'complete' && h.missingEssential > 0
      && !confirm(`${h.missingEssential} essential item${h.missingEssential === 1 ? ' is' : 's are'} still missing. They’ll stay on the client as onboarding items. Mark the handoff complete anyway?`)) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    const d = this.draft;
    const body: Partial<HandoffData> = {
      agreedServices: this.services,
      promisedWork: d.promisedWork,
      salesNotes: d.salesNotes,
      website: d.website,
      targetDates: d.targetDates,
      registrarAccess: d.registrarAccess,
      hostingAccess: d.hostingAccess,
      socialLinks: d.socialLinks,
      checklist: d.checklist,
    };
    const request = complete ? this.sales.completeHandoff(this.ws().opportunity.id, body) : this.sales.saveHandoff(this.ws().opportunity.id, body);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(complete ? 'Handoff complete — the details are on the client record.' : 'Saved to the client record.');
        this.changed.emit();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — your entries are still here.'); },
    });
  }

  retry(): void {
    this.busy.set(true);
    this.error.set('');
    this.sales.retryHandoff(this.ws().opportunity.id).subscribe({
      next: () => { this.busy.set(false); this.changed.emit(); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'The retry failed.'); },
    });
  }
}
