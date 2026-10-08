import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { DomainService } from '../../../core/services/domain.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { LinkEntry } from '../../../core/models/client.model';
import { DomainMatch } from '../../../core/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { HostPipe } from '../../../shared/pipes/host.pipe';
import { ClientStore } from '../client.store';
import { LinkListEditorComponent } from '../link-list-editor/link-list-editor.component';
import { DomainCardComponent } from '../../domains/domain-card/domain-card.component';
import { DomainMatchComponent } from '../../domains/domain-match.component';
import { DomainLookupState } from '../../domains/domain-lookup';

interface WebsiteForm {
  websiteUrl: string;
  accessNotes: string;
}

/**
 * The client's Domains & Hosting tab (ADR 0009): registered domains with
 * their Namecheap or manual details, hosting plans and each one's share,
 * what it all costs versus what the client pays, and where to log in.
 * Everything works without Namecheap; with it, details fill themselves in.
 */
@Component({
  selector: 'app-client-domains',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, HostPipe, LinkListEditorComponent, DomainCardComponent, DomainMatchComponent],
  templateUrl: './client-domains.component.html',
  styleUrl: './client-domains.component.scss',
})
export class ClientDomainsComponent {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);
  private readonly domainService = inject(DomainService);
  readonly org = inject(OrganizationContextService);

  readonly view = computed(() => this.store.domains());
  readonly profile = computed(() => this.store.detail()!.profile);
  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));
  readonly isAdmin = computed(() => this.org.hasPermission('integrations.manage'));

  // Add domain
  readonly adding = signal(false);
  readonly addBusy = signal(false);
  readonly addError = signal('');
  readonly lastMatch = signal<DomainMatch | null>(null);
  readonly addLookup = new DomainLookupState(this.domainService);
  newDomain = '';
  newDomainProjectId = '';
  newDomainPrimary = false;

  // Website & access
  readonly editingWebsite = signal(false);
  readonly websiteBusy = signal(false);
  readonly websiteError = signal('');
  readonly websiteLookup = new DomainLookupState(this.domainService);
  readonly websiteMatch = signal<DomainMatch | null>(null);
  website: WebsiteForm = { websiteUrl: '', accessNotes: '' };
  links = signal<LinkEntry[]>([]);

  constructor() {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    if (query.get('add') && this.canEdit()) this.openAdd();
    if ((query.get('website') || query.get('edit')) && this.canEdit()) this.startWebsiteEdit();
  }

  openAdd(): void {
    this.newDomain = '';
    this.newDomainProjectId = '';
    this.newDomainPrimary = false;
    this.addError.set('');
    this.addLookup.reset();
    this.adding.set(true);
  }

  addDomain(): void {
    if (!this.newDomain.trim() || this.addBusy()) return;
    this.addBusy.set(true);
    this.addError.set('');
    this.domainService.addClientDomain(this.store.clientId, {
      domain: this.newDomain.trim(), projectId: this.newDomainProjectId || null, isPrimary: this.newDomainPrimary,
    }).subscribe({
      next: async (res) => {
        this.lastMatch.set(res.data.match);
        this.addBusy.set(false);
        this.adding.set(false);
        await this.store.refreshDomains();
      },
      error: (err) => {
        this.addError.set(err.error?.message || 'The domain could not be added.');
        this.addBusy.set(false);
      },
    });
  }

  startWebsiteEdit(): void {
    const p = this.store.detail()?.profile;
    this.website = { websiteUrl: p?.websiteUrl ?? '', accessNotes: p?.accessNotes ?? '' };
    this.links.set((p?.adminLinks ?? []).map((link) => ({ ...link })));
    this.websiteError.set('');
    this.websiteLookup.reset();
    this.editingWebsite.set(true);
  }

  async saveWebsite(): Promise<void> {
    if (this.websiteBusy()) return;
    this.websiteBusy.set(true);
    this.websiteError.set('');
    try {
      const patch: Record<string, unknown> = { websiteUrl: this.website.websiteUrl, adminLinks: this.links() };
      if (this.store.detail()?.canSeeInternals) patch['accessNotes'] = this.website.accessNotes;
      const res = await firstValueFrom(this.clientService.update(this.store.clientId, patch));
      this.websiteMatch.set(res.data.domainMatch ?? null);
      await this.store.refresh();
      this.editingWebsite.set(false);
    } catch (err) {
      this.websiteError.set((err as { error?: { message?: string } })?.error?.message || 'Changes could not be saved.');
    } finally {
      this.websiteBusy.set(false);
    }
  }

  onDomainChanged(): void {
    void this.store.refreshDomains();
  }

  syncAge(iso: string | null): string {
    if (!iso) return 'never';
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }
}
