import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomainService } from '../../../core/services/domain.service';
import { ClientDomainsView } from '../../../core/models/domain.model';
import { SourceTagComponent } from '../source-tag.component';

/**
 * The project workspace's compact Domains & Hosting card (ADR 0009): the
 * project's domain(s) — or the client's, when the project has none of its
 * own — with expiry, auto-renew and hosting, linking to the full tab.
 */
@Component({
  selector: 'app-project-domains-card',
  standalone: true,
  imports: [DatePipe, RouterLink, SourceTagComponent],
  template: `
    <section class="card pdc">
      <div class="pdc-head">
        <h3>Domains &amp; hosting</h3>
        <a class="pdc-link" [routerLink]="['/app/clients', clientId(), 'domains']">{{ view()?.domains?.length ? 'Details' : 'Add' }} →</a>
      </div>
      @if (view(); as v) {
        @for (domain of domains(); track domain.id) {
          <div class="pdc-domain">
            <strong>{{ domain.displayName }}</strong>
            @if (domain.relevance === 'client') { <span class="text-muted text-xs"> · client-wide</span> }
            @if (domain.links.at(0); as link) { <span class="pdc-state" [class.warn]="link.state === 'conflict' || link.state === 'review'">{{ link.stateLabel }}</span> }
            <div class="pdc-facts">
              @if (domain.expiresOn.value) {
                Expires {{ domain.expiresOn.value | date:'MMM d, y' }}
                <span [class.pdc-soon]="domain.daysUntilExpiry !== null && domain.daysUntilExpiry <= 30">({{ daysLabel(domain.daysUntilExpiry) }})</span>
                <app-source-tag [source]="domain.expiresOn.source" />
              } @else { Expiration unknown }
              · auto-renew {{ domain.autoRenew.value === true ? 'on' : domain.autoRenew.value === false ? 'off' : 'unknown' }}
              @if (domain.registrar.value) { · {{ domain.registrar.value }} }
            </div>
          </div>
        } @empty {
          <p class="text-sm text-muted">No domain recorded for this project yet.</p>
        }
        @for (plan of v.hosting; track plan.id) {
          <p class="pdc-hosting">Hosting: <strong>{{ plan.providerName || plan.name }}</strong>@if (plan.planName) { · {{ plan.planName }} }@if (plan.shared) { <span class="text-muted"> · shared plan</span> }@if (plan.expiresOn) { · renews {{ plan.expiresOn | date:'MMM d, y' }} }</p>
        }
      } @else if (failed()) {
        <p class="text-sm text-muted">Domains couldn’t be loaded.</p>
      } @else {
        <p class="text-sm text-muted">Loading…</p>
      }
    </section>
  `,
  styles: [`
    .pdc { padding: 16px 18px; }
    .pdc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .pdc-head h3 { margin: 0; font-size: .95rem; }
    .pdc-link { font-size: .82rem; font-weight: 600; color: var(--primary-dark); }
    .pdc-domain { padding: 6px 0; border-top: 1px solid var(--border-light); font-size: .86rem; }
    .pdc-state { margin-left: 8px; padding: 1px 8px; border-radius: var(--radius-full); background: var(--border-light); font-size: .72rem; font-weight: 600; color: var(--text-secondary); }
    .pdc-state.warn { background: var(--warning-bg); color: var(--warning-text); }
    .pdc-facts { margin-top: 2px; color: var(--text-secondary); font-size: .82rem; }
    .pdc-soon { color: var(--warning-text); font-weight: 600; }
    .pdc-hosting { margin: 8px 0 0; font-size: .84rem; color: var(--text-secondary); }
  `],
})
export class ProjectDomainsCardComponent {
  private readonly domainService = inject(DomainService);
  readonly projectId = input.required<string>();
  readonly clientId = input.required<string>();
  readonly view = signal<ClientDomainsView | null>(null);
  readonly failed = signal(false);
  readonly domains = computed(() => {
    const all = this.view()?.domains ?? [];
    const own = all.filter((domain) => domain.relevance === 'project');
    return own.length ? own : all;
  });

  daysLabel(days: number | null): string {
    if (days === null) return '';
    if (days < 0) return 'expired';
    return days === 0 ? 'today' : `in ${days} days`;
  }

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      this.domainService.projectDomains(projectId).subscribe({
        next: (res) => this.view.set(res.data),
        error: () => this.failed.set(true),
      });
    });
  }
}
