import { Component, OnChanges, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SalesService } from '../../../core/services/sales.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { ContactResearch, DISCOVERY_TONES, OutreachObservation, Workspace, facebookSearchUrl } from '../../../core/models/sales.model';

const FACEBOOK_MATCH: Record<string, string> = {
  linked_from_website: 'linked from their website',
  google_listing: 'from their Google listing',
  manual: 'added by hand',
  on_record: 'on record',
  uncertain: 'possible match — check it’s theirs',
};

/**
 * Contact research and the reason to reach out (ADR 0014): the email and
 * where it came from, the Facebook page, quick manual capture, and the
 * employee's supported reason for the introduction. Discovery status,
 * pipeline stage and message status are shown separately on purpose.
 */
@Component({
  selector: 'app-contact-research',
  standalone: true,
  imports: [FormsModule, DatePipe, IconComponent],
  template: `
    @let w = ws();
    @let r = research();
    @let person = w.primaryContact;
    <section class="card side-card" aria-label="Contact">
      <header class="side-head">
        <h3>Contact</h3>
        @if (w.permissions.editBusiness) { <button class="link-btn" (click)="addContact.emit()">Add / edit</button> }
      </header>

      @if (person) { <p class="person"><strong>{{ person.name }}</strong>@if (person.title) { <span class="muted"> · {{ person.title }}</span> }</p> }

      <div class="row">
        <span class="lbl">Email</span>
        <div class="val">
          @if (r.email && !editingEmail()) {
            <a [href]="'mailto:' + r.email" class="email">{{ r.email }}</a>
            <span class="note">{{ sourceLabel(r) }}@if (safeLink(r.emailSourceUrl)) { · <a [href]="safeLink(r.emailSourceUrl)" target="_blank" rel="noopener">source ↗</a> }
              @if (w.permissions.editBusiness) { · <button class="link-btn" (click)="startEmail(r.email)">change</button> }</span>
          } @else if (!editingEmail()) {
            <span [class]="'tag ' + tones[r.status]">@if (r.status === 'checking') { <span class="spinner spinner-sm"></span> } {{ r.statusLabel }}</span>
            @if (r.summary) { <span class="note">{{ r.summary }}</span> }
          }
          @if (editingEmail()) {
            <form class="mini-form" (ngSubmit)="saveEmail()">
              <input class="form-control" type="email" name="email" [(ngModel)]="emailInput" placeholder="name@business.com" aria-label="Email address" required />
              <input class="form-control" name="source" [(ngModel)]="sourceInput" placeholder="Where you found it (optional)" aria-label="Where you found it" />
              <div class="actions">
                <button type="button" class="btn btn-ghost btn-sm" (click)="editingEmail.set(false)">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !emailInput.trim()">Save</button>
              </div>
            </form>
          }
        </div>
      </div>

      @if (!r.email && !editingEmail() && w.permissions.editBusiness) {
        <div class="actions">
          @if (r.facebookUrl) { <a class="btn btn-outline btn-sm" [href]="r.facebookUrl" target="_blank" rel="noopener">Open Facebook ↗</a> }
          @else { <a class="btn btn-outline btn-sm" [href]="fbSearch()" target="_blank" rel="noopener">Search Facebook ↗</a> }
          <button class="btn btn-primary btn-sm" (click)="startEmail('')">Add email</button>
          @if (canCheckWebsite() && r.status !== 'checking') { <button class="btn btn-ghost btn-sm" (click)="discover()" [disabled]="busy()">{{ r.checkedAt ? 'Check again' : 'Check website' }}</button> }
          @if (r.status !== 'none_found' && r.status !== 'checking') { <button class="btn btn-ghost btn-sm" (click)="markNoEmail()" [disabled]="busy()">No email found</button> }
        </div>
      }
      @for (c of otherCandidates(); track c.email) {
        <p class="note">Also on {{ host(c.sourceUrl) }}: <strong>{{ c.email }}</strong>@if (!c.sameDomain && !c.freeProvider) { (different domain) }
          @if (w.permissions.editBusiness) { <button class="link-btn" (click)="useCandidate(c.email, c.sourceUrl)">use</button> }</p>
      }

      <div class="row">
        <span class="lbl">Phone</span>
        <div class="val">@if (phone()) { <a [href]="'tel:' + phone()">{{ phone() }}</a> } @else { <span class="muted">—</span> }</div>
      </div>

      <div class="row">
        <span class="lbl">Website</span>
        <div class="val">@if (w.business.website) { <a [href]="w.business.website" target="_blank" rel="noopener">{{ host(w.business.website) }} ↗</a> } @else { <span class="muted">None found</span> }</div>
      </div>

      <div class="row">
        <span class="lbl">Facebook</span>
        <div class="val">
          @if (editingFacebook()) {
            <form class="mini-form" (ngSubmit)="saveFacebook()">
              <input class="form-control" name="fb" [(ngModel)]="facebookInput" placeholder="facebook.com/their-page" aria-label="Facebook page address" />
              <div class="actions">
                <button type="button" class="btn btn-ghost btn-sm" (click)="editingFacebook.set(false)">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy()">Save</button>
              </div>
            </form>
          } @else if (r.facebookUrl) {
            <a [href]="r.facebookUrl" target="_blank" rel="noopener">{{ shortFacebook(r.facebookUrl) }} ↗</a>
            <span class="note">{{ facebookMatch(r.facebookMatch) }}@if (w.permissions.editBusiness) { · <button class="link-btn" (click)="startFacebook(r.facebookUrl)">correct</button> }</span>
          } @else {
            @if (r.facebookSuggestion; as s) {
              <a [href]="s.url" target="_blank" rel="noopener">{{ shortFacebook(s.url) }} ↗</a>
              <span class="note">{{ facebookMatch(s.match) }}@if (w.permissions.editBusiness) { · <button class="link-btn" (click)="useFacebook(s.url)">use this</button> }</span>
            } @else {
              <span class="muted">None saved</span>
            }
            @if (w.permissions.editBusiness) { <button class="link-btn" (click)="startFacebook('')">add link</button> }
          }
        </div>
      </div>
      @if (!r.email) { <p class="hint">Facebook isn’t read automatically. Open their page, check About → Contact info, then add the email.</p> }
      @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
    </section>

    @if (!closed()) {
      <section class="card side-card" aria-label="Reason to reach out">
        <header class="side-head"><h3>Reason to reach out</h3></header>
        @if (observations().length && w.permissions.editBusiness && !reasonInput) {
          @for (o of observations(); track o.key) {
            <div class="obs"><p>{{ o.observation }}</p><button class="btn btn-ghost btn-sm" (click)="useObservation(o)">Use</button></div>
          }
        }
        <textarea class="form-control" rows="3" [(ngModel)]="reasonInput" (ngModelChange)="reasonDirty.set(true)" [disabled]="!w.permissions.editBusiness"
          placeholder="One specific, true reason, e.g. “No website came up on their Google listing — only a Facebook page.”" aria-label="Reason for outreach"></textarea>
        <details class="evidence" [open]="!!evidenceInput">
          <summary>Supporting notes</summary>
          <textarea class="form-control" rows="2" [(ngModel)]="evidenceInput" (ngModelChange)="reasonDirty.set(true)" [disabled]="!w.permissions.editBusiness"
            placeholder="What you checked, and when" aria-label="Supporting notes"></textarea>
        </details>
        <p class="hint">Only claim what was checked — “not listed” isn’t “doesn’t exist”.</p>

        @if (w.outreach.previousEmails.length) {
          <div class="prev"><strong>Already emailed</strong>
            @for (p of w.outreach.previousEmails; track $index) { <span>{{ p.at | date: 'MMM d' }} · {{ p.user?.name || 'Someone' }} · “{{ p.subject || '(no subject)' }}”</span> }
          </div>
        }
        <div class="actions end">
          @if (reasonDirty() && w.permissions.editBusiness) { <button class="btn btn-ghost btn-sm" (click)="saveReason()" [disabled]="busy()">Save</button> }
          <button class="btn btn-primary btn-sm" (click)="startDraft()" [disabled]="!w.business.email || busy() || w.opportunity.doNotContact"
            [title]="w.business.email ? 'Opens an editable draft — nothing is sent until you press Send' : 'Add an email first'">
            <lz-icon name="mail" [size]="13" /> {{ w.opportunity.emailDraft ? 'Continue draft' : 'Draft email' }}
          </button>
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 14px; }
    .side-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .side-head { display: flex; justify-content: space-between; align-items: center; h3 { margin: 0; font-size: .95rem; } }
    .person { margin: 0; font-size: .875rem; }
    .row { display: grid; grid-template-columns: 64px 1fr; gap: 8px; font-size: .8125rem; align-items: baseline; }
    .lbl { color: var(--text-muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
    .val { min-width: 0; overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
    .email { font-weight: 500; }
    .note { font-size: .72rem; color: var(--text-muted); margin: 0; }
    .muted { color: var(--text-muted); }
    .hint { margin: 0; font-size: .72rem; color: var(--text-muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; &.end { justify-content: flex-end; } }
    .mini-form { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .obs { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; font-size: .78rem; color: var(--text-secondary);
      background: var(--bg); border-radius: var(--radius); padding: 6px 8px; p { margin: 0; } }
    .evidence summary { cursor: pointer; font-size: .78rem; color: var(--text-secondary); margin-bottom: 6px; }
    .prev { display: flex; flex-direction: column; gap: 2px; font-size: .75rem; color: var(--warning-text); background: var(--warning-bg); border-radius: var(--radius); padding: 8px 10px; }
    .link-btn { border: none; background: none; padding: 0; cursor: pointer; font: inherit; font-size: .75rem; color: var(--primary-dark); &:hover { text-decoration: underline; } }
  `],
})
export class ContactResearchComponent implements OnChanges, OnDestroy {
  private readonly sales = inject(SalesService);

  readonly ws = input.required<Workspace>();
  readonly changed = output<void>();
  readonly draft = output<void>();
  readonly addContact = output<void>();

  readonly live = signal<ContactResearch | null>(null);
  readonly research = computed(() => this.live() ?? this.ws().business.contactResearch);
  readonly observations = computed<OutreachObservation[]>(() => this.ws().outreach?.observations ?? []);
  readonly otherCandidates = computed(() => {
    const r = this.research();
    return (r.candidates || []).filter((c) => c.email !== r.email).slice(0, 3);
  });
  readonly editingEmail = signal(false);
  readonly editingFacebook = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly reasonDirty = signal(false);
  readonly tones = DISCOVERY_TONES;
  readonly closed = computed(() => ['won', 'lost'].includes(this.ws().opportunity.stage));
  readonly phone = computed(() => {
    const w = this.ws();
    const c = w.contacts.find((x) => x.isPrimary && x.phone && !x.doNotContact) ?? w.contacts.find((x) => x.phone && !x.doNotContact);
    return c?.phone ?? w.business.phone;
  });

  emailInput = '';
  sourceInput = '';
  facebookInput = '';
  reasonInput = '';
  evidenceInput = '';
  private poll: ReturnType<typeof setTimeout> | null = null;
  private pollCount = 0;

  ngOnChanges(): void {
    this.live.set(null);
    if (!this.reasonDirty()) {
      this.reasonInput = this.ws().opportunity.outreachReason ?? '';
      this.evidenceInput = this.ws().opportunity.outreachEvidence ?? '';
    }
    if (this.ws().business.contactResearch.status === 'checking') this.startPolling();
  }

  ngOnDestroy(): void {
    if (this.poll) clearTimeout(this.poll);
  }

  private get id(): string { return this.ws().opportunity.id; }

  canCheckWebsite(): boolean {
    const site = this.ws().business.website;
    return Boolean(site) && !/facebook\.com|instagram\.com/i.test(site || '');
  }

  fbSearch(): string {
    const b = this.ws().business;
    return facebookSearchUrl(b.name, [b.city, b.state].filter(Boolean).join(' '));
  }

  sourceLabel(r: ContactResearch): string {
    if (r.emailSource === 'manual') return 'added by hand';
    if (r.emailSource === 'verified') return 'verified';
    if (r.emailSource === 'discovered' || r.emailSource === 'website') return `found on their website${r.checkedAt ? ` · ${new Date(r.checkedAt).toLocaleDateString()}` : ''}`;
    return r.emailSource ? `from ${r.emailSource.replace('_', ' ')}` : '';
  }

  facebookMatch(match: string | null): string {
    return match ? FACEBOOK_MATCH[match] ?? match : '';
  }

  shortFacebook(url: string): string {
    return url.replace(/^https?:\/\/(www\.)?/, '');
  }

  host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  /** Only http(s) links are rendered as links (a manual "source" may be free text). */
  safeLink(url: string | null): string | null {
    return url && /^https?:\/\//i.test(url) ? url : null;
  }

  startEmail(current: string): void {
    this.emailInput = current;
    this.sourceInput = this.research().facebookUrl ?? '';
    this.editingEmail.set(true);
  }

  startFacebook(current: string): void {
    this.facebookInput = current;
    this.editingFacebook.set(true);
  }

  private update(body: Parameters<SalesService['updateResearch']>[1], after?: () => void): void {
    this.busy.set(true);
    this.error.set('');
    this.sales.updateResearch(this.id, body).subscribe({
      next: (research) => {
        this.busy.set(false);
        this.live.set(research);
        after?.();
        this.changed.emit();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — try again.'); },
    });
  }

  saveEmail(): void {
    this.update({ email: this.emailInput.trim(), sourceUrl: this.sourceInput.trim() || null }, () => this.editingEmail.set(false));
  }

  useCandidate(email: string, sourceUrl: string): void {
    this.update({ email, sourceUrl });
  }

  saveFacebook(): void {
    this.update({ facebookUrl: this.facebookInput.trim() || null }, () => this.editingFacebook.set(false));
  }

  useFacebook(url: string): void {
    this.update({ facebookUrl: url });
  }

  markNoEmail(): void {
    this.update({ markNoEmail: true });
  }

  discover(): void {
    this.busy.set(true);
    this.error.set('');
    this.sales.discoverEmail(this.id, true).subscribe({
      next: (research) => {
        this.busy.set(false);
        this.live.set(research);
        if (research.status === 'checking') this.startPolling();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Couldn’t start the check — try again.'); },
    });
  }

  private startPolling(): void {
    if (this.poll) return;
    this.pollCount = 0;
    const tick = () => {
      this.poll = null;
      this.pollCount += 1;
      this.sales.contactStatus([this.id]).subscribe({
        next: (status) => {
          const current = status[this.id];
          if (current) this.live.set(current);
          if (current?.status === 'checking' && this.pollCount < 40) this.poll = setTimeout(tick, 3000);
          else if (current && current.status !== 'checking') this.changed.emit();
        },
        error: () => { if (this.pollCount < 40) this.poll = setTimeout(tick, 6000); },
      });
    };
    this.poll = setTimeout(tick, 2500);
  }

  useObservation(o: OutreachObservation): void {
    this.reasonInput = o.reason;
    this.evidenceInput = o.evidence;
    this.reasonDirty.set(true);
  }

  saveReason(then?: () => void): void {
    this.busy.set(true);
    this.error.set('');
    this.sales.updateOutreachReason(this.id, { reason: this.reasonInput, evidence: this.evidenceInput }).subscribe({
      next: () => {
        this.busy.set(false);
        this.reasonDirty.set(false);
        if (then) then(); else this.changed.emit();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — try again.'); },
    });
  }

  /** Saves an edited reason first so the draft uses it. */
  startDraft(): void {
    if (this.reasonDirty()) this.saveReason(() => this.draft.emit());
    else this.draft.emit();
  }
}
