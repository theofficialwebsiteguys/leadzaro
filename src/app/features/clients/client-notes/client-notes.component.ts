import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { ClientNote } from '../../../core/models/client.model';
import { ClientStore } from '../client.store';

function errorMessage(err: unknown, fallback: string): string {
  return (err as { error?: { message?: string } })?.error?.message || fallback;
}

@Component({
  selector: 'app-client-notes',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './client-notes.component.html',
  styleUrl: './client-notes.component.scss',
})
export class ClientNotesComponent {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);
  readonly org = inject(OrganizationContextService);

  readonly projects = computed(() => this.store.detail()?.projects ?? []);
  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));
  readonly internalNotes = computed(() => this.store.detail()?.profile.internalNotes ?? null);

  notes = signal<ClientNote[]>([]);
  loading = signal(true);
  newBody = '';
  newProjectId = '';
  posting = signal(false);
  postError = signal('');

  editingInternal = signal(false);
  internalDraft = '';
  savingInternal = signal(false);
  internalError = signal('');

  constructor() {
    effect(() => {
      if (this.store.detail()) this.loadNotes();
    });
  }

  loadNotes() {
    this.clientService.listNotes(this.store.clientId).subscribe({
      next: (res) => {
        this.notes.set(res.data.notes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  projectName(projectId: string | null): string | null {
    if (!projectId) return null;
    return this.projects().find((project) => project.id === projectId)?.displayName ?? 'Project';
  }

  async post() {
    if (!this.newBody.trim() || this.posting()) return;
    this.posting.set(true);
    this.postError.set('');
    try {
      await firstValueFrom(this.clientService.createNote(this.store.clientId, this.newBody.trim(), this.newProjectId || null));
      this.newBody = '';
      // Refreshing the store updates the tab count/overview preview and,
      // through the effect above, reloads this feed.
      await this.store.refresh();
    } catch (err) {
      this.postError.set(errorMessage(err, 'The note could not be added.'));
    } finally {
      this.posting.set(false);
    }
  }

  startEditInternal() {
    this.internalDraft = this.internalNotes() ?? '';
    this.internalError.set('');
    this.editingInternal.set(true);
  }

  async saveInternal() {
    this.savingInternal.set(true);
    this.internalError.set('');
    try {
      await firstValueFrom(this.clientService.update(this.store.clientId, { internalNotes: this.internalDraft }));
      await this.store.refresh();
      this.editingInternal.set(false);
    } catch (err) {
      this.internalError.set(errorMessage(err, 'Internal notes could not be saved.'));
    } finally {
      this.savingInternal.set(false);
    }
  }
}
