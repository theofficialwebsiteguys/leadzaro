import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { map } from 'rxjs';
import { RequestService } from '../../core/services/request.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { ClientRequest, REQUEST_CATEGORIES } from '../../core/models/clientRequest.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { LabelPipe } from '../../shared/pipes/label.pipe';

/**
 * What clients have asked us for — a categorized intake log, distinct
 * from Tasks ("what our team is doing"). A request converts into a task
 * once someone actually picks up the work.
 */
@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, EmptyStateComponent, LabelPipe],
  templateUrl: './requests.component.html',
  styleUrl: './requests.component.scss',
})
export class RequestsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly requestService = inject(RequestService);
  readonly org = inject(OrganizationContextService);

  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  readonly requestCategories = REQUEST_CATEGORIES;

  clientRequests = signal<ClientRequest[]>([]);
  actionMessage = signal('');
  newRequestCategory = '';
  newRequestDescription = '';

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.loadRequests(id);
    });
  }

  loadRequests(projectId: string) {
    this.requestService.list(projectId).subscribe((res) => this.clientRequests.set(res.data.requests));
  }

  submitRequest() {
    const id = this.projectId();
    if (!id || !this.newRequestCategory || !this.newRequestDescription.trim()) return;
    this.requestService.create(id, this.newRequestCategory, this.newRequestDescription.trim()).subscribe(() => {
      this.newRequestCategory = '';
      this.newRequestDescription = '';
      this.loadRequests(id);
    });
  }

  updateRequestStatus(req: ClientRequest, status: string) {
    const id = this.projectId();
    if (!id) return;
    this.requestService.updateStatus(id, req.id, status).subscribe(() => this.loadRequests(id));
  }

  convertToTask(req: ClientRequest) {
    const id = this.projectId();
    if (!id) return;
    this.requestService.convertToTask(id, req.id).subscribe({
      next: () => {
        this.actionMessage.set('Converted to a task — find it on the Tasks tab.');
        this.loadRequests(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to convert to a task'),
    });
  }
}
