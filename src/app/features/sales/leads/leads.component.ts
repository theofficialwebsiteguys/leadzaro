import { PhoneInputDirective } from '../../../shared/forms/formatted-inputs';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesService } from '../../../core/services/sales.service';
import { CrmService } from '../../../core/services/crm.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  LeadRow, PossibleDuplicate, SALES_STAGES, STAGE_LABELS, SalesStage, UserRef,
} from '../../../core/models/sales.model';
import { DuplicateGroup } from '../../../core/models/crm.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import {
  MoneyPipe, RelativeDayPipe, isOverdue, nextActionLabel,
} from '../shared/sales-format';

interface Filters {
  q: string; stage: string; owner: string; due: string; view: string; sort: string; layout: 'list' | 'board'; page: number;
}

const DEFAULTS: Filters = {
  q: '', stage: 'open', owner: 'me', due: '', view: 'active', sort: 'next', layout: 'list', page: 1,
};

/**
 * Leads (ADR 0011): every deal as a list or a pipeline board. Common
 * actions stay on the row (open, call/email presence); assignment and
 * archiving live in a small menu.
 */
@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, DialogComponent, MoneyPipe, RelativeDayPipe, PhoneInputDirective],
  templateUrl: './leads.component.html',
  styleUrl: './leads.component.scss',
})
export class LeadsComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly crm = inject(CrmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly org = inject(OrganizationContextService);
  readonly auth = inject(AuthService);

  readonly stages = SALES_STAGES;
  readonly stageLabels = STAGE_LABELS;
  readonly boardStages: SalesStage[] = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'won'];
  readonly nextActionLabel = nextActionLabel;
  readonly isOverdue = isOverdue;

  filters: Filters = { ...DEFAULTS };
  readonly rows = signal<LeadRow[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly counts = signal<{ stage: string; label: string; count: number }[]>([]);
  readonly members = signal<UserRef[]>([]);
  readonly menuFor = signal<string | null>(null);
  readonly message = signal('');

  readonly canAssign = computed(() => this.org.hasPermission('leads.assign'));
  readonly canMerge = computed(() => this.org.hasPermission('crm.manage_pipeline'));

  // Add lead
  readonly showAdd = signal(false);
  readonly adding = signal(false);
  readonly addError = signal('');
  readonly duplicates = signal<PossibleDuplicate[]>([]);
  readonly existingId = signal<string | null>(null);
  draft = this.emptyDraft();

  // Duplicate review (managers)
  readonly showDupes = signal(false);
  readonly dupeGroups = signal<DuplicateGroup[]>([]);
  readonly dupesLoading = signal(false);

  readonly boardColumns = computed(() => this.boardStages.map((stage) => ({
    stage, label: STAGE_LABELS[stage], items: this.rows().filter((r) => r.stage === stage),
  })));

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    this.filters = {
      q: q.get('q') ?? DEFAULTS.q,
      stage: q.get('stage') ?? (q.get('view') === 'board' ? '' : DEFAULTS.stage),
      owner: q.get('owner') ?? DEFAULTS.owner,
      due: q.get('due') ?? DEFAULTS.due,
      view: q.get('show') ?? DEFAULTS.view,
      sort: q.get('sort') ?? DEFAULTS.sort,
      layout: (q.get('view') === 'board' || q.get('layout') === 'board') ? 'board' : 'list',
      page: Number(q.get('page')) || 1,
    };
    this.sales.team().subscribe({ next: (res) => this.members.set(res.members), error: () => this.members.set([]) });
    this.load();
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.menuFor.set(null);
  }

  load(): void {
    this.loading.set(true);
    const f = this.filters;
    const board = f.layout === 'board';
    this.router.navigate([], {
      queryParams: {
        q: f.q || null, stage: f.stage || null, owner: f.owner, due: f.due || null, show: f.view === 'active' ? null : f.view, sort: f.sort === 'next' ? null : f.sort, layout: board ? 'board' : null, page: f.page > 1 ? f.page : null,
      },
      replaceUrl: true,
    });
    this.sales.leads({
      q: f.q, stage: board ? '' : f.stage, owner: f.owner, due: f.due, view: f.view, sort: f.sort, layout: f.layout, page: f.page,
    }).subscribe({
      next: (res) => {
        this.rows.set(res.items);
        this.total.set(res.total);
        this.totalPages.set(res.totalPages);
        this.loading.set(false);
        this.error.set('');
      },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'Leads could not be loaded.'); },
    });
    this.sales.stageCounts(f.owner === 'me' ? 'me' : undefined).subscribe({ next: (c) => this.counts.set(c), error: () => undefined });
  }

  apply(patch: Partial<Filters>): void {
    this.filters = { ...this.filters, ...patch, page: patch.page ?? 1 };
    this.load();
  }

  stageLabel(stage: string): string {
    return STAGE_LABELS[stage as SalesStage] ?? stage;
  }

  countFor(stage: string): number {
    return this.counts().find((c) => c.stage === stage)?.count ?? 0;
  }

  open(row: LeadRow): void {
    this.router.navigate(['/app/leads', row.opportunityId]);
  }

  toggleMenu(event: Event, id: string): void {
    event.stopPropagation();
    this.menuFor.set(this.menuFor() === id ? null : id);
  }

  assign(row: LeadRow, userId: string, event?: Event): void {
    event?.stopPropagation();
    this.menuFor.set(null);
    this.sales.assign(row.opportunityId, userId).subscribe({
      next: (ws) => {
        this.rows.set(this.rows().map((r) => (r.opportunityId === row.opportunityId ? { ...r, assignedTo: ws.opportunity.assignedTo } : r)));
        this.message.set(`${row.businessName} assigned to ${ws.opportunity.assignedTo?.name ?? 'you'}.`);
      },
      error: (err) => this.message.set(err.error?.message || 'Could not assign this lead.'),
    });
  }

  archive(row: LeadRow, event: Event): void {
    event.stopPropagation();
    this.menuFor.set(null);
    const request = row.archivedAt ? this.sales.restore(row.opportunityId) : this.sales.archive(row.opportunityId);
    request.subscribe({
      next: () => {
        this.rows.set(this.rows().filter((r) => r.opportunityId !== row.opportunityId));
        this.total.set(this.total() - 1);
        this.message.set(row.archivedAt ? `${row.businessName} restored.` : `${row.businessName} archived. Find it under “Archived”.`);
      },
      error: (err) => this.message.set(err.error?.message || 'That didn’t work.'),
    });
  }

  // ---- add lead
  emptyDraft() {
    return {
      name: '', phone: '', email: '', website: '', city: '', state: '', category: '', contactName: '', contactTitle: '', contactEmail: '', contactPhone: '',
    };
  }

  openAdd(): void {
    this.draft = this.emptyDraft();
    this.duplicates.set([]);
    this.existingId.set(null);
    this.addError.set('');
    this.showAdd.set(true);
  }

  submitAdd(options: { confirmNew?: boolean; existingOrganizationId?: string } = {}): void {
    if (!this.draft.name.trim()) {
      this.addError.set('Business name is required.');
      return;
    }
    this.adding.set(true);
    this.addError.set('');
    const d = this.draft;
    this.sales.createLead({
      leadData: {
        name: d.name, phone: d.phone, website: d.website, city: d.city, state: d.state, category: d.category, source: 'manual',
      },
      email: d.email || undefined,
      contact: d.contactName ? {
        name: d.contactName, title: d.contactTitle, email: d.contactEmail, phone: d.contactPhone,
      } : undefined,
      ...options,
    }).subscribe({
      next: (res) => {
        this.adding.set(false);
        this.showAdd.set(false);
        this.router.navigate(['/app/leads', res.opportunityId]);
      },
      error: (err) => {
        this.adding.set(false);
        if (err.status === 409 && err.error?.possibleDuplicates) this.duplicates.set(err.error.possibleDuplicates);
        else if (err.status === 409 && err.error?.existingOpportunityId) this.existingId.set(err.error.existingOpportunityId);
        this.addError.set(err.error?.message || 'The lead could not be added. Your entries are still here.');
      },
    });
  }

  // ---- duplicates (managers)
  openDupes(): void {
    this.showDupes.set(true);
    this.dupesLoading.set(true);
    this.crm.listDuplicates().subscribe({
      next: (res) => { this.dupeGroups.set(res.data.duplicateGroups); this.dupesLoading.set(false); },
      error: () => this.dupesLoading.set(false),
    });
  }

  merge(group: DuplicateGroup, loserId: string): void {
    const winnerId = group.opportunities[0].id;
    this.crm.merge(winnerId, loserId, 'Merged from Leads duplicate review').subscribe({
      next: () => { this.message.set('Merged. The duplicate was archived and can be restored from its record.'); this.openDupes(); this.load(); },
      error: (err) => this.message.set(err.error?.message || 'Could not merge.'),
    });
  }
}
