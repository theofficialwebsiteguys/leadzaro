import { Component, inject, signal, viewChild } from '@angular/core';
import { DomainService } from '../../../core/services/domain.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { DomainInventoryComponent } from '../domain-inventory/domain-inventory.component';

/** Domains (ADR 0010): every domain in the connected Namecheap account — read-only. */
@Component({
  selector: 'app-domains-page',
  standalone: true,
  imports: [DomainInventoryComponent],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Domains</h1>
          <p>Every domain in your Namecheap account, which project uses it, and when it expires. Read-only — changes are made in Namecheap.</p>
        </div>
        @if (org.hasPermission('integrations.manage')) {
          <button class="btn btn-outline btn-sm" (click)="syncNow()" [disabled]="syncing()">{{ syncing() ? 'Syncing…' : 'Sync now' }}</button>
        }
      </div>
      @if (message()) { <p class="text-sm text-muted">{{ message() }}</p> }
      <app-domain-inventory />
    </div>
  `,
})
export class DomainsPageComponent {
  private readonly domainService = inject(DomainService);
  readonly org = inject(OrganizationContextService);
  readonly syncing = signal(false);
  readonly message = signal('');
  private readonly inventory = viewChild(DomainInventoryComponent);

  syncNow(): void {
    this.syncing.set(true);
    this.message.set('');
    this.domainService.syncNow().subscribe({
      next: () => this.poll(),
      error: (err) => { this.syncing.set(false); this.message.set(err.error?.message || 'The sync could not be started.'); },
    });
  }

  private poll(): void {
    setTimeout(() => {
      this.domainService.connection().subscribe((res) => {
        if (res.data.connection.syncing) return this.poll();
        this.syncing.set(false);
        this.inventory()?.load();
        return undefined;
      });
    }, 3000);
  }
}
