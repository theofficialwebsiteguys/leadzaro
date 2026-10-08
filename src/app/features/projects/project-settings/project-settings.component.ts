import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { map } from 'rxjs';
import { ProjectService } from '../../../core/services/project.service';
import { CancellationService } from '../../../core/services/cancellation.service';
import { BillingService } from '../../../core/services/billing.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { Project, ProjectFinancials } from '../../../core/models/project.model';
import { CancellationRequest } from '../../../core/models/cancellationRequest.model';
import { ProjectBilling } from '../../../core/models/billing.model';
import { HasPermissionDirective } from '../../../core/directives/has-permission.directive';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { LabelPipe } from '../../../shared/pipes/label.pipe';

@Component({
  selector: 'app-project-settings',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, EmptyStateComponent, LabelPipe],
  templateUrl: './project-settings.component.html',
  styleUrl: './project-settings.component.scss',
})
export class ProjectSettingsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);
  private readonly cancellationService = inject(CancellationService);
  private readonly billingService = inject(BillingService);
  readonly org = inject(OrganizationContextService);

  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  selected = signal<Project | null>(null);

  billing = signal<ProjectBilling | null>(null);
  billingLoaded = signal(false);
  openingPortal = signal(false);

  financials = signal<ProjectFinancials | null>(null);
  financialsLoaded = signal(false);
  estimatedCostDollars = '';
  actualCostDollars = '';
  marginNotes = '';

  cancellationRequests = signal<CancellationRequest[]>([]);
  pendingCancellationRequest = computed(() => this.cancellationRequests().find((c) => c.status === 'requested') ?? null);
  newCancellationReason = '';

  actionMessage = signal('');

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  private load(id: string) {
    this.actionMessage.set('');
    this.financialsLoaded.set(false);
    this.financials.set(null);
    this.billingLoaded.set(false);
    this.billing.set(null);

    this.projectService.getById(id).subscribe((res) => this.selected.set(res.data.project));
    this.loadCancellationRequests(id);

    this.billingService.getProjectBilling(id).subscribe((res) => {
      this.billing.set(res.data.billing);
      this.billingLoaded.set(true);
    });

    if (this.org.hasPermission('projects.manage')) {
      this.projectService.getFinancials(id).subscribe((res) => {
        this.financials.set(res.data.financials);
        this.financialsLoaded.set(true);
        if (res.data.financials) {
          this.estimatedCostDollars = res.data.financials.estimatedCostCents != null ? (res.data.financials.estimatedCostCents / 100).toFixed(2) : '';
          this.actualCostDollars = res.data.financials.actualCostCents != null ? (res.data.financials.actualCostCents / 100).toFixed(2) : '';
          this.marginNotes = res.data.financials.marginNotes || '';
        }
      });
    }
  }

  formatPrice(amountCents: number, billingInterval?: string | null): string {
    const dollars = (amountCents / 100).toFixed(2);
    return billingInterval ? `$${dollars}/${billingInterval}` : `$${dollars}`;
  }

  openStripePortal() {
    const project = this.selected();
    if (!project) return;
    this.openingPortal.set(true);
    this.billingService.getPortalLink(project.organizationId).subscribe({
      next: (res) => {
        this.openingPortal.set(false);
        window.open(res.data.url, '_blank');
      },
      error: (err) => {
        this.openingPortal.set(false);
        this.actionMessage.set(err.error?.message || 'Failed to open the Stripe billing portal');
      },
    });
  }

  saveFinancials() {
    const id = this.projectId();
    if (!id) return;
    const estimatedCostCents = this.estimatedCostDollars ? Math.round(Number.parseFloat(this.estimatedCostDollars) * 100) : undefined;
    const actualCostCents = this.actualCostDollars ? Math.round(Number.parseFloat(this.actualCostDollars) * 100) : undefined;
    this.projectService.updateFinancials(id, { estimatedCostCents, actualCostCents, marginNotes: this.marginNotes }).subscribe((res) => {
      this.financials.set(res.data.financials);
      this.actionMessage.set('Internal cost notes updated');
    });
  }

  loadCancellationRequests(projectId: string) {
    this.cancellationService.list(projectId).subscribe((res) => this.cancellationRequests.set(res.data.cancellationRequests));
  }

  requestCancellation() {
    const id = this.projectId();
    if (!id) return;
    this.cancellationService.create(id, this.newCancellationReason).subscribe(() => {
      this.newCancellationReason = '';
      this.loadCancellationRequests(id);
      this.actionMessage.set('Cancellation requested');
    });
  }

  confirmCancellation(cancellationRequest: CancellationRequest) {
    const id = this.projectId();
    if (!id) return;
    this.cancellationService.confirm(id, cancellationRequest.id).subscribe(() => {
      this.loadCancellationRequests(id);
      this.actionMessage.set('Cancellation confirmed');
    });
  }

  withdrawCancellation(cancellationRequest: CancellationRequest) {
    const id = this.projectId();
    if (!id) return;
    this.cancellationService.withdraw(id, cancellationRequest.id).subscribe(() => {
      this.loadCancellationRequests(id);
      this.actionMessage.set('Cancellation withdrawn');
    });
  }
}
