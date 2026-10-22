import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ChainFilterSettings, WorkflowService } from '../../../core/services/workflow.service';

/**
 * Search filters (ADR 0017): the brands and corporate websites that keep
 * obvious chains out of the research queue, and the locations someone
 * allowed anyway. Managers edit the list; anyone who qualifies can remove
 * a location exception. Changes never touch leads already in Leadzaro.
 */
@Component({
  selector: 'app-search-filters-settings',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="card section">
      <h2>Search filters</h2>
      <p class="sub">Obvious chains are left out of qualifying searches, with the reason shown. Anyone qualifying can bring one back, or always allow a location.</p>
      @if (s(); as st) {
        <p class="limits"><strong>Limits:</strong> {{ st.limits }}</p>

        @if (st.canEditBrands) {
          <form class="add" (ngSubmit)="add()">
            <input class="form-control" name="brand" [(ngModel)]="name" maxlength="80" placeholder="Brand, e.g. Burn Boot Camp" aria-label="Brand name" />
            <input class="form-control" name="domains" [(ngModel)]="domains" placeholder="Website, e.g. burnbootcamp.com (optional)" aria-label="Corporate website" />
            <button type="submit" class="btn btn-primary" [disabled]="busy() || !name.trim()">Add brand</button>
          </form>
        }
        @if (error()) { <div class="alert alert-error" role="alert">{{ error() }}</div> }

        <div class="list-head">
          <h3>Excluded brands <span class="muted">({{ enabledCount() }} on)</span></h3>
          <input class="form-control find" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Find a brand" aria-label="Find a brand" />
        </div>
        <ul class="brands">
          @for (b of shown(); track b.key) {
            <li [class.off]="!b.enabled">
              <span class="b-main"><strong>{{ b.name }}</strong>@if (b.domains.length) { <span class="muted">{{ b.domains.join(', ') }}</span> }@if (b.source === 'custom') { <span class="tag">added</span> }</span>
              @if (st.canEditBrands) {
                @if (b.source === 'custom') { <button class="btn btn-ghost btn-sm" (click)="change('remove', b.key)" [disabled]="busy()">Remove</button> }
                @else if (b.enabled) { <button class="btn btn-ghost btn-sm" (click)="change('disable', b.key)" [disabled]="busy()" title="Results with this name show up again">Allow this brand</button> }
                @else { <button class="btn btn-ghost btn-sm" (click)="change('enable', b.key)" [disabled]="busy()">Exclude again</button> }
              } @else if (!b.enabled) { <span class="muted">allowed</span> }
            </li>
          } @empty { <li class="muted">No brand matches “{{ query() }}”.</li> }
        </ul>
        @if (filtered().length > shown().length) { <button class="btn btn-ghost btn-sm" (click)="all.set(true)">Show all {{ filtered().length }}</button> }

        <h3>Locations always allowed</h3>
        <ul class="brands">
          @for (p of st.allowedPlaces; track p.googlePlaceId) {
            <li><span class="b-main"><strong>{{ p.name || p.googlePlaceId }}</strong><span class="muted">allowed{{ p.byName ? ' by ' + p.byName : '' }} · {{ p.at | date: 'MMM d, y' }}</span></span>
              @if (st.canAllowPlaces) { <button class="btn btn-ghost btn-sm" (click)="removePlace(p.googlePlaceId)" [disabled]="busy()">Remove</button> }</li>
          } @empty { <li class="muted">None yet — use “Always allow” on an excluded result while qualifying.</li> }
        </ul>
      } @else {
        <div class="loading-state"><div class="spinner"></div></div>
      }
    </section>
  `,
  styles: [`
    .section { padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; h2 { margin: 0; font-size: 1.1rem; } h3 { margin: 10px 0 0; font-size: .9rem; } .sub { margin: 0; color: var(--text-muted); font-size: .86rem; } }
    .limits { margin: 0; font-size: .8rem; color: var(--text-secondary); background: var(--bg); border-radius: 8px; padding: 8px 10px; }
    .add { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; @media (max-width: 640px) { grid-template-columns: 1fr; } }
    .list-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; flex-wrap: wrap; .find { max-width: 220px; } }
    .brands { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; font-size: .85rem;
      li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid var(--border); }
      li.off strong { text-decoration: line-through; color: var(--text-muted); }
      .b-main { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; } }
    .muted { color: var(--text-muted); font-size: .78rem; }
    .tag { font-size: .68rem; background: var(--primary-50); color: var(--primary-dark); border-radius: var(--radius-full); padding: 1px 7px; }
  `],
})
export class SearchFiltersSettingsComponent implements OnInit {
  private readonly workflow = inject(WorkflowService);
  readonly s = signal<ChainFilterSettings | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly all = signal(false);
  name = '';
  domains = '';
  readonly query = signal('');

  readonly enabledCount = computed(() => (this.s()?.brands ?? []).filter((b) => b.enabled).length);
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.s()?.brands ?? [];
    return q ? list.filter((b) => b.name.toLowerCase().includes(q) || b.domains.some((d) => d.includes(q))) : list;
  });
  readonly shown = computed(() => (this.all() || this.query().trim() ? this.filtered() : this.filtered().slice(0, 40)));

  ngOnInit(): void {
    this.workflow.chainFilter().subscribe({ next: (r) => this.s.set(r), error: (err) => this.error.set(err.error?.message || 'Couldn’t load the search filters.') });
  }

  private run(request: ReturnType<WorkflowService['chainFilter']>, after?: () => void): void {
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: (r) => { this.busy.set(false); this.s.set(r); after?.(); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — try again.'); },
    });
  }

  add(): void {
    this.run(this.workflow.updateChainBrands({ action: 'add', name: this.name.trim(), domains: this.domains.trim() }), () => { this.name = ''; this.domains = ''; });
  }

  change(action: 'remove' | 'disable' | 'enable', key: string): void {
    this.run(this.workflow.updateChainBrands({ action, key }));
  }

  removePlace(placeId: string): void {
    this.run(this.workflow.removeAllowedPlace(placeId));
  }
}
