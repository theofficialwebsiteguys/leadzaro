import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomainMatch, LookupResult } from '../../core/models/domain.model';

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'busy';

interface Display {
  tone: Tone;
  title: string;
  domain: string | null;
  detail: string | null;
  expiresOn: string | null;
  daysUntilExpiry: number | null;
  autoRenew: boolean | null;
}

/**
 * The status line shown next to a website/domain field: a lookup before
 * saving ("Matched in Namecheap" + what was found) or the match a save
 * produced. Wording never calls a missing domain "expired" or "invalid".
 */
@Component({
  selector: 'app-domain-match',
  standalone: true,
  imports: [DatePipe],
  template: `
    @let d = display();
    @if (checking()) {
      <div class="domain-match tone-busy" role="status"><span class="dot"></span> Checking Namecheap…</div>
    } @else if (d) {
      <div class="domain-match" [class]="'domain-match tone-' + d.tone" role="status">
        <span class="dot"></span>
        <div class="text">
          <strong>{{ d.title }}</strong>@if (d.domain) { <span class="domain"> · {{ d.domain }}</span> }
          @if (d.expiresOn) {
            <span class="facts">
              Expires {{ d.expiresOn | date:'MMM d, y' }}@if (d.daysUntilExpiry !== null) { ({{ daysLabel(d.daysUntilExpiry) }}) }
              · auto-renew {{ d.autoRenew === true ? 'on' : d.autoRenew === false ? 'off' : 'unknown' }}
            </span>
          }
          @if (d.detail) { <span class="detail">{{ d.detail }}</span> }
        </div>
      </div>
    }
  `,
  styles: [`
    .domain-match {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 6px;
      padding: 8px 10px;
      border-radius: var(--radius);
      font-size: .8rem;
      line-height: 1.45;
      background: var(--border-light);
      color: var(--text-secondary);
    }
    .dot { flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--text-muted); }
    .text { display: flex; flex-direction: column; min-width: 0; }
    .text strong { color: var(--text-primary); font-weight: 600; }
    .domain { color: var(--text-secondary); }
    .facts, .detail { color: var(--text-secondary); }
    .tone-good { background: rgba(16, 185, 129, .08); }
    .tone-good .dot { background: var(--success, #10b981); }
    .tone-warn { background: rgba(245, 158, 11, .1); }
    .tone-warn .dot { background: var(--warning, #f59e0b); }
    .tone-bad { background: rgba(239, 68, 68, .08); }
    .tone-bad .dot { background: var(--danger, #ef4444); }
    .tone-busy .dot { background: var(--primary); animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .35; } }
  `],
})
export class DomainMatchComponent {
  readonly lookup = input<LookupResult | null>(null);
  readonly match = input<DomainMatch | null | undefined>(null);
  readonly checking = input(false);
  readonly lookupFailed = input(false);

  readonly display = computed<Display | null>(() => {
    const match = this.match();
    if (match) return this.fromMatch(match);
    const lookup = this.lookup();
    if (lookup) return this.fromLookup(lookup);
    if (this.lookupFailed()) {
      return {
        tone: 'neutral', title: 'Couldn’t check Namecheap', domain: null, detail: 'You can still save; the match is checked again after saving and on the next sync.', expiresOn: null, daysUntilExpiry: null, autoRenew: null,
      };
    }
    return null;
  });

  daysLabel(days: number): string {
    if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
    if (days === 0) return 'today';
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }

  private fromLookup(lookup: LookupResult): Display {
    const base = {
      domain: lookup.displayName ?? lookup.hostname, expiresOn: null, daysUntilExpiry: null, autoRenew: null,
    };
    const elsewhere = lookup.linkedElsewhere?.length
      ? `Already linked to ${lookup.linkedElsewhere.map((c) => c.clientName).join(', ')} — you can resolve that after saving.`
      : null;
    switch (lookup.state) {
      case 'matched':
        return {
          ...base,
          tone: elsewhere ? 'warn' : 'good',
          title: lookup.label,
          expiresOn: lookup.preview?.expiresOn ?? null,
          daysUntilExpiry: lookup.preview?.daysUntilExpiry ?? null,
          autoRenew: lookup.preview?.autoRenew ?? null,
          detail: elsewhere ?? (lookup.subdomain ? `Matched through the registered domain ${lookup.displayName}.` : 'It will be linked when you save.'),
        };
      case 'missing':
        return {
          ...base, tone: 'warn', title: lookup.label, detail: 'It was in the account before; its last known details are kept.',
        };
      case 'not_found':
        return {
          ...base, tone: 'neutral', title: lookup.label, detail: elsewhere ?? 'Save as usual — registrar, dates and costs can be entered by hand, and future syncs keep checking.',
        };
      case 'not_connected':
        return { ...base, tone: 'neutral', title: lookup.label, detail: null };
      case 'check_failed':
        return {
          ...base, tone: 'neutral', title: lookup.label, detail: lookup.checkError ?? null,
        };
      case 'platform':
        return { ...base, tone: 'neutral', title: lookup.label, detail: lookup.message ?? null };
      default:
        return {
          ...base, tone: 'bad', title: lookup.label, domain: null, detail: lookup.message ?? null,
        };
    }
  }

  private fromMatch(match: DomainMatch): Display {
    const preview = match.preview;
    const base = {
      domain: match.displayName ?? match.domainName ?? match.hostname, expiresOn: preview?.expiresOn ?? null, daysUntilExpiry: preview?.daysUntilExpiry ?? null, autoRenew: preview?.autoRenew ?? null,
    };
    switch (match.state) {
      case 'linked':
        return { ...base, tone: 'good', title: match.label, detail: null };
      case 'conflict':
        return { ...base, tone: 'warn', title: match.label, detail: 'Open Domains & Hosting to choose which client this domain belongs to.' };
      case 'review':
        return { ...base, tone: 'warn', title: match.label, detail: 'The site uses a subdomain; confirm the registered domain belongs to this client in Domains & Hosting.' };
      case 'missing':
        return { ...base, tone: 'warn', title: match.label, detail: 'Last known details are kept.' };
      default:
        return {
          ...base, tone: 'neutral', title: match.label, expiresOn: null, detail: null,
        };
    }
  }
}
