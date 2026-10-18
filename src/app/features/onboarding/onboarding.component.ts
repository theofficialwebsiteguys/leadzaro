import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { WorkflowService } from '../../core/services/workflow.service';
import { Onboarding } from '../../core/models/workflow.model';
import { MoneyPipe } from '../sales/shared/sales-format';

const ACCESS = [
  { key: 'unknown', label: 'Not asked yet' }, { key: 'client_has', label: 'Client has access' }, { key: 'we_have', label: 'We have access' },
  { key: 'needs_setup', label: 'Needs to be set up' }, { key: 'not_applicable', label: 'Not applicable' },
];
const CHECKS = [
  { key: 'businessInfo', label: 'Business details confirmed with the client' },
  { key: 'extraContacts', label: 'Additional contacts collected' },
  { key: 'logo', label: 'Logo and brand files' },
  { key: 'photos', label: 'Photos' },
  { key: 'content', label: 'Website text / service details' },
];

/**
 * Client onboarding (ADR 0016): the approved sale handed to its client
 * manager, with everything sales and qualification learned, and the
 * checklist of what's still needed to start the work.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, MoneyPipe],
  template: `
    <div class="page onboarding">
      <a routerLink="/app/my-work" class="back-link">← My Work</a>
      @let o = ob();
      @if (loading() && !o) {
        <div class="loading-state"><div class="spinner"></div><span>Loading onboarding…</span></div>
      } @else if (!o && error()) {
        <div class="alert alert-error">{{ error() }}</div>
      } @else if (o) {
        <header class="o-head">
          <div><p class="eyebrow">Client onboarding @if (o.handoff) { · {{ statusLabel(o.handoff.status) }} }</p><h1>{{ o.business.name }}</h1>
            <p class="sub">Approved {{ o.sale.approvedAt | date: 'MMM d' }}@if (o.sale.salesperson) { · sold by {{ o.sale.salesperson.name }} }@if (o.sale.qualifiedBy) { · qualified by {{ o.sale.qualifiedBy.name }} }@if (o.sale.clientManager) { · client manager {{ o.sale.clientManager.name }} }</p></div>
          @if (o.clientId) { <a class="btn btn-outline" [routerLink]="['/app/clients', o.clientId]">Open client profile →</a> }
        </header>

        @if (o.handoff?.status === 'failed') { <div class="alert alert-error">Client setup failed: {{ o.handoff?.lastError }} — ask an admin to retry it from the lead.</div> }
        @if (o.sale.exception) { <div class="alert alert-info">Approved without a confirmed payment: {{ o.sale.exception }}</div> }

        <div class="o-grid">
          <section class="card block">
            <h2>What we know</h2>
            <dl class="facts">
              <dt>Why we reached out</dt><dd>{{ o.sale.outreachReason || '—' }}</dd>
              <dt>Their need</dt><dd>{{ o.sale.need || '—' }}</dd>
              <dt>Decision-maker</dt><dd>{{ o.sale.decisionMaker || '—' }}</dd>
              <dt>Agreed</dt><dd>@if (o.sale.proposal; as p) { {{ p.service }}@if (p.setupCents) { · {{ p.setupCents | money }} setup }@if (p.recurringCents) { · {{ p.recurringCents | money }}/{{ p.interval }} }@if (p.scope) { <br /><span class="muted">{{ p.scope }}</span> } } @else { — }</dd>
              <dt>Contact</dt><dd>{{ o.business.phone || 'no phone' }} · {{ o.business.email || 'no email' }}</dd>
              <dt>Links</dt><dd>@if (o.business.website) { <a [href]="o.business.website" target="_blank" rel="noopener">Website ↗</a> } @if (o.business.facebookUrl) { <a [href]="o.business.facebookUrl" target="_blank" rel="noopener">Facebook ↗</a> } @if (!o.business.website && !o.business.facebookUrl) { — }</dd>
              <dt>People</dt><dd>@for (c of o.contacts; track c.id) { <span class="pair">{{ c.name }}@if (c.title) { ({{ c.title }}) }@if (c.isPrimary) { · primary }</span> } @empty { — }</dd>
            </dl>
            <details><summary>Sales history ({{ o.history.length }})</summary>
              <ul class="history">@for (h of o.history; track h.id) { <li><span class="muted">{{ h.at | date: 'MMM d' }} · {{ h.user?.name }}</span> {{ h.outcomeLabel || h.subject || h.channel }}@if (h.note) { — {{ h.note }} }</li> }</ul>
            </details>
          </section>

          @if (o.handoff; as h) {
            <section class="card block">
              <h2>Onboarding checklist</h2>
              <ul class="items">@for (i of h.items; track i.key) { <li [class.done]="i.done"><span class="dot"></span>{{ i.label }}@if (i.essential && !i.done) { <span class="tag tag-warning">needed</span> }</li> }</ul>
              <div class="form-group"><label class="form-label" for="o-svc">Agreed services (one per line)</label>
                <textarea id="o-svc" class="form-control" rows="2" [(ngModel)]="services" [disabled]="!o.canEdit"></textarea></div>
              <div class="form-group"><label class="form-label" for="o-req">Project requirements</label>
                <textarea id="o-req" class="form-control" rows="3" [(ngModel)]="form.requirements" [disabled]="!o.canEdit" placeholder="Pages, features, integrations the client asked for"></textarea></div>
              <div class="form-group"><label class="form-label" for="o-prom">Promised work and extras</label>
                <textarea id="o-prom" class="form-control" rows="2" [(ngModel)]="form.promisedWork" [disabled]="!o.canEdit"></textarea></div>
              <div class="grid2">
                <div class="form-group"><label class="form-label" for="o-web">Current website or domain</label><input id="o-web" class="form-control" [(ngModel)]="form.website" [disabled]="!o.canEdit" /></div>
                <div class="form-group"><label class="form-label" for="o-launch">Target launch</label><input id="o-launch" class="form-control" type="date" [(ngModel)]="form.launch" [disabled]="!o.canEdit" /></div>
                <div class="form-group"><label class="form-label" for="o-reg">Domain registrar access</label>
                  <select id="o-reg" class="form-select" [(ngModel)]="form.registrarAccess" [disabled]="!o.canEdit">@for (a of access; track a.key) { <option [value]="a.key">{{ a.label }}</option> }</select></div>
                <div class="form-group"><label class="form-label" for="o-host">Hosting access</label>
                  <select id="o-host" class="form-select" [(ngModel)]="form.hostingAccess" [disabled]="!o.canEdit">@for (a of access; track a.key) { <option [value]="a.key">{{ a.label }}</option> }</select></div>
              </div>
              <p class="hint">Record who has access — never passwords.</p>
              <div class="checks">@for (c of checks; track c.key) { <label><input type="checkbox" [(ngModel)]="form.checklist[c.key]" [disabled]="!o.canEdit" /> {{ c.label }}</label> }</div>
              <div class="form-group"><label class="form-label" for="o-miss">Still missing to start</label>
                <textarea id="o-miss" class="form-control" rows="2" [(ngModel)]="form.missingInfo" [disabled]="!o.canEdit"></textarea></div>
              @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
              @if (notice()) { <p class="saved" role="status">{{ notice() }}</p> }
              @if (o.canEdit) {
                <div class="actions">
                  <button class="btn btn-outline" (click)="save(false)" [disabled]="busy()">Save</button>
                  @if (h.status !== 'complete') { <button class="btn btn-primary" (click)="save(true)" [disabled]="busy()">Onboarding complete</button> }
                </div>
              }
            </section>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .back-link { font-size: .8125rem; color: var(--text-muted); text-decoration: none; }
    .o-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin: 8px 0 16px;
      h1 { font-family: var(--font-display); font-size: 1.6rem; margin: 2px 0 0; } .sub { color: var(--text-muted); margin: 4px 0 0; font-size: .85rem; } }
    .eyebrow { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); margin: 0; font-weight: 600; }
    .o-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; align-items: start; @media (max-width: 960px) { grid-template-columns: 1fr; } }
    .block { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; h2 { margin: 0; font-size: 1rem; } }
    .facts { display: grid; grid-template-columns: 130px 1fr; gap: 6px 10px; margin: 0; font-size: .85rem; dt { color: var(--text-muted); } dd { margin: 0; } a { margin-right: 10px; } .pair { display: block; } }
    .muted { color: var(--text-muted); font-size: .8rem; }
    .history { padding-left: 16px; font-size: .8125rem; li { margin: 4px 0; } }
    .items { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: .8125rem;
      li { display: flex; align-items: center; gap: 6px; color: var(--text-muted); } li.done { color: var(--text-primary); }
      .dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--border); flex-shrink: 0; } li.done .dot { background: var(--success); border-color: var(--success); }
      @media (max-width: 600px) { grid-template-columns: 1fr; } }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; @media (max-width: 600px) { grid-template-columns: 1fr; } }
    .checks { display: flex; flex-direction: column; gap: 6px; font-size: .85rem; input { accent-color: var(--primary); margin-right: 6px; } }
    .hint { font-size: .75rem; color: var(--text-muted); margin: 0; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .saved { color: var(--success); font-size: .8rem; margin: 0; }
  `],
})
export class OnboardingComponent implements OnInit, OnDestroy {
  private readonly workflow = inject(WorkflowService);
  private readonly route = inject(ActivatedRoute);

  readonly access = ACCESS;
  readonly checks = CHECKS;
  readonly ob = signal<Onboarding | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  private id = '';

  services = '';
  form = {
    requirements: '', promisedWork: '', website: '', launch: '', registrarAccess: 'unknown', hostingAccess: 'unknown', missingInfo: '', checklist: {} as Record<string, boolean>,
  };

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.id = params.get('id')!;
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.workflow.focusLead.set(null);
  }

  load(): void {
    this.loading.set(true);
    this.workflow.onboarding(this.id).subscribe({
      next: (o) => { this.apply(o); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(err.status === 404 ? 'This onboarding isn’t assigned to you.' : (err.error?.message || 'Couldn’t load the onboarding.')); },
    });
  }

  private apply(o: Onboarding): void {
    this.ob.set(o);
    this.workflow.focusLead.set({ id: o.opportunityId, name: o.business.name });
    const d = o.handoff?.data;
    if (!d) return;
    this.services = (d.agreedServices || []).join('\n');
    this.form = {
      requirements: d.requirements || '',
      promisedWork: d.promisedWork || '',
      website: d.website || '',
      launch: d.targetDates?.launch || '',
      registrarAccess: d.registrarAccess || 'unknown',
      hostingAccess: d.hostingAccess || 'unknown',
      missingInfo: d.missingInfo || '',
      checklist: { ...(d.checklist || {}) },
    };
  }

  statusLabel(status: string): string {
    return ({ pending: 'In progress', needs_info: 'Missing essentials', complete: 'Complete', failed: 'Setup failed' } as Record<string, string>)[status] ?? status;
  }

  save(complete: boolean): void {
    this.busy.set(true);
    this.error.set('');
    const body = {
      requirements: this.form.requirements,
      promisedWork: this.form.promisedWork,
      missingInfo: this.form.missingInfo,
      website: this.form.website,
      registrarAccess: this.form.registrarAccess,
      hostingAccess: this.form.hostingAccess,
      targetDates: { launch: this.form.launch || null },
      checklist: this.form.checklist,
      agreedServices: this.services.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    this.workflow.saveOnboarding(this.id, body, complete).subscribe({
      next: (o) => {
        this.busy.set(false);
        this.apply(o);
        this.notice.set(complete ? 'Onboarding marked complete.' : 'Saved.');
        setTimeout(() => this.notice.set(''), 3000);
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — your entries are still here.'); },
    });
  }
}
