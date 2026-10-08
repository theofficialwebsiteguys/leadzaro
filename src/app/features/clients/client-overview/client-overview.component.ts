import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { PAYMENT_STATUSES, PROJECT_TYPE_LABELS, ProjectType } from '../../../core/models/client.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { CentsPipe } from '../../../shared/pipes/cents.pipe';
import { HostPipe } from '../../../shared/pipes/host.pipe';
import { LabelPipe } from '../../../shared/pipes/label.pipe';
import { ClientStore, ProfileEssential } from '../client.store';
import { ClientAccountComponent } from '../client-account/client-account.component';
import { frequencySuffix, renewalHint, renewalTone } from '../client-format';

@Component({
  selector: 'app-client-overview',
  standalone: true,
  imports: [RouterLink, DatePipe, IconComponent, CentsPipe, HostPipe, LabelPipe, ClientAccountComponent],
  templateUrl: './client-overview.component.html',
  styleUrl: './client-overview.component.scss',
})
export class ClientOverviewComponent {
  readonly store = inject(ClientStore);
  readonly org = inject(OrganizationContextService);
  private readonly router = inject(Router);

  readonly renewalHint = renewalHint;
  readonly renewalTone = renewalTone;
  readonly frequencySuffix = frequencySuffix;
  readonly paymentStatuses = PAYMENT_STATUSES;

  readonly detail = this.store.detail;
  readonly profile = computed(() => this.store.detail()!.profile);
  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));

  readonly essentialsDone = computed(() => this.store.essentialsTotal - this.store.missingEssentials().length);

  /** Everything worth one click: live site, project URLs, admin links. */
  readonly quickLinks = computed(() => {
    const detail = this.store.detail()!;
    const links: { label: string; url: string }[] = [];
    if (detail.profile.websiteUrl) links.push({ label: 'Live site', url: detail.profile.websiteUrl });
    for (const project of detail.projects) {
      if (project.liveUrl && project.liveUrl !== detail.profile.websiteUrl) links.push({ label: `${project.displayName} (live)`, url: project.liveUrl });
      if (project.previewUrl) links.push({ label: `${project.displayName} (preview)`, url: project.previewUrl });
    }
    for (const link of detail.profile.adminLinks) links.push({ label: link.label || 'Admin link', url: link.url });
    return links;
  });

  readonly mediaThumbs = computed(() => this.store.imageFiles().slice(0, 4));

  projectTypeLabel(type: ProjectType | null): string {
    return type ? PROJECT_TYPE_LABELS[type] : 'Project';
  }

  openEssential(item: ProfileEssential) {
    if (item.opensEditClient) {
      this.store.editClientOpen.set(true);
      return;
    }
    this.router.navigate(['/app/clients', this.store.clientId, item.tab], { queryParams: item.query });
  }
}
