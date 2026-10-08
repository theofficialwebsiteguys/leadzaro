import {
  AfterViewInit, Component, ElementRef, computed, inject, signal, viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { ClientFile } from '../../../core/models/client.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { ClientStore } from '../client.store';
import { formatBytes } from '../client-format';

type Filter = 'all' | 'client' | string;

function errorMessage(err: unknown, fallback: string): string {
  return (err as { error?: { message?: string } })?.error?.message || fallback;
}

@Component({
  selector: 'app-client-media',
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent],
  templateUrl: './client-media.component.html',
  styleUrl: './client-media.component.scss',
})
export class ClientMediaComponent implements AfterViewInit {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);
  private readonly route = inject(ActivatedRoute);
  readonly org = inject(OrganizationContextService);

  readonly formatBytes = formatBytes;
  private readonly uploadPanel = viewChild<ElementRef<HTMLElement>>('uploadPanel');

  readonly projects = computed(() => this.store.detail()?.projects ?? []);
  readonly canUpload = computed(() => this.org.hasPermission('files.upload'));
  readonly canManage = computed(() => this.org.hasPermission('projects.manage'));
  readonly canDelete = computed(() => this.org.hasPermission('files.manage'));

  filter = signal<Filter>('all');
  attachTo = '';
  uploading = signal(false);
  uploadStatus = signal('');
  message = signal('');
  highlightUpload = signal(false);

  readonly files = computed(() => {
    const all = this.store.detail()?.files ?? [];
    const filter = this.filter();
    if (filter === 'all') return all;
    if (filter === 'client') return all.filter((file) => !file.projectId);
    return all.filter((file) => file.projectId === filter);
  });

  ngAfterViewInit() {
    if (this.route.snapshot.queryParamMap.get('upload')) {
      this.highlightUpload.set(true);
      this.uploadPanel()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  isImage(file: ClientFile): boolean {
    return file.mimeType.startsWith('image/');
  }

  extension(file: ClientFile): string {
    const match = /\.([a-z0-9]{1,5})$/i.exec(file.originalName);
    return match ? match[1].toUpperCase() : 'FILE';
  }

  projectName(projectId: string | null): string {
    if (!projectId) return 'Client-wide';
    return this.projects().find((project) => project.id === projectId)?.displayName ?? 'Project';
  }

  roles(file: ClientFile): string[] {
    const detail = this.store.detail();
    if (!detail) return [];
    const roles: string[] = [];
    if (detail.profile.logoFileId === file.id) roles.push('Logo');
    if (detail.profile.featuredImageFileId === file.id) roles.push('Featured');
    for (const project of detail.projects) if (project.previewFileId === file.id) roles.push(`${project.displayName} preview`);
    return roles;
  }

  async onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    if (!selected.length) return;
    this.uploading.set(true);
    this.message.set('');
    const failures: string[] = [];
    for (const [index, file] of selected.entries()) {
      this.uploadStatus.set(selected.length > 1 ? `Uploading ${index + 1} of ${selected.length}…` : 'Uploading…');
      try {
        // eslint-disable-next-line no-await-in-loop
        await firstValueFrom(this.clientService.uploadFile(this.store.clientId, file, this.attachTo || null));
      } catch (err) {
        failures.push(`${file.name}: ${errorMessage(err, 'upload failed')}`);
      }
    }
    input.value = '';
    await this.store.refresh();
    this.uploading.set(false);
    this.uploadStatus.set('');
    this.highlightUpload.set(false);
    this.message.set(failures.length ? failures.join(' · ') : `${selected.length} file${selected.length === 1 ? '' : 's'} uploaded.`);
  }

  async download(file: ClientFile) {
    try {
      const res = await firstValueFrom(this.clientService.downloadUrl(this.store.clientId, file.id));
      const link = document.createElement('a');
      link.href = res.data.url;
      link.download = file.originalName;
      link.rel = 'noopener';
      link.click();
    } catch (err) {
      this.message.set(errorMessage(err, 'The download could not be started.'));
    }
  }

  private async applyUpdate(request: Promise<unknown>, success: string) {
    try {
      await request;
      await this.store.refresh();
      this.message.set(success);
    } catch (err) {
      this.message.set(errorMessage(err, 'That change could not be saved.'));
    }
  }

  setFeatured(file: ClientFile) {
    this.applyUpdate(firstValueFrom(this.clientService.update(this.store.clientId, { featuredImageFileId: file.id })), 'Featured image updated.');
  }

  setLogo(file: ClientFile) {
    this.applyUpdate(firstValueFrom(this.clientService.update(this.store.clientId, { logoFileId: file.id })), 'Logo updated.');
  }

  setProjectPreview(file: ClientFile) {
    if (!file.projectId) return;
    this.applyUpdate(
      firstValueFrom(this.clientService.updateProject(this.store.clientId, file.projectId, { previewFileId: file.id })),
      `Preview image set for ${this.projectName(file.projectId)}.`,
    );
  }

  remove(file: ClientFile) {
    if (!confirm(`Delete “${file.originalName}”? This can’t be undone.`)) return;
    this.applyUpdate(firstValueFrom(this.clientService.deleteFile(this.store.clientId, file.id)), 'File deleted.');
  }
}
