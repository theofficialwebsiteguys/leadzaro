import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { DomainService } from '../../../core/services/domain.service';
import { ClientService } from '../../../core/services/client.service';
import { DomainDetail } from '../../../core/models/domain.model';
import { ClientSummary } from '../../../core/models/client.model';
import { SourceTagComponent } from '../source-tag.component';

/**
 * One domain (ADR 0010): what Namecheap reports about it, read-only, and
 * which client/project it belongs to — the only thing changed here.
 */
@Component({
  selector: 'app-domain-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule, SourceTagComponent],
  templateUrl: './domain-detail.component.html',
  styleUrl: './domain-detail.component.scss',
})
export class DomainDetailComponent implements OnInit {
  private readonly domainService = inject(DomainService);
  private readonly clientService = inject(ClientService);
  private readonly route = inject(ActivatedRoute);

  readonly domain = signal<DomainDetail | null>(null);
  readonly loadError = signal('');
  readonly refreshing = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly clients = signal<ClientSummary[]>([]);
  readonly linking = signal(false);
  linkClientId = '';
  linkProjectId = '';
  private domainId = '';

  ngOnInit(): void {
    this.domainId = this.route.snapshot.paramMap.get('domainId')!;
    this.load();
  }

  load(): void {
    this.domainService.detail(this.domainId).subscribe({
      next: (res) => { this.domain.set(res.data.domain); this.loadError.set(''); },
      error: (err) => this.loadError.set(err.error?.message || 'This domain could not be loaded.'),
    });
  }

  refresh(): void {
    this.refreshing.set(true);
    this.domainService.refresh(this.domainId).subscribe({
      next: (res) => { this.domain.set(res.data.domain); this.refreshing.set(false); this.message.set('Refreshed from Namecheap.'); },
      error: (err) => { this.refreshing.set(false); this.message.set(err.error?.message || 'Could not refresh right now.'); },
    });
  }

  startLink(): void {
    this.linkClientId = '';
    this.linkProjectId = '';
    this.linking.set(true);
    if (!this.clients().length) this.clientService.list().subscribe((res) => this.clients.set(res.data.clients));
  }

  projectsFor(clientId: string) {
    return this.clients().find((client) => client.id === clientId)?.projects ?? [];
  }

  link(): void {
    if (!this.linkClientId) return;
    this.busy.set(true);
    this.domainService.link(this.domainId, this.linkClientId, this.linkProjectId || null).subscribe({
      next: () => { this.busy.set(false); this.linking.set(false); this.message.set('Linked.'); this.load(); },
      error: (err) => { this.busy.set(false); this.message.set(err.error?.message || 'Could not link the domain.'); },
    });
  }

  unlink(link: DomainDetail['links'][number]): void {
    this.busy.set(true);
    const request: Observable<unknown> = link.source === 'manual' || link.source === 'namecheap_link'
      ? this.domainService.removeDomainLink(link.clientId, link.id)
      : this.domainService.updateDomainLink(link.clientId, link.id, { decision: 'reject' });
    request.subscribe({
      next: () => { this.busy.set(false); this.message.set('Unlinked. Nothing was changed at Namecheap.'); this.load(); },
      error: (err: { error?: { message?: string } }) => { this.busy.set(false); this.message.set(err.error?.message || 'Could not unlink.'); },
    });
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
}
