import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LowerCasePipe, SlicePipe } from '@angular/common';
import { SavedLead, LEAD_STATUSES } from '../../core/models/lead.model';
import { SavedLeadService } from '../../core/services/saved-lead.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-saved-leads',
  standalone: true,
  imports: [RouterLink, FormsModule, SlicePipe, LowerCasePipe, IconComponent],
  templateUrl: './saved-leads.component.html',
  styleUrl: './saved-leads.component.scss',
})
export class SavedLeadsComponent implements OnInit {
  private readonly savedLeadService = inject(SavedLeadService);
  private readonly route = inject(ActivatedRoute);

  readonly statuses = ['All', ...LEAD_STATUSES];

  leads = signal<SavedLead[]>([]);
  loading = signal(true);
  total = signal(0);
  page = signal(1);
  totalPages = signal(1);

  statusFilter = signal('All');
  searchQuery = signal('');
  showArchived = signal(false);

  ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      if (params['status']) this.statusFilter.set(params['status']);
      this.loadLeads();
    });
  }

  toggleArchived() {
    this.showArchived.set(!this.showArchived());
    this.loadLeads(1);
  }

  loadLeads(p = 1) {
    this.loading.set(true);
    this.page.set(p);

    this.savedLeadService.getAll({
      status: this.statusFilter() === 'All' ? undefined : this.statusFilter(),
      search: this.searchQuery() || undefined,
      archived: this.showArchived(),
      page: p,
      limit: 20,
    }).subscribe({
      next: (res) => {
        this.leads.set(res.data.items);
        this.total.set(res.data.pagination.total);
        this.totalPages.set(res.data.pagination.totalPages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  applyFilter(status: string) {
    this.statusFilter.set(status);
    this.loadLeads(1);
  }

  applySearch() { this.loadLeads(1); }

  updateStatus(lead: SavedLead, status: string) {
    this.savedLeadService.update(lead.id, { status: status as any }).subscribe({
      next: (res) => {
        const updated = this.leads().map((l) => l.id === lead.id ? { ...l, status: status as any } : l);
        this.leads.set(updated);
      },
    });
  }

  archiveLead(id: string) {
    if (!confirm('Archive this lead? You can restore it later from the Archived view.')) return;
    this.savedLeadService.archive(id).subscribe(() => {
      this.leads.set(this.leads().filter((l) => l.id !== id));
      this.total.set(this.total() - 1);
    });
  }

  restoreLead(id: string) {
    this.savedLeadService.restore(id).subscribe({
      next: () => {
        this.leads.set(this.leads().filter((l) => l.id !== id));
        this.total.set(this.total() - 1);
      },
      error: (err) => alert(err.error?.message || 'Could not restore this lead.'),
    });
  }

  statusClass(status: string): string {
    return 'badge badge-' + status.toLowerCase().replaceAll(' ', '-');
  }
}
