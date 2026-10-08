import { Injectable, computed, inject, signal } from '@angular/core';
import { ClientService } from '../../core/services/client.service';
import { DomainService } from '../../core/services/domain.service';
import { ClientDetail } from '../../core/models/client.model';
import { ClientDomainsView, DomainView } from '../../core/models/domain.model';

export interface ProfileEssential {
  key: string;
  label: string;
  // Where the Add action goes: a tab + query, or the Edit Client dialog.
  tab?: string;
  query?: Record<string, string>;
  opensEditClient?: boolean;
}

/**
 * One client's binder, loaded once by the client shell and shared with
 * every tab (provided at the shell, so each open client gets its own
 * instance). Tabs call refresh() after a save instead of each keeping its
 * own copy — one request reloads the whole profile.
 */
@Injectable()
export class ClientStore {
  private readonly clientService = inject(ClientService);
  private readonly domainService = inject(DomainService);

  readonly detail = signal<ClientDetail | null>(null);
  /** Domains & Hosting (ADR 0009) — loaded alongside the profile. */
  readonly domains = signal<ClientDomainsView | null>(null);
  readonly domainsError = signal('');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly editClientOpen = signal(false);
  private currentId = '';

  get clientId(): string {
    return this.currentId;
  }

  readonly primaryContact = computed(() => {
    const contacts = this.detail()?.contacts ?? [];
    return contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
  });

  readonly imageFiles = computed(() => (this.detail()?.files ?? []).filter((file) => file.mimeType.startsWith('image/')));

  /** Featured image, falling back to the first project preview — the hero/cover shown for the client. */
  readonly heroImage = computed(() => {
    const detail = this.detail();
    if (!detail) return null;
    return detail.profile.featuredImage ?? detail.projects.find((project) => project.previewImage)?.previewImage ?? null;
  });

  readonly stillNeeded = computed(() => (this.detail()?.projects ?? []).flatMap((project) => project.outstandingNeeds
    .filter((need) => !need.done)
    .map((need) => ({ ...need, projectId: project.id, projectName: project.displayName }))));

  /** The client's primary domain (a primary link wins), for the overview. */
  readonly primaryDomain = computed<DomainView | null>(() => {
    const domains = this.domains()?.domains ?? [];
    return domains.find((domain) => domain.links.some((link) => link.isPrimary && link.projectId === null))
      ?? domains.find((domain) => domain.links.some((link) => link.isPrimary))
      ?? domains[0]
      ?? null;
  });

  /** Domains that need a decision (conflict / subdomain-only match). */
  readonly domainsNeedingReview = computed(() => (this.domains()?.domains ?? []).filter((domain) => domain.links.some((link) => link.state === 'conflict' || link.state === 'review')));

  /** Only what's still missing — the guide disappears as the profile fills in. */
  readonly missingEssentials = computed<ProfileEssential[]>(() => {
    const detail = this.detail();
    if (!detail) return [];
    const { profile } = detail;
    const primary = this.primaryContact();
    const missing: ProfileEssential[] = [];
    if (!profile.logo) missing.push({ key: 'logo', label: 'Add a logo', opensEditClient: true });
    if (!primary || !(primary.email || primary.phone)) missing.push({ key: 'contact', label: primary ? 'Add contact email or phone' : 'Add a primary contact', tab: 'contacts', query: { add: '1' } });
    if (!profile.websiteUrl) missing.push({ key: 'website', label: 'Add website', tab: 'domains', query: { website: '1' } });
    if (!this.heroImage()) missing.push({ key: 'screenshot', label: 'Add a site screenshot', tab: 'media', query: { upload: '1' } });
    const domainsView = this.domains();
    if (domainsView && domainsView.domains.length === 0 && domainsView.hosting.length === 0) missing.push({ key: 'hosting', label: 'Add domain & hosting', tab: 'domains', query: { add: '1' } });
    if (profile.recurringPriceCents === null && profile.setupPriceCents === null) missing.push({ key: 'billing', label: 'Set billing', tab: 'billing', query: { edit: '1' } });
    if (detail.projects.length === 0) missing.push({ key: 'project', label: 'Add a project', tab: 'projects', query: { add: '1' } });
    return missing;
  });

  readonly essentialsTotal = 7;

  load(clientId: string) {
    if (clientId !== this.currentId) {
      this.detail.set(null);
      this.domains.set(null);
    }
    this.currentId = clientId;
    return this.refresh();
  }

  refresh(): Promise<void> {
    this.loading.set(true);
    return Promise.all([this.refreshProfile(), this.refreshDomains()]).then(() => undefined);
  }

  refreshDomains(): Promise<void> {
    const clientId = this.currentId;
    return new Promise((resolve) => {
      this.domainService.clientDomains(clientId).subscribe({
        next: (res) => {
          if (clientId === this.currentId) {
            this.domains.set(res.data);
            this.domainsError.set('');
          }
          resolve();
        },
        error: (err) => {
          this.domainsError.set(err.error?.message || 'Domains could not be loaded.');
          resolve();
        },
      });
    });
  }

  private refreshProfile(): Promise<void> {
    return new Promise((resolve) => {
      this.clientService.get(this.currentId).subscribe({
        next: (res) => {
          this.detail.set(res.data);
          this.loadError.set('');
          this.loading.set(false);
          resolve();
        },
        error: (err) => {
          this.loadError.set(err.error?.message || 'This client could not be loaded.');
          this.loading.set(false);
          resolve();
        },
      });
    });
  }
}
