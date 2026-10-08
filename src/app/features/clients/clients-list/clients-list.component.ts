import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { AuthService } from '../../../core/services/auth.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import {
  ClientFilterKey, ClientListResult, ClientSort, ClientSummary, PROJECT_TYPE_LABELS, ProjectType,
} from '../../../core/models/client.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { HostPipe, initialsOf } from '../../../shared/pipes/host.pipe';
import { AddClientDialogComponent } from '../add-client-dialog/add-client-dialog.component';
import { StripeMatchDialogComponent } from '../stripe-match-dialog/stripe-match-dialog.component';

const FILTER_ORDER: ClientFilterKey[] = ['attention', 'mine', 'waiting_us', 'waiting_client', 'onboarding', 'billing', 'next_overdue', 'tasks_overdue', 'missing_info', 'unassigned'];
const SORTS: { key: ClientSort; label: string }[] = [
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'attention', label: 'Needs attention first' },
  { key: 'next_action', label: 'Next action date' },
  { key: 'since', label: 'Newest clients first' },
  { key: 'recent', label: 'Latest note' },
];
const FLAG_BADGES: Record<string, { label: string; tone: string }> = {
  billing: { label: 'Billing', tone: 'danger' },
  onboarding: { label: 'Onboarding', tone: 'info' },
  waiting_us: { label: 'Waiting on us', tone: 'warning' },
  waiting_client: { label: 'Waiting on client', tone: 'muted' },
  next_overdue: { label: 'Action overdue', tone: 'warning' },
  tasks_overdue: { label: 'Tasks overdue', tone: 'warning' },
};
const PAGE_SIZE = 25;

/**
 * The Clients directory (ADR 0013): every client's manager, status and
 * next action at a glance, with the views a client manager works from —
 * needs attention, waiting on us, onboarding, billing issues, missing
 * information. Filters live in the URL so Back returns to the same view.
 */
@Component({
  selector: 'app-clients-list',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, IconComponent, EmptyStateComponent, HostPipe, AddClientDialogComponent, StripeMatchDialogComponent],
  templateUrl: './clients-list.component.html',
  styleUrl: './clients-list.component.scss',
})
export class ClientsListComponent {
  private readonly clientService = inject(ClientService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly org = inject(OrganizationContextService);

  readonly initialsOf = initialsOf;
  readonly sorts = SORTS;
  readonly flagBadges = FLAG_BADGES;
  readonly userId = computed(() => this.auth.currentUser()?.id ?? null);

  readonly result = signal<ClientListResult | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');

  // Filters (mirrored in the URL).
  view = signal<ClientFilterKey | ''>('');
  status = signal<'active' | 'ended' | 'all'>('active');
  sort = signal<ClientSort>('name');
  manager = signal('');
  page = signal(1);
  layout = signal<'table' | 'cards'>('table');
  searchText = '';
  private readonly search$ = new Subject<string>();

  readonly selected = signal<Set<string>>(new Set());
  bulkManager = '';
  readonly bulkSaving = signal(false);
  readonly notice = signal('');

  readonly addOpen = signal(false);
  readonly matchOpen = signal(false);

  readonly clients = computed(() => this.result()?.clients ?? []);
  readonly team = computed(() => this.result()?.team ?? []);
  readonly totalPages = computed(() => {
    const r = this.result();
    return r && r.pageSize ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;
  });
  /** Filter chips worth showing: any with clients, plus whichever is active. */
  readonly chips = computed(() => {
    const r = this.result();
    if (!r) return [];
    return FILTER_ORDER
      .filter((key) => (r.counts[key] || 0) > 0 || this.view() === key)
      .map((key) => ({ key, label: r.filters[key], count: r.counts[key] || 0 }));
  });
  readonly filtersActive = computed(() => Boolean(this.view() || this.manager() || this.searchText.trim() || this.status() !== 'active'));
  readonly allSelected = computed(() => this.clients().length > 0 && this.clients().every((c) => this.selected().has(c.id)));

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    this.view.set((q.get('view') as ClientFilterKey) || '');
    this.status.set((q.get('status') as 'active' | 'ended' | 'all') || 'active');
    this.sort.set((q.get('sort') as ClientSort) || 'name');
    this.manager.set(q.get('manager') || '');
    this.page.set(Math.max(1, Number(q.get('page')) || 1));
    this.layout.set(q.get('layout') === 'cards' ? 'cards' : 'table');
    this.searchText = q.get('q') || '';
    this.remember(Object.fromEntries(q.keys.map((key) => [key, q.get(key)])));
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.page.set(1);
      this.apply();
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.clientService.search({
      page: this.page(), pageSize: PAGE_SIZE, view: this.view(), q: this.searchText.trim(), sort: this.sort(), status: this.status(), manager: this.manager(),
    }).subscribe({
      next: (res) => {
        this.result.set(res.data);
        if (res.data.page !== this.page()) this.page.set(res.data.page);
        this.selected.set(new Set());
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err.error?.message || 'Clients couldn’t be loaded.');
        this.loading.set(false);
      },
    });
  }

  /** Writes the filters to the URL (so Back keeps them) and reloads. */
  apply(): void {
    const queryParams = {
      view: this.view() || null,
      status: this.status() === 'active' ? null : this.status(),
      sort: this.sort() === 'name' ? null : this.sort(),
      manager: this.manager() || null,
      page: this.page() > 1 ? this.page() : null,
      layout: this.layout() === 'cards' ? 'cards' : null,
      q: this.searchText.trim() || null,
    };
    this.router.navigate([], { relativeTo: this.route, replaceUrl: true, queryParams });
    this.remember(queryParams);
    this.load();
  }

  /** Remembers the view for the client page's Back link. */
  private remember(queryParams: Record<string, string | number | null>): void {
    try {
      sessionStorage.setItem('lz.clients.query', JSON.stringify(Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== null))));
    } catch {
      // Private windows may block storage; Back then opens the default view.
    }
  }

  setView(key: ClientFilterKey | ''): void {
    this.view.set(this.view() === key ? '' : key);
    if (this.view() === 'attention' && this.sort() === 'name') this.sort.set('attention');
    this.page.set(1);
    this.apply();
  }

  onSearch(): void {
    this.search$.next(this.searchText);
  }

  change(): void {
    this.page.set(1);
    this.apply();
  }

  goTo(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.totalPages()));
    this.apply();
  }

  setLayout(layout: 'table' | 'cards'): void {
    this.layout.set(layout);
    this.apply();
  }

  clearFilters(): void {
    this.view.set('');
    this.manager.set('');
    this.status.set('active');
    this.searchText = '';
    this.page.set(1);
    this.apply();
  }

  toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.clients().map((c) => c.id)));
  }

  assignSelected(): void {
    const ids = [...this.selected()];
    if (!ids.length || this.bulkSaving()) return;
    const managerId = this.bulkManager === 'none' ? null : this.bulkManager;
    if (!this.bulkManager) return;
    this.bulkSaving.set(true);
    this.clientService.assignManager(ids, managerId).subscribe({
      next: (res) => {
        this.bulkSaving.set(false);
        this.bulkManager = '';
        this.notice.set(res.data.changed ? `Client manager updated for ${res.data.changed} client${res.data.changed === 1 ? '' : 's'}.` : 'Nothing needed changing.');
        this.load();
      },
      error: (err) => {
        this.bulkSaving.set(false);
        this.notice.set(err.error?.message || 'The client manager couldn’t be changed.');
      },
    });
  }

  onCreated(event: { id: string; createdFrom: 'new' | 'lead'; openDeals: number }): void {
    this.addOpen.set(false);
    this.router.navigate(['/app/clients', event.id], event.openDeals ? { queryParams: { openDeals: event.openDeals } } : {});
  }

  /** "Website · Main website"; a legacy unnamed project just reads "Website" or "Project" rather than repeating the client's name. */
  projectChip(client: ClientSummary, project: ClientSummary['projects'][number]): string {
    const type = project.projectType ? PROJECT_TYPE_LABELS[project.projectType as ProjectType] : null;
    const name = project.displayName !== client.name ? project.displayName : null;
    return [type, name].filter(Boolean).join(' · ') || 'Project';
  }

  badges(client: ClientSummary): { label: string; tone: string }[] {
    return (client.health?.flags || []).filter((f) => FLAG_BADGES[f]).map((f) => FLAG_BADGES[f]);
  }

  topReason(client: ClientSummary): string {
    return client.health?.reasons[0]?.text || '';
  }

  isOverdue(client: ClientSummary): boolean {
    return Boolean(client.health?.flags.includes('next_overdue'));
  }

  billingTone(client: ClientSummary): string {
    const state = client.health?.billing.state;
    if (state === 'problem') return 'danger';
    if (state === 'cancelling') return 'warning';
    if (state === 'subscribed' || state === 'paid') return 'success';
    return 'muted';
  }

  rangeLabel(): string {
    const r = this.result();
    if (!r || !r.total) return '';
    const start = (r.page - 1) * r.pageSize + 1;
    return `${start}–${Math.min(r.total, start + r.pageSize - 1)} of ${r.total}`;
  }
}
