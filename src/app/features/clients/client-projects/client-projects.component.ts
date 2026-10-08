import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { ProjectService } from '../../../core/services/project.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import {
  ClientProject, OutstandingNeed, PROJECT_TYPE_LABELS, PROJECT_TYPES, ProjectType,
} from '../../../core/models/client.model';
import { PROJECT_STAGES } from '../../../core/models/project.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { HostPipe } from '../../../shared/pipes/host.pipe';
import { ClientStore } from '../client.store';
import { DomainService } from '../../../core/services/domain.service';
import { DomainMatch } from '../../../core/models/domain.model';
import { DomainLookupState } from '../../domains/domain-lookup';
import { DomainMatchComponent } from '../../domains/domain-match.component';

interface ProjectForm {
  name: string;
  projectType: ProjectType | '';
  description: string;
  liveUrl: string;
  previewUrl: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { error?: { message?: string } })?.error?.message || fallback;
}

@Component({
  selector: 'app-client-projects',
  standalone: true,
  imports: [RouterLink, FormsModule, NgTemplateOutlet, IconComponent, HostPipe, DomainMatchComponent],
  templateUrl: './client-projects.component.html',
  styleUrl: './client-projects.component.scss',
})
export class ClientProjectsComponent {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);
  private readonly projectService = inject(ProjectService);
  readonly org = inject(OrganizationContextService);
  /** Checks the live URL against Namecheap before saving (ADR 0009). */
  readonly liveLookup = new DomainLookupState(inject(DomainService));
  readonly savedMatch = signal<DomainMatch | null>(null);

  readonly projectTypes = PROJECT_TYPES;
  readonly typeLabels = PROJECT_TYPE_LABELS;
  readonly stages = PROJECT_STAGES;

  readonly projects = computed(() => this.store.detail()?.projects ?? []);
  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));

  addOpen = signal(false);
  editingId = signal<string | null>(null);
  form: ProjectForm = this.emptyForm();
  previewFileId = signal<string | null>(null);
  pendingPreviewUpload: File | null = null;
  pendingPreviewUrl = signal<string | null>(null);
  saving = signal(false);
  error = signal('');
  notice = signal('');
  needDrafts: Record<string, string> = {};

  constructor() {
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('add')) this.openAdd();
  }

  private emptyForm(): ProjectForm {
    return {
      name: '', projectType: '', description: '', liveUrl: '', previewUrl: '',
    };
  }

  typeLabel(type: ProjectType | null): string {
    return type ? PROJECT_TYPE_LABELS[type] : 'Project';
  }

  openAdd() {
    this.liveLookup.reset();
    this.savedMatch.set(null);
    this.editingId.set(null);
    this.form = this.emptyForm();
    this.previewFileId.set(null);
    this.pendingPreviewUpload = null;
    this.pendingPreviewUrl.set(null);
    this.error.set('');
    this.addOpen.set(true);
  }

  startEdit(project: ClientProject) {
    this.liveLookup.reset();
    this.savedMatch.set(null);
    this.addOpen.set(false);
    this.form = {
      name: project.name ?? project.displayName,
      projectType: project.projectType ?? '',
      description: project.description ?? '',
      liveUrl: project.liveUrl ?? '',
      previewUrl: project.previewUrl ?? '',
    };
    this.previewFileId.set(project.previewFileId);
    this.pendingPreviewUpload = null;
    this.pendingPreviewUrl.set(project.previewImage?.thumbnailUrl || project.previewImage?.url || null);
    this.error.set('');
    this.editingId.set(project.id);
  }

  cancel() {
    this.addOpen.set(false);
    this.editingId.set(null);
  }

  onPreviewSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pendingPreviewUpload = file;
    this.pendingPreviewUrl.set(URL.createObjectURL(file));
    this.previewFileId.set(null);
  }

  choosePreview(fileId: string, url: string) {
    this.pendingPreviewUpload = null;
    this.previewFileId.set(fileId);
    this.pendingPreviewUrl.set(url);
  }

  clearPreview() {
    this.pendingPreviewUpload = null;
    this.previewFileId.set(null);
    this.pendingPreviewUrl.set(null);
  }

  async save() {
    if (!this.form.name.trim() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    const payload = { ...this.form, projectType: this.form.projectType || null };
    const clientId = this.store.clientId;
    // A newly chosen image is uploaded attached to its project, so a new
    // project has to exist before its preview can be uploaded.
    const uploadPreview = async (projectId: string) => {
      const uploaded = await firstValueFrom(this.clientService.uploadFile(clientId, this.pendingPreviewUpload!, projectId));
      return uploaded.data.file.id;
    };
    try {
      const editingId = this.editingId();
      if (editingId) {
        const previewFileId = this.pendingPreviewUpload ? await uploadPreview(editingId) : this.previewFileId();
        const updated = await firstValueFrom(this.clientService.updateProject(clientId, editingId, { ...payload, previewFileId }));
        this.savedMatch.set(updated.data.domainMatch ?? null);
      } else {
        const created = await firstValueFrom(this.clientService.createProject(clientId, {
          ...payload, previewFileId: this.pendingPreviewUpload ? null : this.previewFileId(),
        }));
        this.savedMatch.set(created.data.domainMatch ?? null);
        if (this.pendingPreviewUpload) {
          const projectId = created.data.project.id;
          await firstValueFrom(this.clientService.updateProject(clientId, projectId, { previewFileId: await uploadPreview(projectId) }));
        }
      }

      await this.store.refresh();
      this.notice.set(editingId ? 'Project saved.' : 'Project added.');
      this.cancel();
    } catch (err) {
      this.error.set(errorMessage(err, 'The project could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }

  changeStage(project: ClientProject, stage: string) {
    // The soft-gate checklist is a confirm-or-override gate; with no
    // per-item tracking behind it yet, a manual stage pick is the override.
    this.projectService.changeStage(project.id, stage, { overrideReason: 'Manual update' }).subscribe({
      next: () => this.store.refresh(),
      error: (err) => this.notice.set(errorMessage(err, 'The stage could not be changed.')),
    });
  }

  private saveNeeds(project: ClientProject, needs: OutstandingNeed[]) {
    this.clientService.updateProject(this.store.clientId, project.id, { outstandingNeeds: needs }).subscribe({
      next: () => this.store.refresh(),
      error: (err) => this.notice.set(errorMessage(err, 'That change could not be saved.')),
    });
  }

  toggleNeed(project: ClientProject, need: OutstandingNeed) {
    this.saveNeeds(project, project.outstandingNeeds.map((item) => (item.id === need.id ? { ...item, done: !item.done } : item)));
  }

  removeNeed(project: ClientProject, need: OutstandingNeed) {
    this.saveNeeds(project, project.outstandingNeeds.filter((item) => item.id !== need.id));
  }

  addNeed(project: ClientProject) {
    const label = (this.needDrafts[project.id] || '').trim();
    if (!label) return;
    this.needDrafts[project.id] = '';
    this.saveNeeds(project, [...project.outstandingNeeds, { id: crypto.randomUUID(), label, done: false }]);
  }

  openCount(project: ClientProject): number {
    return project.outstandingNeeds.filter((need) => !need.done).length;
  }
}
