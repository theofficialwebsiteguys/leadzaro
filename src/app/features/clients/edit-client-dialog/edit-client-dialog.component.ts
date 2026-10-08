import { ZipInputDirective } from '../../../shared/forms/formatted-inputs';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { initialsOf } from '../../../shared/pipes/host.pipe';
import { ClientStore } from '../client.store';

interface IdentityForm {
  name: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  internalNotes: string;
}

/** The persistent "Edit Client" form: identity, logo, address, internal notes. */
@Component({
  selector: 'app-edit-client-dialog',
  standalone: true,
  imports: [FormsModule, DialogComponent, ZipInputDirective],
  templateUrl: './edit-client-dialog.component.html',
  styleUrl: './edit-client-dialog.component.scss',
})
export class EditClientDialogComponent {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);

  readonly initialsOf = initialsOf;

  form: IdentityForm = this.emptyForm();
  logoFileId = signal<string | null>(null);
  logoPreviewUrl = signal<string | null>(null);
  pendingLogoUpload: File | null = null;
  choosingLogo = signal(false);
  saving = signal(false);
  error = signal('');

  constructor() {
    effect(() => {
      if (this.store.editClientOpen()) untracked(() => this.populate());
    });
  }

  private emptyForm(): IdentityForm {
    return {
      name: '', description: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: '', internalNotes: '',
    };
  }

  private populate() {
    const detail = this.store.detail();
    if (!detail) return;
    const p = detail.profile;
    this.form = {
      name: detail.client.name,
      description: p.description ?? '',
      addressLine1: p.addressLine1 ?? '',
      addressLine2: p.addressLine2 ?? '',
      city: p.city ?? '',
      state: p.state ?? '',
      postalCode: p.postalCode ?? '',
      country: p.country ?? '',
      internalNotes: p.internalNotes ?? '',
    };
    this.logoFileId.set(p.logoFileId);
    this.logoPreviewUrl.set(p.logo?.thumbnailUrl || p.logo?.url || null);
    this.pendingLogoUpload = null;
    this.choosingLogo.set(false);
    this.error.set('');
  }

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pendingLogoUpload = file;
    this.logoPreviewUrl.set(URL.createObjectURL(file));
    this.logoFileId.set(null);
  }

  chooseExistingLogo(fileId: string, url: string) {
    this.pendingLogoUpload = null;
    this.logoFileId.set(fileId);
    this.logoPreviewUrl.set(url);
    this.choosingLogo.set(false);
  }

  removeLogo() {
    this.pendingLogoUpload = null;
    this.logoFileId.set(null);
    this.logoPreviewUrl.set(null);
  }

  close() {
    this.store.editClientOpen.set(false);
  }

  async save() {
    if (!this.form.name.trim() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      let logoFileId = this.logoFileId();
      if (this.pendingLogoUpload) {
        const uploaded = await firstValueFrom(this.clientService.uploadFile(this.store.clientId, this.pendingLogoUpload));
        logoFileId = uploaded.data.file.id;
      }
      await firstValueFrom(this.clientService.update(this.store.clientId, { ...this.form, logoFileId }));
      await this.store.refresh();
      this.close();
    } catch (err) {
      const message = (err as { error?: { message?: string } })?.error?.message;
      this.error.set(message || 'Changes could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }
}
