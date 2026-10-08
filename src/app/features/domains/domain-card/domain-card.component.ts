import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { DomainService } from '../../../core/services/domain.service';
import { ConnectionSummary, DomainLinkView, DomainView } from '../../../core/models/domain.model';
import { SourceTagComponent } from '../source-tag.component';

const SOURCE_NAMES: Record<DomainLinkView['source'], string> = {
  client_website: 'Client website',
  project_url: 'Live URL',
  manual: 'Added by hand',
  namecheap_link: 'Linked from Domains',
};

/**
 * One domain as a client uses it — read from Namecheap, never changed there
 * (ADR 0010). Only the link between the domain and this client/project can
 * be adjusted here.
 */
@Component({
  selector: 'app-domain-card',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, SourceTagComponent],
  templateUrl: './domain-card.component.html',
  styleUrl: './domain-card.component.scss',
})
export class DomainCardComponent {
  private readonly domainService = inject(DomainService);

  readonly domain = input.required<DomainView>();
  readonly clientId = input.required<string>();
  readonly projects = input<{ id: string; name: string }[]>([]);
  readonly canEdit = input(false);
  readonly canSeeInternals = input(false);
  readonly connection = input<ConnectionSummary | null>(null);
  readonly changed = output<void>();

  readonly sourceNames = SOURCE_NAMES;
  readonly showLinks = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly matched = computed(() => this.domain().providerMatched);
  readonly primaryLink = computed<DomainLinkView | null>(() => this.domain().links.find((link) => link.isPrimary) ?? this.domain().links.at(0) ?? null);
  readonly headline = computed<DomainLinkView | null>(() => {
    const order = ['conflict', 'review', 'missing', 'linked', 'not_found', 'pending', 'unlinked', 'manual'];
    return [...this.domain().links].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).at(0) ?? null;
  });
  readonly expiryTone = computed(() => {
    const days = this.domain().daysUntilExpiry;
    if (days === null || days === undefined) return 'unknown';
    if (days < 0) return 'overdue';
    return days <= 30 ? 'soon' : 'ok';
  });

  decide(link: DomainLinkView, decision: 'confirm' | 'reject' | 'automatic'): void {
    const labels = { confirm: 'Linked to this client', reject: 'Unlinked from this client', automatic: 'Back to automatic matching' };
    this.run(this.domainService.updateDomainLink(this.clientId(), link.id, { decision }), labels[decision]);
  }

  makePrimary(link: DomainLinkView): void {
    this.run(this.domainService.updateDomainLink(this.clientId(), link.id, { isPrimary: true }), 'Primary domain updated');
  }

  moveLink(link: DomainLinkView, projectId: string): void {
    this.run(this.domainService.updateDomainLink(this.clientId(), link.id, { projectId: projectId || null }), 'Domain moved');
  }

  removeLink(link: DomainLinkView): void {
    this.run(this.domainService.removeDomainLink(this.clientId(), link.id), 'Domain removed from this client');
  }

  checkAgain(): void {
    this.run(this.domainService.checkAgain(this.domain().id), 'Checked Namecheap');
  }

  otherClientNames(link: DomainLinkView): string {
    return link.otherClients.length ? link.otherClients.map((client) => client.name).join(', ') : 'another client';
  }

  daysLabel(days: number | null): string {
    if (days === null) return '';
    if (days < 0) return `expired ${-days} day${days === -1 ? '' : 's'} ago`;
    if (days === 0) return 'today';
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }

  onOff(value: boolean | null | undefined): string {
    if (value === true) return 'On';
    if (value === false) return 'Off';
    return 'Unknown';
  }

  private run(request: Observable<unknown>, message: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: () => { this.busy.set(false); this.notice.set(message); this.changed.emit(); },
      error: (err: { error?: { message?: string } }) => { this.busy.set(false); this.error.set(err.error?.message || 'That didn’t work.'); },
    });
  }
}
