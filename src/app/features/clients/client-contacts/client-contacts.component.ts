import { PhoneInputDirective, PhonePipe } from '../../../shared/forms/formatted-inputs';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { Contact } from '../../../core/models/contact.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { initialsOf } from '../../../shared/pipes/host.pipe';
import { ClientStore } from '../client.store';

interface ContactForm {
  name: string;
  title: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

@Component({
  selector: 'app-client-contacts',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, IconComponent, PhoneInputDirective, PhonePipe],
  templateUrl: './client-contacts.component.html',
  styleUrl: './client-contacts.component.scss',
})
export class ClientContactsComponent {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);
  readonly org = inject(OrganizationContextService);

  readonly initialsOf = initialsOf;
  readonly contacts = computed(() => this.store.detail()?.contacts ?? []);
  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));

  // null = closed, 'new' = adding, otherwise the id being edited.
  editing = signal<string | null>(null);
  form: ContactForm = this.emptyForm();
  saving = signal(false);
  error = signal('');

  constructor() {
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('add') && this.canEdit()) this.startAdd();
  }

  private emptyForm(): ContactForm {
    return {
      name: '', title: '', email: '', phone: '', isPrimary: false,
    };
  }

  startAdd() {
    this.form = { ...this.emptyForm(), isPrimary: this.contacts().length === 0 };
    this.error.set('');
    this.editing.set('new');
  }

  startEdit(contact: Contact) {
    this.form = {
      name: contact.name, title: contact.title ?? '', email: contact.email ?? '', phone: contact.phone ?? '', isPrimary: contact.isPrimary,
    };
    this.error.set('');
    this.editing.set(contact.id);
  }

  async save() {
    if (!this.form.name.trim() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    const editing = this.editing();
    try {
      if (editing === 'new') {
        await firstValueFrom(this.clientService.createContact(this.store.clientId, this.form));
      } else if (editing) {
        await firstValueFrom(this.clientService.updateContact(this.store.clientId, editing, this.form));
      }
      await this.store.refresh();
      this.editing.set(null);
    } catch (err) {
      this.error.set((err as { error?: { message?: string } })?.error?.message || 'The contact could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }

  async makePrimary(contact: Contact) {
    await firstValueFrom(this.clientService.updateContact(this.store.clientId, contact.id, { isPrimary: true }));
    await this.store.refresh();
  }

  async remove(contact: Contact) {
    if (!confirm(`Remove ${contact.name} from this client’s contacts?`)) return;
    await firstValueFrom(this.clientService.archiveContact(this.store.clientId, contact.id));
    await this.store.refresh();
  }
}
