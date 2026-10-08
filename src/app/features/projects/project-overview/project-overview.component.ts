import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { map } from 'rxjs';
import { ProjectService } from '../../../core/services/project.service';
import { NoteService } from '../../../core/services/note.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { ProjectDomainsCardComponent } from '../../domains/project-domains-card/project-domains-card.component';
import { Project, ProjectDashboard, PROJECT_STAGES } from '../../../core/models/project.model';
import { ClientNote, PROJECT_TYPE_LABELS, ProjectType } from '../../../core/models/client.model';
import { EmptyStateComponent } from '../../../shared/empty-state/empty-state.component';
import { LabelPipe } from '../../../shared/pipes/label.pipe';
import { HostPipe } from '../../../shared/pipes/host.pipe';

@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, EmptyStateComponent, LabelPipe, HostPipe, ProjectDomainsCardComponent],
  templateUrl: './project-overview.component.html',
  styleUrl: './project-overview.component.scss',
})
export class ProjectOverviewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);
  private readonly noteService = inject(NoteService);
  readonly org = inject(OrganizationContextService);

  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  readonly stages = PROJECT_STAGES;
  readonly healthOptions: { value: Project['healthStatus']; label: string }[] = [
    { value: 'on_track', label: 'On Track' },
    { value: 'at_risk', label: 'At Risk' },
    { value: 'off_track', label: 'Off Track' },
  ];

  selected = signal<Project | null>(null);
  dashboard = signal<ProjectDashboard | null>(null);
  actionMessage = signal('');

  notes = signal<ClientNote[]>([]);
  newNoteBody = '';
  noteError = signal('');

  readonly openNeeds = computed(() => (this.selected()?.outstandingNeeds ?? []).filter((need) => !need.done));
  readonly isEmployee = computed(() => this.org.membership()?.membershipType === 'employee');

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });
  }

  private load(id: string) {
    this.actionMessage.set('');
    this.dashboard.set(null);

    this.projectService.getById(id).subscribe((res) => this.selected.set(res.data.project));
    this.projectService.getDashboard(id).subscribe((res) => this.dashboard.set(res.data.dashboard));
    if (this.isEmployee()) this.loadNotes(id);
  }

  typeLabel(type: string | null): string {
    return type ? PROJECT_TYPE_LABELS[type as ProjectType] ?? 'Project' : 'Project';
  }

  // --- status row ---

  changeStage(stage: string) {
    const id = this.projectId();
    if (!id) return;
    // The soft-gate checklist is a confirm-or-override human gate; with no
    // per-item completion tracking yet, a manual pick is the override.
    this.projectService.changeStage(id, stage, { overrideReason: 'Manual update' }).subscribe({
      next: (res) => {
        this.selected.set(res.data.project);
        this.actionMessage.set('Stage updated');
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to update stage'),
    });
  }

  changeHealth(healthStatus: string) {
    const id = this.projectId();
    if (!id) return;
    this.projectService.updateHealthStatus(id, healthStatus).subscribe((res) => {
      this.selected.set(res.data.project);
      this.actionMessage.set('Health updated');
    });
  }

  // --- notes (the same feed as the client's Notes tab, pinned to this project) ---

  loadNotes(projectId: string) {
    this.noteService.list(projectId).subscribe((res) => this.notes.set(res.data.notes));
  }

  addNote() {
    const id = this.projectId();
    if (!id || !this.newNoteBody.trim()) return;
    this.noteError.set('');
    this.noteService.create(id, this.newNoteBody.trim()).subscribe({
      next: () => {
        this.newNoteBody = '';
        this.loadNotes(id);
      },
      error: (err) => this.noteError.set(err.error?.message || 'The note could not be added.'),
    });
  }
}
