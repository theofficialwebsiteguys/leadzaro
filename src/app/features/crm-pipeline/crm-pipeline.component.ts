import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { CrmService } from '../../core/services/crm.service';
import { MembershipService } from '../../core/services/membership.service';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { DuplicateGroup, Opportunity, PIPELINE_STAGES } from '../../core/models/crm.model';
import { Member } from '../../core/models/organization.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-crm-pipeline',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, IconComponent],
  templateUrl: './crm-pipeline.component.html',
  styleUrl: './crm-pipeline.component.scss',
})
export class CrmPipelineComponent implements OnInit {
  private readonly crm = inject(CrmService);
  private readonly membershipService = inject(MembershipService);
  readonly auth = inject(AuthService);
  readonly org = inject(OrganizationContextService);

  readonly stages = PIPELINE_STAGES;

  opportunities = signal<Opportunity[]>([]);
  loading = signal(true);
  total = signal(0);
  page = signal(1);
  totalPages = signal(1);

  stageFilter = signal('');
  showArchived = signal(false);
  myOnly = signal(false);

  members = signal<Member[]>([]);
  assigningId = signal<string | null>(null);

  showCreateForm = signal(false);
  newName = '';
  newPhone = '';
  newWebsite = '';
  createSubmitting = signal(false);
  createError = signal('');

  actionMessage = signal('');

  showDuplicates = signal(false);
  duplicates = signal<DuplicateGroup[]>([]);
  duplicatesLoading = signal(false);

  ngOnInit() {
    this.loadOpportunities();
    this.membershipService.list().subscribe((res) => {
      this.members.set(res.data.memberships.filter((m) => m.membershipType === 'employee' && m.status === 'active'));
    });
  }

  loadOpportunities(p = 1) {
    this.loading.set(true);
    this.page.set(p);

    this.crm.list({
      stage: this.stageFilter() || undefined,
      assignedToUserId: this.myOnly() ? (this.auth.currentUser()?.id) : undefined,
      archived: this.showArchived(),
      page: p,
      limit: 20,
    }).subscribe({
      next: (res) => {
        this.opportunities.set(res.data.items);
        this.total.set(res.data.pagination.total);
        this.totalPages.set(res.data.pagination.totalPages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  applyStageFilter(stage: string) {
    this.stageFilter.set(stage);
    this.loadOpportunities(1);
  }

  toggleArchived() {
    this.showArchived.set(!this.showArchived());
    this.loadOpportunities(1);
  }

  toggleMyOnly() {
    this.myOnly.set(!this.myOnly());
    this.loadOpportunities(1);
  }

  toggleCreateForm() {
    this.showCreateForm.set(!this.showCreateForm());
    this.createError.set('');
  }

  createOpportunity() {
    if (!this.newName.trim()) {
      this.createError.set('Business name is required.');
      return;
    }
    this.createSubmitting.set(true);
    this.createError.set('');
    this.crm.create({
      name: this.newName.trim(),
      phone: this.newPhone.trim() || undefined,
      website: this.newWebsite.trim() || undefined,
    }).subscribe({
      next: () => {
        this.newName = '';
        this.newPhone = '';
        this.newWebsite = '';
        this.createSubmitting.set(false);
        this.showCreateForm.set(false);
        this.loadOpportunities(1);
      },
      error: (err) => {
        this.createError.set(err.error?.message || 'Failed to create opportunity.');
        this.createSubmitting.set(false);
      },
    });
  }

  updateStage(opp: Opportunity, stage: string) {
    this.crm.updateStage(opp.id, { stage }).subscribe({
      next: (res) => this.replaceOpportunity(res.data.opportunity),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to update stage.'),
    });
  }

  claim(opp: Opportunity) {
    this.crm.claim(opp.id).subscribe({
      next: (res) => this.replaceOpportunity(res.data.opportunity),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to claim.'),
    });
  }

  toggleAssign(opp: Opportunity) {
    this.assigningId.set(this.assigningId() === opp.id ? null : opp.id);
  }

  assignTo(opp: Opportunity, userId: string) {
    if (!userId) return;
    this.crm.assign(opp.id, userId).subscribe({
      next: (res) => {
        this.replaceOpportunity(res.data.opportunity);
        this.assigningId.set(null);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to assign.'),
    });
  }

  roundRobinAssign(opp: Opportunity) {
    this.crm.roundRobinAssign(opp.id).subscribe({
      next: (res) => this.replaceOpportunity(res.data.opportunity),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to auto-assign.'),
    });
  }

  archive(opp: Opportunity) {
    if (!confirm(`Archive "${opp.organization?.name}"? You can restore it later from the Archived view.`)) return;
    this.crm.archive(opp.id).subscribe(() => {
      this.opportunities.set(this.opportunities().filter((o) => o.id !== opp.id));
      this.total.set(this.total() - 1);
    });
  }

  restore(opp: Opportunity) {
    this.crm.restore(opp.id).subscribe({
      next: () => {
        this.opportunities.set(this.opportunities().filter((o) => o.id !== opp.id));
        this.total.set(this.total() - 1);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Could not restore this opportunity.'),
    });
  }

  undoMerge(opp: Opportunity) {
    this.crm.undoMerge(opp.id).subscribe({
      next: () => {
        this.opportunities.set(this.opportunities().filter((o) => o.id !== opp.id));
        this.total.set(this.total() - 1);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Could not undo this merge.'),
    });
  }

  private replaceOpportunity(updated: Opportunity) {
    this.opportunities.set(this.opportunities().map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
  }

  memberName(userId: string | null | undefined): string {
    if (!userId) return '—';
    const m = this.members().find((mm) => mm.userId === userId);
    return m?.user?.name || 'Unknown';
  }

  toggleDuplicates() {
    this.showDuplicates.set(!this.showDuplicates());
    if (this.showDuplicates() && this.duplicates().length === 0) this.loadDuplicates();
  }

  loadDuplicates() {
    this.duplicatesLoading.set(true);
    this.crm.listDuplicates().subscribe({
      next: (res) => {
        this.duplicates.set(res.data.duplicateGroups);
        this.duplicatesLoading.set(false);
      },
      error: () => this.duplicatesLoading.set(false),
    });
  }

  // The oldest opportunity in each group (index 0 — findPossibleDuplicates
  // orders by createdAt ASC) is treated as the record to keep, so this is a
  // simple one-click merge rather than a separate winner/loser picker.
  mergeIntoKept(group: DuplicateGroup, loserId: string) {
    const winnerId = group.opportunities[0].id;
    if (winnerId === loserId) return;

    this.crm.previewMerge(winnerId, loserId).subscribe({
      next: (preview) => {
        const contactCount = preview.data.loserContacts.length;
        const locationCount = preview.data.loserLocations.length;
        const detail = contactCount || locationCount
          ? ` This moves ${contactCount} contact(s) and ${locationCount} location(s) onto the kept record.`
          : '';
        if (!confirm(`Merge this duplicate into "${group.name}"?${detail} The duplicate is archived, not deleted, and this can be undone.`)) return;

        this.crm.merge(winnerId, loserId).subscribe({
          next: () => {
            this.actionMessage.set('Opportunities merged.');
            this.loadDuplicates();
            this.loadOpportunities(this.page());
          },
          error: (err) => this.actionMessage.set(err.error?.message || 'Failed to merge.'),
        });
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to preview merge.'),
    });
  }
}
