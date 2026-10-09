import { Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { SalesService, actionKey } from '../../../core/services/sales.service';
import { SettingsService } from '../../../core/services/settings.service';
import { IntroDraft, MessageTemplate, PreviousEmail, TEMPLATE_CATEGORIES, UserRef, Workspace } from '../../../core/models/sales.model';
import { suggestDate, toLocalInput } from '../shared/sales-format';

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;
const BILLING_WORDS: Record<string, string> = { one_time: ' one-time', monthly: '/month', yearly: '/year' };

function price(cents: number | null, billing: string | null): string {
  if (cents === null || cents === undefined) return '';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  return ` — ${amount}${BILLING_WORDS[billing ?? ''] ?? ''}`;
}

/**
 * Email / text composer (ADR 0011). Sends through Leadzaro only when the
 * channel is connected and the salesperson presses Send; otherwise it
 * opens their own app and they confirm it was sent. Unfilled
 * {{placeholders}} block sending, and the draft survives a failure or a
 * closed dialog.
 */
@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="composer">
      @if (channel() === 'email' && ws().channels.email.testRedirect) {
        <div class="alert alert-info">Test mode: emails go to {{ ws().channels.email.testRedirect }}, not to the lead.</div>
      }
      @if (intro()) {
        @if (ws().outreach.previousEmails.length) {
          <div class="alert alert-warning prev"><strong>This business was already emailed</strong>
            @for (p of ws().outreach.previousEmails; track $index) { <span>{{ p.at | date: 'MMM d, y' }} · {{ p.user?.name || 'Someone' }} · “{{ p.subject || '(no subject)' }}”</span> }
          </div>
        }
        @if (drafting()) { <p class="form-hint"><span class="spinner spinner-sm"></span> Writing a draft from the facts on file…</p> }
        @if (draftInfo()) { <p class="form-hint">{{ draftInfo() }}</p> }
        @for (w of warnings(); track w) { <div class="alert alert-warning">{{ w }}</div> }
      }
      <div class="row2">
        <div class="form-group">
          <label class="form-label" for="cm-template">Template</label>
          <select id="cm-template" class="form-select" [ngModel]="templateId" (ngModelChange)="applyTemplate($event)">
            <option value="">Write my own</option>
            @for (group of groupedTemplates(); track group.category) {
              <optgroup [label]="group.label">
                @for (t of group.items; track t.id) { <option [value]="t.id">{{ t.name }}{{ t.scope === 'personal' ? ' (mine)' : '' }}</option> }
              </optgroup>
            }
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="cm-to">To</label>
          <select id="cm-to" class="form-select" [(ngModel)]="recipient" (ngModelChange)="saveDraft()">
            @for (r of recipients(); track r.value) { <option [value]="r.value">{{ r.label }}</option> }
          </select>
        </div>
      </div>
      @if (!recipients().length) {
        <div class="alert alert-warning">There’s no {{ channel() === 'email' ? 'email address' : 'phone number' }} for this lead yet. Add one in Details first.</div>
      }

      @if (channel() === 'email') {
        <div class="form-group">
          <label class="form-label" for="cm-subject">Subject</label>
          <input id="cm-subject" class="form-control" [(ngModel)]="subject" (ngModelChange)="saveDraft()" maxlength="300" />
        </div>
      }
      <div class="form-group">
        <label class="form-label" for="cm-body">Message</label>
        <textarea #bodyEl id="cm-body" class="form-control" [rows]="channel() === 'email' ? 10 : 5" [(ngModel)]="body" (ngModelChange)="saveDraft()"></textarea>
        <div class="under">
          @if (channel() === 'sms') { <span class="form-hint">{{ body.length }} / 1600 characters</span> } @else { <span></span> }
          <span class="inserts">
            @if (kitItems().length) {
              <select class="form-select kit" aria-label="Insert from the Sales kit" [(ngModel)]="kitChoice" (ngModelChange)="insertKit($event)">
                <option value="">Insert from Sales kit…</option>
                @for (item of kitItems(); track item.key) { <option [value]="item.key">{{ item.label }}</option> }
              </select>
            }
            @if (openLink()) { <button type="button" class="btn btn-ghost btn-sm" (click)="insertLink()">Insert payment link</button> }
          </span>
        </div>
      </div>

      @if (unresolved().length) {
        <div class="alert alert-warning">
          Fill in {{ unresolved().join(', ') }} before sending — Leadzaro only fills in facts it actually has.
        </div>
      }

      @if (intro() && evidence().length) {
        <details class="evidence" open>
          <summary>What this draft is based on</summary>
          <dl>
            @for (e of evidence(); track e.label) { <dt>{{ e.label }}</dt><dd>{{ e.value }}@if (e.source) { <span class="src"> — {{ e.source }}</span> }</dd> }
          </dl>
          <p class="form-hint">Edit anything that isn’t right, and don’t add claims you haven’t checked.</p>
        </details>
      }

      <details class="next">
        <summary>Schedule the follow-up ({{ nextLabel() }})</summary>
        <div class="row2">
          <input class="form-control" type="datetime-local" [(ngModel)]="nextAt" aria-label="Follow-up date" />
          <input class="form-control" [(ngModel)]="nextNote" placeholder="What to do next (optional)" aria-label="Follow-up note" />
        </div>
      </details>

      @if (owner()) {
        <div class="alert alert-warning owner" role="alert">
          <span><strong>{{ owner()!.name }}</strong> owns this lead. Check with them so you don’t both contact the same business.</span>
          <button type="button" class="btn btn-outline btn-sm" (click)="confirmOwner = true; ownerRetry()">{{ connected() && canSend() ? 'Send anyway' : 'Record anyway' }}</button>
        </div>
      }
      @if (repeat(); as rp) {
        <div class="alert alert-warning owner" role="alert">
          <span>{{ rp.message }}
            @for (p of rp.previous; track $index) { <br />{{ p.at | date: 'MMM d, y' }} · {{ p.user?.name || 'Someone' }} · “{{ p.subject || '(no subject)' }}” }</span>
          <button type="button" class="btn btn-outline btn-sm" (click)="confirmRecent = true; send()">Send anyway</button>
        </div>
      }
      @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
      @if (sentNotice()) { <div class="alert alert-success" role="status">{{ sentNotice() }}</div> }

      <div class="actions">
        <span class="how">
          @if (connected()) { Sends from Leadzaro {{ channel() === 'email' ? 'as ' + (ws().channels.email.from || 'your sales address') + ', replies to you' : 'from ' + (ws().channels.sms.from || 'the business number') }} }
          @else { {{ channel() === 'email' ? 'Email' : 'Texting' }} isn’t connected in Leadzaro — open it in your own app, then confirm. }
        </span>
        <button type="button" class="btn btn-ghost" (click)="closed.emit()">Close</button>
        @if (intro()) {
          <button type="button" class="btn btn-ghost" (click)="generateDraft()" [disabled]="drafting()" title="Replaces the text with a fresh draft from the facts on file">Start over</button>
          <button type="button" class="btn btn-outline" (click)="saveServerDraft()" [disabled]="savingDraft() || !body.trim()">{{ savingDraft() ? 'Saving…' : 'Save draft' }}</button>
        }
        @if (connected() && canSend()) {
          <button type="button" class="btn btn-primary" (click)="send()" [disabled]="sending() || !ready()">{{ sending() ? 'Sending…' : 'Send' }}</button>
        } @else {
          <a class="btn btn-outline" [class.disabled]="!ready()" [attr.href]="ready() ? externalHref() : null" (click)="openedExternally.set(true)" target="_blank" rel="noopener">Open in my {{ channel() === 'email' ? 'email app' : 'messages' }}</a>
          <button type="button" class="btn btn-primary" (click)="confirmExternal()" [disabled]="!openedExternally() || sending()">I sent it</button>
        }
      </div>
    </div>
  `,
  styles: [`
    .composer { display: flex; flex-direction: column; gap: 12px; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; @media (max-width: 560px) { grid-template-columns: 1fr; } }
    .under { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
    .next summary { cursor: pointer; font-size: .8125rem; color: var(--text-secondary); margin-bottom: 8px; }
    .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .how { flex: 1; min-width: 200px; font-size: .75rem; color: var(--text-muted); }
    a.disabled { opacity: .5; pointer-events: none; }
    .inserts { display: inline-flex; gap: 6px; align-items: center; }
    .kit { width: auto; max-width: 260px; padding-top: 5px; padding-bottom: 5px; font-size: .8rem; }
    .prev { display: flex; flex-direction: column; gap: 2px; font-size: .8rem; }
    .evidence { font-size: .8rem; summary { cursor: pointer; color: var(--text-secondary); }
      dl { display: grid; grid-template-columns: 140px 1fr; gap: 4px 10px; margin: 8px 0 4px; } dt { color: var(--text-muted); } dd { margin: 0; overflow-wrap: anywhere; } .src { color: var(--text-muted); } }
    .owner { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  `],
})
export class ComposerComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly settings = inject(SettingsService);

  readonly ws = input.required<Workspace>();
  readonly channel = input<'email' | 'sms'>('email');
  readonly category = input<string | null>(null);
  /** Introduction mode (ADR 0014): drafted from facts on file, with the evidence shown. */
  readonly intro = input(false);
  readonly sent = output<Workspace | null>();
  readonly closed = output<void>();

  readonly templates = signal<MessageTemplate[]>([]);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly sentNotice = signal('');
  readonly openedExternally = signal(false);
  readonly owner = signal<UserRef | null>(null);
  private readonly bodyEl = viewChild<ElementRef<HTMLTextAreaElement>>('bodyEl');
  confirmOwner = false;
  confirmRecent = false;
  readonly drafting = signal(false);
  readonly savingDraft = signal(false);
  readonly draftInfo = signal('');
  readonly evidence = signal<IntroDraft['evidence']>([]);
  readonly warnings = signal<string[]>([]);
  readonly repeat = signal<{ message: string; previous: PreviousEmail[] } | null>(null);
  kitChoice = '';
  private lastAction: 'send' | 'external' = 'send';
  private readonly bodySignal = signal('');
  private readonly subjectSignal = signal('');
  private key = actionKey();

  templateId = '';
  recipient = '';
  nextAt = toLocalInput(suggestDate(this.settings.mine()?.effective.defaultFollowUpDays ?? 2));
  nextNote = '';

  get body(): string { return this.bodySignal(); }
  set body(value: string) { this.bodySignal.set(value); }
  get subject(): string { return this.subjectSignal(); }
  set subject(value: string) { this.subjectSignal.set(value); }

  readonly connected = computed(() => (this.channel() === 'email' ? this.ws().channels.email.connected : this.ws().channels.sms.connected));
  readonly canSend = computed(() => this.ws().permissions.send);
  readonly unresolved = computed(() => {
    const found = new Set<string>();
    for (const text of [this.subjectSignal(), this.bodySignal()]) for (const m of text.matchAll(PLACEHOLDER)) found.add(`{{${m[1]}}}`);
    return [...found];
  });
  readonly ready = computed(() => Boolean(this.bodySignal().trim()) && !this.unresolved().length && (this.channel() === 'sms' || Boolean(this.subjectSignal().trim())) && Boolean(this.recipients().length));
  readonly openLink = computed(() => this.ws().paymentRequests.find((r) => r.isOpen && r.url) ?? null);
  readonly recipients = computed(() => {
    const ws = this.ws();
    const list: { value: string; label: string; contactId: string | null }[] = [];
    const field = this.channel() === 'email' ? 'email' : 'phone';
    for (const c of ws.contacts) {
      const value = c[field];
      if (value && !c.doNotContact) list.push({ value, label: `${c.name} — ${value}`, contactId: c.id });
    }
    const businessValue = ws.business[field];
    if (businessValue && !list.some((r) => r.value === businessValue)) list.push({ value: businessValue, label: `${ws.business.name} — ${businessValue}`, contactId: null });
    return list;
  });
  readonly groupedTemplates = computed(() => {
    const groups = new Map<string, MessageTemplate[]>();
    for (const t of this.templates()) {
      if (!groups.has(t.category)) groups.set(t.category, []);
      groups.get(t.category)!.push(t);
    }
    return [...groups.entries()].map(([category, items]) => ({ category, label: TEMPLATE_CATEGORIES[category] ?? category, items }));
  });

  /** The approved pitch, services and prices, portfolio and objection answers (Settings → Sales kit & goals). */
  readonly kitItems = computed(() => {
    const kit = this.ws().salesKit;
    const items: { key: string; label: string; text: string }[] = [];
    if (kit?.pitch) items.push({ key: 'pitch', label: 'Our pitch', text: kit.pitch });
    if (kit?.services?.length) {
      items.push({ key: 'services', label: 'All services & prices', text: kit.services.map((sv) => `• ${sv.name}${price(sv.priceCents, sv.billing)}`).join('\n') });
      kit.services.forEach((sv, i) => items.push({ key: `svc-${i}`, label: `Service: ${sv.name}`, text: `${sv.name}${price(sv.priceCents, sv.billing)}${sv.description ? `\n${sv.description}` : ''}` }));
    }
    (kit?.portfolio || []).forEach((pf, i) => items.push({ key: `pf-${i}`, label: `Portfolio: ${pf.label}`, text: `${pf.label}: ${pf.url}` }));
    (kit?.objections || []).forEach((ob, i) => items.push({ key: `ob-${i}`, label: `Answer: ${ob.objection}`, text: ob.response }));
    return items;
  });

  private get draftKey(): string { return `lz.draft.${this.ws().opportunity.id}.${this.channel()}`; }

  ngOnInit(): void {
    this.recipient = this.recipients()[0]?.value ?? '';
    if (this.intro()) {
      this.sales.templates({ channel: 'email' }).subscribe({ next: (list) => this.templates.set(list), error: () => undefined });
      const saved = this.ws().opportunity.emailDraft;
      if (saved?.body) {
        this.subject = saved.subject;
        this.body = saved.body;
        if (saved.to && this.recipients().some((r) => r.value === saved.to)) this.recipient = saved.to;
        this.draftInfo.set(`Saved draft by ${saved.savedBy?.name || 'a teammate'} · ${new Date(saved.savedAt).toLocaleString()} — not sent.`);
      } else if (!this.restoreDraft()) {
        this.generateDraft();
      }
      return;
    }
    this.sales.templates({ channel: this.channel() }).subscribe({
      next: (list) => {
        this.templates.set(list);
        if (!this.restoreDraft()) {
          const match = this.category() ? list.find((t) => t.category === this.category()) : null;
          if (match) this.applyTemplate(match.id);
          else this.startWithSignature();
        }
      },
      error: () => this.restoreDraft(),
    });
  }

  /** A blank email starts with the signature from Settings → Sales preferences. */
  private startWithSignature(): void {
    const signature = this.settings.mine()?.effective.signature;
    if (this.channel() === 'email' && signature && !this.body) this.body = `\n\n${signature}`;
  }

  applyTemplate(id: string): void {
    this.templateId = id;
    if (!id) return;
    const contactId = this.recipients().find((r) => r.value === this.recipient)?.contactId ?? null;
    this.sales.render(this.ws().opportunity.id, { templateId: id, contactId, paymentRequestId: this.openLink()?.id ?? null }).subscribe({
      next: (rendered) => {
        this.body = rendered.body;
        if (this.channel() === 'email') this.subject = rendered.subject ?? '';
        this.saveDraft();
      },
      error: (err) => this.error.set(err.error?.message || 'The template could not be loaded.'),
    });
  }

  /** Inserts a Sales kit item at the cursor (or at the end), still editable before sending. */
  insertKit(key: string): void {
    const item = this.kitItems().find((i) => i.key === key);
    if (!item) return;
    const el = this.bodyEl()?.nativeElement;
    const at = el && typeof el.selectionStart === 'number' ? el.selectionStart : this.body.length;
    const before = this.body.slice(0, at);
    const after = this.body.slice(at);
    const pad = before && !before.endsWith('\n') ? '\n' : '';
    this.body = `${before}${pad}${item.text}\n${after}`;
    this.saveDraft();
    setTimeout(() => { this.kitChoice = ''; });
  }

  /** A fresh, editable draft built only from facts on file. */
  generateDraft(): void {
    this.drafting.set(true);
    this.error.set('');
    const contactId = this.recipients().find((r) => r.value === this.recipient)?.contactId ?? null;
    this.sales.draftIntro(this.ws().opportunity.id, contactId).subscribe({
      next: (draft) => {
        this.drafting.set(false);
        this.subject = draft.subject;
        this.body = draft.body;
        this.evidence.set(draft.evidence);
        this.warnings.set(draft.warnings);
        this.draftInfo.set('');
        this.saveDraft();
      },
      error: (err) => { this.drafting.set(false); this.error.set(err.error?.message || 'The draft couldn’t be prepared — write it yourself or try again.'); },
    });
  }

  /** Keeps the draft on the lead so a teammate sees it. Never sends. */
  saveServerDraft(): void {
    this.savingDraft.set(true);
    this.sales.saveEmailDraft(this.ws().opportunity.id, { subject: this.subject, body: this.body, to: this.recipient }).subscribe({
      next: (res) => {
        this.savingDraft.set(false);
        if (res.emailDraft) this.draftInfo.set(`Draft saved ${new Date(res.emailDraft.savedAt).toLocaleTimeString()} — not sent.`);
      },
      error: (err) => { this.savingDraft.set(false); this.error.set(err.error?.message || 'The draft wasn’t saved.'); },
    });
  }

  ownerRetry(): void {
    if (this.lastAction === 'send') this.send();
    else this.confirmExternal();
  }

  private ownerBlocked(err: { status?: number; error?: { code?: string; owner?: UserRef } }): boolean {
    if (err.status === 409 && err.error?.code === 'owned_by_other') {
      this.owner.set(err.error.owner || { id: '', name: 'Someone else' });
      return true;
    }
    return false;
  }

  insertLink(): void {
    const url = this.openLink()?.url;
    if (!url) return;
    this.body = this.body.includes('{{payment_link}}') ? this.body.replace(/\{\{\s*payment_link\s*\}\}/g, url) : `${this.body.trimEnd()}\n\n${url}`;
    this.saveDraft();
  }

  nextLabel(): string {
    return this.nextAt ? new Date(this.nextAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'none';
  }

  externalHref(): string {
    if (this.channel() === 'email') {
      return `mailto:${encodeURIComponent(this.recipient)}?subject=${encodeURIComponent(this.subject)}&body=${encodeURIComponent(this.body)}`;
    }
    return `sms:${this.recipient}?&body=${encodeURIComponent(this.body)}`;
  }

  send(): void {
    if (!this.ready()) return;
    this.lastAction = 'send';
    this.sending.set(true);
    this.error.set('');
    this.owner.set(null);
    this.repeat.set(null);
    const contactId = this.recipients().find((r) => r.value === this.recipient)?.contactId ?? null;
    this.sales.sendMessage(this.ws().opportunity.id, {
      channel: this.channel(),
      to: this.recipient,
      contactId,
      subject: this.subject,
      body: this.body,
      templateId: this.templateId || null,
      paymentRequestId: this.body.includes(this.openLink()?.url ?? '\u0000') ? this.openLink()?.id : null,
      idempotencyKey: this.key,
      confirmOwner: this.confirmOwner,
      confirmRecent: this.confirmRecent,
      intent: this.intro() ? 'intro' : null,
      nextAction: this.nextAt ? { at: new Date(this.nextAt).toISOString(), type: 'follow_up', note: this.nextNote || null } : null,
    }).subscribe({
      next: () => {
        this.sending.set(false);
        this.key = actionKey();
        this.clearDraft();
        this.sentNotice.set('Sent.');
        this.sent.emit(null);
      },
      error: (err) => {
        this.sending.set(false);
        if (this.ownerBlocked(err)) return;
        if (err.status === 409 && ['previous_outreach', 'duplicate_send'].includes(err.error?.code)) {
          this.repeat.set({ message: err.error.message, previous: err.error.previous || [] });
          return;
        }
        // A retry of the same message after a failure is a new attempt.
        this.key = actionKey();
        this.error.set(err.error?.message || 'Not sent. Your message is saved here — try again.');
      },
    });
  }

  /** Records a message sent from the salesperson's own app (not performed by Leadzaro). */
  confirmExternal(): void {
    this.lastAction = 'external';
    this.owner.set(null);
    this.sending.set(true);
    this.sales.logOutcome(this.ws().opportunity.id, {
      channel: this.channel(),
      outcome: 'sent',
      origin: 'external',
      contactId: this.recipients().find((r) => r.value === this.recipient)?.contactId ?? null,
      note: this.channel() === 'email' ? `${this.subject}\n\n${this.body}` : this.body,
      nextAction: this.nextAt ? { at: new Date(this.nextAt).toISOString(), type: 'follow_up', note: this.nextNote || null } : null,
      idempotencyKey: this.key,
      confirmOwner: this.confirmOwner,
    }).subscribe({
      next: (workspace) => {
        this.sending.set(false);
        this.key = actionKey();
        this.clearDraft();
        const link = this.openLink();
        if (link?.url && this.body.includes(link.url) && link.status === 'created') {
          this.sales.markSent(link.id, this.channel()).subscribe({ next: () => this.sent.emit(null), error: () => this.sent.emit(workspace) });
        } else this.sent.emit(workspace);
      },
      error: (err) => { this.sending.set(false); if (!this.ownerBlocked(err)) this.error.set(err.error?.message || 'Not saved — try again.'); },
    });
  }

  saveDraft(): void {
    try {
      localStorage.setItem(this.draftKey, JSON.stringify({ subject: this.subject, body: this.body, recipient: this.recipient, templateId: this.templateId }));
    } catch { /* storage unavailable */ }
  }

  private restoreDraft(): boolean {
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      if (!draft.body) return false;
      this.subject = draft.subject ?? '';
      this.body = draft.body;
      this.templateId = draft.templateId ?? '';
      if (draft.recipient && this.recipients().some((r) => r.value === draft.recipient)) this.recipient = draft.recipient;
      return true;
    } catch {
      return false;
    }
  }

  private clearDraft(): void {
    try { localStorage.removeItem(this.draftKey); } catch { /* ignore */ }
  }
}
