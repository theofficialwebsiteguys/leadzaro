import { PhoneInputDirective, PhonePipe, ZipInputDirective } from '../../../shared/forms/formatted-inputs';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { SalesService, actionKey } from '../../../core/services/sales.service';
import { SettingsService } from '../../../core/services/settings.service';
import { CrmService } from '../../../core/services/crm.service';
import { WorkQueueService } from '../../../core/services/work-queue.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  Activity, CHANNEL_LABELS, Contact, LeadNote, NEXT_ACTION_LABELS, QualificationKey, SALES_STAGES, STAGE_LABELS, SalesStage, StageGuide, UserRef, Workspace,
} from '../../../core/models/sales.model';
import { Enrichment, WebsiteAudit } from '../../../core/models/crm.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { OutcomeFormComponent } from './outcome-form.component';
import { ComposerComponent } from './composer.component';
import { OffersComponent } from './offers.component';
import { HandoffComponent } from './handoff.component';
import {
  MoneyPipe, RelativeDayPipe, isOverdue, nextActionLabel, sourceLabel, suggestDate, toLocalInput,
} from '../shared/sales-format';

type Tab = 'activity' | 'details' | 'offers' | 'handoff' | 'files';
const PROGRESS: SalesStage[] = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'won'];
const EMPTY_QUAL: Record<QualificationKey, string> = {
  qualNeed: '', qualService: '', qualDecisionMaker: '', qualTiming: '', qualBudget: '',
};
interface TimelineEntry { at: string; activity?: Activity; note?: LeadNote }

/**
 * The lead workspace (ADR 0011): one page per deal, reachable from
 * everywhere. Identity, contact actions, owner, stage, last and next
 * interaction and payment state are always visible; the recommended next
 * step sits on top; the queue bar moves to the next lead.
 */
@Component({
  selector: 'app-lead-workspace',
  standalone: true,
  imports: [
    RouterLink, FormsModule, DatePipe, IconComponent, DialogComponent, OutcomeFormComponent, ComposerComponent, OffersComponent, HandoffComponent,
    MoneyPipe, RelativeDayPipe, PhoneInputDirective, ZipInputDirective, PhonePipe,
  ],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly crm = inject(CrmService);
  private readonly settings = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly queue = inject(WorkQueueService);
  readonly auth = inject(AuthService);

  readonly stages = SALES_STAGES;
  readonly stageLabels = STAGE_LABELS;
  readonly channelLabels = CHANNEL_LABELS;
  readonly nextTypes = Object.entries(NEXT_ACTION_LABELS).map(([key, label]) => ({ key, label }));
  readonly nextActionLabel = nextActionLabel;
  readonly isOverdue = isOverdue;
  readonly sourceLabel = sourceLabel;

  readonly ws = signal<Workspace | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal<Tab>('activity');
  readonly queueMode = signal(false);
  readonly menuOpen = signal(false);
  readonly members = signal<UserRef[]>([]);
  readonly busy = signal(false);

  // Dialogs
  readonly outcomeDialog = signal<{ channel: string; activityId: string | null } | null>(null);
  readonly composerDialog = signal<{ channel: 'email' | 'sms'; category: string | null } | null>(null);
  readonly stageDialog = signal(false);
  readonly dncDialog = signal(false);
  readonly dealDialog = signal(false);
  readonly nextDialog = signal(false);
  readonly replyDialog = signal(false);
  readonly kitOpen = signal(false);
  stageChoice = '';
  lostReason = '';
  stageReason = '';
  revisitAt = '';
  /** Details a manual stage move still needs (ADR 0013), answered right in the dialog. */
  readonly stageMissing = signal<{ key: string; label: string }[]>([]);
  stageQual: Record<QualificationKey, string> = { ...EMPTY_QUAL };
  // Qualification card
  readonly qualEditing = signal(false);
  qualForm: Record<QualificationKey, string> = { ...EMPTY_QUAL };
  /** Set when someone else owns the lead and a call needs confirming. */
  readonly callOwner = signal<UserRef | null>(null);
  dncReason = '';
  newDealTitle = '';
  nextAt = '';
  nextType = 'follow_up';
  nextNote = '';
  replyChannel = 'email';
  replyNote = '';
  private replyKey = actionKey();

  // Notes
  noteText = '';
  readonly savingNote = signal(false);

  // Details editing
  readonly editingBusiness = signal(false);
  business: Record<string, string> = {};
  readonly contactForm = signal<{ id: string | null } | null>(null);
  contact = { name: '', title: '', email: '', phone: '' };
  deal = { title: '', value: '' };
  readonly editingDeal = signal(false);

  // Research
  readonly audit = signal<WebsiteAudit | null>(null);
  readonly enrichment = signal<Enrichment | null>(null);
  readonly researchBusy = signal<string | null>(null);

  private id = '';

  readonly timeline = computed<TimelineEntry[]>(() => {
    const w = this.ws();
    if (!w) return [];
    const entries: TimelineEntry[] = [
      ...w.activities.map((activity) => ({ at: activity.occurredAt || activity.createdAt, activity })),
      ...w.notes.map((note) => ({ at: note.createdAt, note })),
    ];
    return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  });

  readonly phone = computed(() => {
    const w = this.ws();
    if (!w) return null;
    const c = w.contacts.find((x) => x.isPrimary && x.phone && !x.doNotContact) ?? w.contacts.find((x) => x.phone && !x.doNotContact);
    return c?.phone ?? w.business.phone;
  });
  readonly email = computed(() => {
    const w = this.ws();
    if (!w) return null;
    const c = w.contacts.find((x) => x.isPrimary && x.email && !x.doNotContact) ?? w.contacts.find((x) => x.email && !x.doNotContact);
    return c?.email ?? w.business.email;
  });
  /** The main path New → Won, with where this deal is. Lost and Nurture sit outside it. */
  readonly progress = computed(() => {
    const w = this.ws();
    if (!w) return [];
    const at = PROGRESS.indexOf(w.opportunity.stage);
    return PROGRESS.map((stage, i) => ({
      stage, label: STAGE_LABELS[stage], state: at < 0 ? 'off' : i < at ? 'done' : i === at ? 'current' : 'todo',
    }));
  });
  readonly qualFilled = computed(() => {
    const q = this.ws()?.opportunity.qualification;
    return q ? Object.values(q).filter((v) => Boolean(v && String(v).trim())).length : 0;
  });
  readonly missingQual = computed(() => this.stageMissing().filter((m): m is { key: QualificationKey; label: string } => this.isQualKey(m.key)));
  readonly missingOther = computed(() => this.stageMissing().filter((m) => !this.isQualKey(m.key)));
  /** The recommendation's button, when it can be done from here. */
  readonly recButton = computed(() => {
    const w = this.ws();
    if (!w) return null;
    const action = w.recommendation.action;
    if (action) {
      const contact = ['call', 'email', 'sms'].includes(action.type);
      if (contact && (!this.canContact() || (!this.phone() && !this.email()))) return null;
      if (action.type === 'log' && !w.permissions.logOutreach) return null;
      return action.label;
    }
    return this.primaryActionLabel() && this.canContact() ? this.primaryActionLabel() : null;
  });
  readonly ownerIsMe = computed(() => {
    const w = this.ws();
    return Boolean(w?.opportunity.assignedTo && w.opportunity.assignedTo.id === this.auth.currentUser()?.id);
  });

  readonly queuePosition = computed(() => {
    const w = this.ws();
    return w ? this.queue.positionOf(w.opportunity.id) : -1;
  });
  readonly isClosed = computed(() => ['won', 'lost'].includes(this.ws()?.opportunity.stage ?? ''));
  readonly canContact = computed(() => {
    const w = this.ws();
    return Boolean(w && !w.opportunity.doNotContact && !w.opportunity.archivedAt);
  });
  readonly primaryActionLabel = computed(() => {
    const key = this.ws()?.recommendation.key;
    const labels: Record<string, string> = {
      add_contact: 'Add contact info', first_contact: this.phone() ? 'Call now' : 'Write first email', reply: 'Reply', schedule: 'Schedule follow-up',
      overdue: 'Do it now', scheduled: 'Log an update', create_payment_link: 'Create payment link', prepare_offer: 'Log meeting or offer', payment_problem: 'Open payments',
      send_payment_link: 'Send payment link', payment_follow_up: 'Follow up', handoff: 'Open handoff', retry_handoff: 'Retry setup',
    };
    return key ? labels[key] ?? null : null;
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.id = params.get('id')!;
      this.queueMode.set(this.route.snapshot.queryParamMap.get('queue') === '1' && this.queue.positionOf(this.id) >= 0);
      if (this.queueMode()) this.queue.focus(this.id);
      this.tab.set((this.route.snapshot.queryParamMap.get('tab') as Tab) || 'activity');
      this.audit.set(null);
      this.enrichment.set(null);
      this.load();
    });
    this.sales.team().subscribe({ next: (r) => this.members.set(r.members), error: () => undefined });
    this.settings.ensureMe();
  }

  @HostListener('document:click')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeKit(): void {
    this.kitOpen.set(false);
  }

  load(): void {
    this.loading.set(true);
    this.sales.workspace(this.id).subscribe({
      next: (w) => { this.ws.set(w); this.loading.set(false); this.error.set(''); },
      error: (err) => {
        if (err.status === 404) {
          // Older links pointed at a saved-lead id.
          this.sales.resolveSavedLead(this.id).subscribe({
            next: (res) => this.router.navigate(['/app/leads', res.opportunityId], { replaceUrl: true }),
            error: () => { this.loading.set(false); this.error.set('This lead doesn’t exist or you don’t have access to it.'); },
          });
          return;
        }
        this.loading.set(false);
        this.error.set(err.error?.message || 'This lead could not be loaded.');
      },
    });
  }

  private apply(request: Observable<Workspace>, success?: string, after?: () => void): void {
    this.busy.set(true);
    request.subscribe({
      next: (w) => { this.ws.set(w); this.busy.set(false); if (success) this.notice.set(success); after?.(); },
      error: (err) => { this.busy.set(false); this.notice.set(''); this.error.set(err.error?.message || 'That didn’t work — nothing was changed.'); setTimeout(() => this.error.set(''), 6000); },
    });
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.router.navigate([], { queryParams: { tab: tab === 'activity' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ---- contact actions
  call(confirmOwner = false): void {
    const w = this.ws();
    if (!w || !this.phone()) return;
    if (w.channels.call.connected && w.permissions.send) {
      const primary = w.contacts.find((c) => c.phone === this.phone()) ?? null;
      this.callOwner.set(null);
      this.sales.startCall(w.opportunity.id, {
        to: this.phone(), contactId: primary?.id ?? null, idempotencyKey: actionKey(), confirmOwner,
      }).subscribe({
        next: (res) => this.outcomeDialog.set({ channel: 'call', activityId: res.activity.id }),
        error: (err) => {
          if (err.status === 409 && err.error?.code === 'owned_by_other') {
            this.callOwner.set(err.error.owner || { id: '', name: 'Someone else' });
            return;
          }
          this.error.set(err.error?.message || 'The call could not be started.');
          setTimeout(() => this.error.set(''), 6000);
        },
      });
      return;
    }
    // Not connected: the phone app opens via the tel: link; record the outcome afterwards.
    setTimeout(() => this.outcomeDialog.set({ channel: 'call', activityId: null }), 400);
  }

  compose(channel: 'email' | 'sms', category: string | null = null): void {
    this.composerDialog.set({ channel, category });
  }

  logOutcome(channel = 'call'): void {
    this.outcomeDialog.set({ channel, activityId: null });
  }

  runRecommendation(): void {
    const w = this.ws();
    if (!w) return;
    const action = w.recommendation.action?.type;
    const category = ({
      first_contact: 'intro', overdue: 'follow_up', payment_follow_up: 'payment_reminder', send_payment_link: 'payment_reminder', stalled: 'follow_up',
    } as Record<string, string>)[w.recommendation.key] ?? null;
    switch (action) {
      case 'call': if (this.phone()) this.callViaLink(); else this.compose('email', category); return;
      case 'email': this.compose('email', w.recommendation.key === 'reply' ? null : category); return;
      case 'sms': this.compose('sms', w.recommendation.key === 'reply' ? null : category); return;
      case 'log': this.logOutcome(); return;
      case 'offer':
      case 'check_payment': this.setTab('offers'); return;
      case 'handoff': this.setTab('handoff'); return;
      case 'client': if (w.clientId) this.router.navigate(['/app/clients', w.clientId]); return;
      case 'schedule': this.openNext(); return;
      case 'edit_business': this.setTab('details'); this.startEditBusiness(); return;
      default: break;
    }
    switch (w.recommendation.key) {
      case 'add_contact': this.setTab('details'); this.openContact(null); break;
      case 'first_contact': if (this.phone()) this.callViaLink(); else this.compose('email', 'intro'); break;
      case 'reply': this.compose(w.activities.find((a) => a.direction === 'inbound')?.channel === 'sms' ? 'sms' : 'email'); break;
      case 'schedule': this.openNext(); break;
      case 'overdue':
      case 'payment_follow_up':
        if (w.opportunity.nextActionType === 'email') this.compose('email', 'follow_up');
        else if (w.opportunity.nextActionType === 'text') this.compose('sms', 'follow_up');
        else if (this.phone()) this.callViaLink();
        else this.compose('email', 'follow_up');
        break;
      case 'send_payment_link': this.compose('email', 'payment_reminder'); break;
      case 'create_payment_link':
      case 'payment_problem': this.setTab('offers'); break;
      case 'handoff':
      case 'retry_handoff': this.setTab('handoff'); break;
      default: this.logOutcome();
    }
  }

  /** For the recommendation button: dial via the platform when connected, else open the phone app. */
  private callViaLink(): void {
    const w = this.ws();
    if (w?.channels.call.connected && w.permissions.send) {
      this.call();
      return;
    }
    window.location.href = `tel:${this.phone()}`;
    this.call();
  }

  outcomeSaved(event: { workspace: Workspace; next: boolean }): void {
    this.outcomeDialog.set(null);
    this.ws.set(event.workspace);
    this.notice.set('Saved.');
    if (event.next) this.nextLead();
  }

  composerSent(workspace: Workspace | null): void {
    this.composerDialog.set(null);
    if (workspace) this.ws.set(workspace);
    else this.load();
    this.notice.set('Message recorded.');
  }

  // ---- queue
  nextLead(skip = false): void {
    const next = this.queue.next(!skip);
    if (next) this.router.navigate(['/app/leads', next.opportunityId], { queryParams: { queue: 1 } });
    else {
      this.queue.stop();
      this.notice.set('Queue finished — nice work.');
      this.router.navigate(['/app/today']);
    }
  }

  endQueue(): void {
    this.queue.stop();
    this.queueMode.set(false);
    this.router.navigate([], { queryParams: { queue: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ---- header actions
  openNext(): void {
    const w = this.ws();
    this.nextAt = w?.opportunity.nextActionAt ? toLocalInput(new Date(w.opportunity.nextActionAt)) : toLocalInput(suggestDate(2));
    this.nextType = w?.opportunity.nextActionType ?? 'follow_up';
    this.nextNote = w?.opportunity.nextActionNote ?? '';
    this.nextDialog.set(true);
  }

  saveNext(clear = false): void {
    this.apply(this.sales.setNextAction(this.id, clear ? { at: null } : { at: new Date(this.nextAt).toISOString(), type: this.nextType, note: this.nextNote }), clear ? 'Next step cleared.' : 'Next step saved.', () => this.nextDialog.set(false));
  }

  openStage(stage?: string): void {
    this.stageChoice = stage ?? this.ws()?.opportunity.stage ?? '';
    this.lostReason = '';
    this.stageReason = '';
    this.revisitAt = toLocalInput(suggestDate(90)).slice(0, 10);
    this.stageMissing.set([]);
    this.stageQual = { ...EMPTY_QUAL };
    this.stageDialog.set(true);
  }

  guideFor(stage: string): StageGuide | null {
    return this.ws()?.pipeline.stages.find((g) => g.key === stage) ?? null;
  }

  labelFor(stage: string): string {
    return STAGE_LABELS[stage as SalesStage] ?? stage;
  }

  isQualKey(key: string): key is QualificationKey {
    return key in EMPTY_QUAL;
  }

  /** Moves the deal; if the stage needs details first, asks for exactly those. */
  saveStage(): void {
    const w = this.ws();
    if (!w) return;
    const missingQual = this.stageMissing().filter((m) => this.isQualKey(m.key));
    const answers: Partial<Record<QualificationKey, string>> = {};
    for (const m of missingQual) {
      const value = this.stageQual[m.key as QualificationKey].trim();
      if (!value) {
        this.error.set(`Add “${m.label}” to move to ${STAGE_LABELS[this.stageChoice as SalesStage]}.`);
        setTimeout(() => this.error.set(''), 5000);
        return;
      }
      answers[m.key as QualificationKey] = value;
    }
    const move = () => this.sales.changeStage(this.id, {
      stage: this.stageChoice,
      lostReason: this.lostReason || undefined,
      closeReasonCode: this.stageReason || undefined,
      revisitAt: this.stageChoice === 'nurture' && this.revisitAt ? new Date(`${this.revisitAt}T12:00:00`).toISOString() : undefined,
    });
    this.busy.set(true);
    const run = () => move().subscribe({
      next: (updated) => { this.ws.set(updated); this.busy.set(false); this.stageDialog.set(false); this.notice.set(`Moved to ${updated.opportunity.stageLabel}.`); },
      error: (err) => {
        this.busy.set(false);
        if (err.status === 422 && err.error?.code === 'stage_requirements') {
          this.stageMissing.set(err.error.missing || []);
          return;
        }
        this.error.set(err.error?.message || 'The stage wasn’t changed.');
        setTimeout(() => this.error.set(''), 6000);
      },
    });
    if (Object.keys(answers).length) {
      this.sales.updateQualification(this.id, answers).subscribe({
        next: () => run(),
        error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Those details weren’t saved.'); },
      });
    } else run();
  }

  // ---- qualification (ADR 0013)
  openQual(): void {
    const q = this.ws()?.opportunity.qualification;
    this.qualForm = { ...EMPTY_QUAL };
    for (const key of Object.keys(EMPTY_QUAL) as QualificationKey[]) this.qualForm[key] = q?.[key] ?? '';
    this.qualEditing.set(true);
  }

  saveQual(): void {
    const q = this.ws()?.opportunity.qualification;
    const changes: Partial<Record<QualificationKey, string | null>> = {};
    for (const key of Object.keys(EMPTY_QUAL) as QualificationKey[]) {
      const value = this.qualForm[key].trim();
      if (value !== (q?.[key] ?? '')) changes[key] = value || null;
    }
    if (!Object.keys(changes).length) { this.qualEditing.set(false); return; }
    this.apply(this.sales.updateQualification(this.id, changes), 'Qualification saved.', () => this.qualEditing.set(false));
  }

  toggleDnc(): void {
    const w = this.ws();
    if (!w) return;
    if (w.opportunity.doNotContact) this.apply(this.sales.setDoNotContact(this.id, false), 'They can be contacted again.');
    else { this.dncReason = ''; this.dncDialog.set(true); }
  }

  saveDnc(): void {
    this.apply(this.sales.setDoNotContact(this.id, true, this.dncReason), 'Marked do not contact. All outreach is stopped.', () => this.dncDialog.set(false));
  }

  assign(userId: string): void {
    this.menuOpen.set(false);
    this.apply(this.sales.assign(this.id, userId), 'Owner updated.');
  }

  archiveToggle(): void {
    const w = this.ws();
    if (!w) return;
    this.apply(w.opportunity.archivedAt ? this.sales.restore(this.id) : this.sales.archive(this.id), w.opportunity.archivedAt ? 'Restored.' : 'Archived — it no longer appears in queues.');
  }

  createDeal(): void {
    this.busy.set(true);
    this.sales.newDeal(this.id, this.newDealTitle).subscribe({
      next: (res) => { this.busy.set(false); this.dealDialog.set(false); this.router.navigate(['/app/leads', res.opportunityId]); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'The deal could not be created.'); },
    });
  }

  saveReply(): void {
    this.apply(this.sales.logReply(this.id, { channel: this.replyChannel, note: this.replyNote, idempotencyKey: this.replyKey }), 'Reply logged — it’s waiting for your answer.', () => {
      this.replyDialog.set(false);
      this.replyNote = '';
      this.replyKey = actionKey();
    });
  }

  replyHandled(): void {
    this.apply(this.sales.replyHandled(this.id), 'Marked as handled.');
  }

  // ---- notes
  addNote(): void {
    const text = this.noteText.trim();
    if (!text) return;
    this.savingNote.set(true);
    this.sales.addNote(this.id, text).subscribe({
      next: (note) => {
        this.savingNote.set(false);
        this.noteText = '';
        const w = this.ws();
        if (w) this.ws.set({ ...w, notes: [{ ...note, user: { id: this.auth.currentUser()?.id ?? '', name: this.auth.currentUser()?.name ?? 'You' } }, ...w.notes] });
      },
      error: (err) => { this.savingNote.set(false); this.error.set(err.error?.message || 'Note not saved — your text is still here.'); },
    });
  }

  // ---- details
  startEditBusiness(): void {
    const b = this.ws()!.business;
    this.business = {
      name: b.name ?? '', phone: b.phone ?? '', email: b.email ?? '', website: b.website ?? '', addressLine1: b.addressLine1 ?? '', city: b.city ?? '', state: b.state ?? '', postalCode: b.postalCode ?? '', category: b.category ?? '',
    };
    this.editingBusiness.set(true);
  }

  saveBusiness(): void {
    this.apply(this.sales.updateBusiness(this.id, this.business), 'Business details saved.', () => this.editingBusiness.set(false));
  }

  markVerified(field: string): void {
    this.apply(this.sales.updateBusiness(this.id, { verified: [field] }), 'Marked as verified.');
  }

  openContact(c: Contact | null): void {
    this.contact = { name: c?.name ?? '', title: c?.title ?? '', email: c?.email ?? '', phone: c?.phone ?? '' };
    this.contactForm.set({ id: c?.id ?? null });
  }

  saveContact(): void {
    const form = this.contactForm();
    if (!form) return;
    const request = form.id ? this.sales.updateContact(this.id, form.id, this.contact) : this.sales.addContact(this.id, this.contact);
    this.apply(request, 'Contact saved.', () => this.contactForm.set(null));
  }

  contactAction(c: Contact, patch: Record<string, unknown>, message: string): void {
    this.apply(this.sales.updateContact(this.id, c.id, patch), message);
  }

  startEditDeal(): void {
    const o = this.ws()!.opportunity;
    this.deal = { title: o.title ?? '', value: o.valueCents ? String(o.valueCents / 100) : '' };
    this.editingDeal.set(true);
  }

  saveDeal(): void {
    const value = this.deal.value === '' ? null : Math.round(Number(this.deal.value) * 100);
    this.apply(this.sales.updateDeal(this.id, { title: this.deal.title, valueCents: value }), 'Deal updated.', () => this.editingDeal.set(false));
  }

  // ---- research (only when asked)
  runAudit(): void {
    this.researchBusy.set('audit');
    this.crm.generateWebsiteAudit(this.id).subscribe({
      next: (res) => { this.researchBusy.set(null); this.audit.set(res.data.audit); },
      error: (err) => { this.researchBusy.set(null); this.error.set(err.error?.message || 'The website check failed.'); },
    });
  }

  runEnrichment(): void {
    this.researchBusy.set('enrich');
    this.crm.requestEnrichment(this.id).subscribe({
      next: (res) => { this.researchBusy.set(null); this.enrichment.set(res.data.enrichment); },
      error: (err) => { this.researchBusy.set(null); this.error.set(err.error?.message || 'The lookup failed.'); },
    });
  }

  // ---- display helpers
  channelIcon(channel: string): string {
    return ({ email: 'mail', sms: 'message', call: 'phone', in_person: 'users', linkedin: 'users' } as Record<string, string>)[channel] ?? 'outreach';
  }

  originLabel(a: Activity): string {
    if (a.origin === 'platform') return a.direction === 'inbound' ? 'Received in Leadzaro' : 'Sent from Leadzaro';
    if (a.origin === 'external') return 'Done outside Leadzaro';
    return 'Logged';
  }

  statusTone(status: string | null): string {
    if (!status) return '';
    if (['failed', 'undelivered', 'busy', 'no-answer', 'canceled'].includes(status)) return 'tag-danger';
    if (['delivered', 'completed', 'received'].includes(status)) return 'tag-success';
    return 'tag-muted';
  }

  kitPrice(cents: number | null, billing: string | null): string {
    if (cents === null || cents === undefined) return '';
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
    return `${amount}${({ one_time: ' one-time', monthly: '/month', yearly: '/year' } as Record<string, string>)[billing ?? ''] ?? ''}`;
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(() => this.notice.set('Copied.'), () => this.error.set('Copying isn’t allowed in this browser — select the text instead.'));
  }

  telHref(): string {
    return `tel:${this.phone() ?? ''}`;
  }
}
