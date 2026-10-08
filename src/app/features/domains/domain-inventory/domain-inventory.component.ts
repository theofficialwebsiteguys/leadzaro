import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DomainService } from '../../../core/services/domain.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { InventoryFilter, InventoryResponse } from '../../../core/models/domain.model';

/** Every domain the workspace knows about — the main Domains view (ADR 0010). */
@Component({
  selector: 'app-domain-inventory',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    @let data = inventory();
    @if (data) {
      <p class="sync" [class]="'sync sync-' + data.sync.state">
        @switch (data.sync.state) {
          @case ('ok') { Last complete sync {{ data.sync.lastSuccessfulSyncAt | date:'MMM d, h:mm a' }} · {{ data.sync.domainsInAccount ?? 0 }} domain{{ data.sync.domainsInAccount === 1 ? '' : 's' }} in the Namecheap account{{ data.sync.domainsInAccount === 0 ? ' (the account returned none)' : '' }} }
          @case ('syncing') { Syncing with Namecheap… }
          @case ('never_synced') { Connected, but the domain list hasn’t been imported yet. @if (isAdmin()) { Use “Sync now”. } }
          @case ('incomplete') { The last sync was incomplete — some pages or details couldn’t be read; earlier data is kept. {{ data.sync.lastError }} }
          @case ('failed') { The last sync failed: {{ data.sync.lastError || 'unknown error' }}. Showing the last imported data. }
          @default { Namecheap isn’t connected — only domains added by hand are listed. }
        }
      </p>
    }
    <div class="toolbar">
      <input class="form-control search" type="search" placeholder="Search domains, clients or projects" [ngModel]="q()" (ngModelChange)="search($event)" aria-label="Search domains" />
      <div class="chips">
        @for (f of filters; track f.key) {
          <button class="chip" [class.active]="filter() === f.key" (click)="setFilter(f.key)">{{ f.label }}@if (data) { <span class="count">{{ data.counts[f.key] }}</span> }</button>
        }
      </div>
    </div>
    @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
    @else if (!data) { <p class="text-muted">Loading domains…</p> }
    @else if (!data.items.length) {
      <p class="empty">@if (q()) { No domains match “{{ q() }}”. } @else if (data.total === 0) { No domains yet. } @else { No domains in this view. }</p>
    } @else {
      <div class="card table">
        <div class="row head"><span>Domain</span><span>Client / project</span><span>Status</span><span>Nameservers</span><span>Expires</span><span>Auto-renew</span></div>
        @for (item of data.items; track item.id) {
          <a class="row" [routerLink]="['/app/domains', item.id]">
            <span class="name"><strong>{{ item.displayName }}</strong>@if (item.attention.length) { <span class="flag" [title]="item.attention.join(' · ')">needs attention</span> }</span>
            <span>@if (item.clients.length) { @for (c of item.clients; track c.id; let last = $last) { {{ c.name }}@if (c.projects.length) { <span class="muted"> · {{ c.projects[0].name }}</span> }@if (!last) {, } } } @else { <span class="muted">Unassigned{{ item.ignored ? ' (not a client domain)' : '' }}</span> }</span>
            <span><span class="badge" [class]="'badge s-' + item.status.key">{{ item.status.label }}</span></span>
            <span class="muted">{{ item.dns.managedAt || (item.dns.nameservers?.length ? item.dns.nameservers![0] : '—') }}</span>
            <span class="muted">@if (item.expiresOn) { {{ item.expiresOn | date:'MMM d, y' }} } @else { — }</span>
            <span class="muted">{{ item.autoRenew === true ? 'On' : item.autoRenew === false ? 'Off' : '—' }}</span>
          </a>
        }
      </div>
    }
  `,
  styles: [`
    .sync { margin: 0 0 12px; font-size: .84rem; color: var(--text-secondary); }
    .sync-failed, .sync-incomplete, .sync-never_synced { color: var(--warning-text); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
    .search { max-width: 340px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; gap: 6px; align-items: center; padding: 5px 12px; border: 1px solid var(--border); border-radius: var(--radius-full); background: var(--card); font-size: .82rem; color: var(--text-secondary); cursor: pointer; }
    .chip.active { border-color: var(--primary); color: var(--primary-dark); }
    .count { padding: 0 5px; border-radius: var(--radius-full); background: var(--border-light); font-size: .72rem; font-weight: 700; }
    .table { padding: 4px 0; overflow: hidden; }
    .row { display: grid; grid-template-columns: minmax(180px, 1.4fr) minmax(150px, 1.3fr) 150px minmax(130px, 1fr) 110px 90px; gap: 12px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--border-light); font-size: .86rem; color: var(--text-primary); text-decoration: none; }
    a.row:hover { background: var(--border-light); }
    .row.head { border-top: none; font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
    .name { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; overflow-wrap: anywhere; }
    .flag { font-size: .72rem; font-weight: 600; color: var(--warning-text); }
    .muted { color: var(--text-muted); overflow-wrap: anywhere; }
    .badge { padding: 1px 8px; border-radius: var(--radius-full); background: var(--border-light); font-size: .72rem; font-weight: 600; }
    .s-active { background: var(--success-bg); color: var(--success-text); }
    .s-expired { background: var(--danger-bg); color: var(--danger-text); }
    .s-missing { background: var(--warning-bg); color: var(--warning-text); }
    .empty { padding: 14px 16px; border-radius: var(--radius); background: var(--border-light); color: var(--text-muted); font-size: .875rem; }
    @media (max-width: 900px) { .row { grid-template-columns: 1fr 1fr; } .row.head { display: none; } }
  `],
})
export class DomainInventoryComponent implements OnInit {
  private readonly domainService = inject(DomainService);
  private readonly org = inject(OrganizationContextService);
  readonly filters: { key: InventoryFilter; label: string }[] = [
    { key: 'all', label: 'All domains' },
    { key: 'unassigned', label: 'Not linked to a project' },
    { key: 'expiring', label: 'Expiring within 30 days' },
  ];
  readonly inventory = signal<InventoryResponse | null>(null);
  readonly error = signal('');
  readonly filter = signal<InventoryFilter>('all');
  readonly q = signal('');
  readonly isAdmin = () => this.org.hasPermission('integrations.manage');
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.domainService.inventory(this.filter(), this.q()).subscribe({
      next: (res) => { this.inventory.set(res.data); this.error.set(''); },
      error: (err) => this.error.set(err.error?.message || 'Domains could not be loaded.'),
    });
  }

  setFilter(filter: InventoryFilter): void {
    this.filter.set(filter);
    this.load();
  }

  search(value: string): void {
    this.q.set(value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }
}
