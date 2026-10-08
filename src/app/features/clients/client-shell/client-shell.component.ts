import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { HostPipe, initialsOf } from '../../../shared/pipes/host.pipe';
import { ClientStore } from '../client.store';
import { EditClientDialogComponent } from '../edit-client-dialog/edit-client-dialog.component';

function readListQuery(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem('lz.clients.query') || '{}');
  } catch {
    return {};
  }
}

@Component({
  selector: 'app-client-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent, HostPipe, EditClientDialogComponent],
  providers: [ClientStore],
  templateUrl: './client-shell.component.html',
  styleUrl: './client-shell.component.scss',
})
export class ClientShellComponent {
  private readonly route = inject(ActivatedRoute);
  readonly store = inject(ClientStore);
  readonly org = inject(OrganizationContextService);

  readonly initialsOf = initialsOf;
  /** The Clients list view this client was opened from (filters, page), so Back returns to it. */
  readonly backQuery = readListQuery();

  private readonly clientId = toSignal(this.route.paramMap.pipe(map((params) => params.get('clientId')!)), {
    initialValue: this.route.snapshot.paramMap.get('clientId')!,
  });

  readonly tabs = computed(() => {
    const detail = this.store.detail();
    return [
      { label: 'Overview', segment: 'overview', icon: 'dashboard', count: null },
      { label: 'Projects', segment: 'projects', icon: 'folder', count: detail?.projects.length ?? null },
      { label: 'Domains', segment: 'domains', icon: 'globe', count: this.store.domains()?.domains.length || null },
      { label: 'Media & Files', segment: 'media', icon: 'image', count: detail?.files.length ?? null },
      { label: 'Billing', segment: 'billing', icon: 'subscription', count: null },
      { label: 'Contacts', segment: 'contacts', icon: 'users', count: detail?.contacts.length ?? null },
      { label: 'Notes', segment: 'notes', icon: 'message', count: detail?.notesCount ?? null },
    ];
  });

  constructor() {
    effect(() => {
      this.store.load(this.clientId());
    });
  }
}
