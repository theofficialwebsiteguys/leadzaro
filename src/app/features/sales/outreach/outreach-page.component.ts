import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { KeyValuePipe } from '@angular/common';
import { SalesService } from '../../../core/services/sales.service';
import { NavOriginService } from '../../../core/services/nav-origin.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import {
  CHANNEL_LABELS, Channels, Conversation, MessageTemplate, RenderedMessage, TEMPLATE_CATEGORIES,
} from '../../../core/models/sales.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { RelativeDayPipe, nextActionLabel } from '../shared/sales-format';
import { DatePipe } from '@angular/common';
import {
  Activity, ConversationCounts, LeadNote, Workspace,
} from '../../../core/models/sales.model';

type Tab = 'conversations' | 'templates';

/**
 * Outreach (ADR 0011): the conversations inbox (replies first) and the
 * message templates — personal ones for everyone, shared ones managed by
 * managers — with a live preview.
 */
@Component({
  selector: 'app-outreach-page',
  standalone: true,
  imports: [RouterLink, FormsModule, KeyValuePipe, IconComponent, DialogComponent, RelativeDayPipe, DatePipe],
  templateUrl: './outreach-page.component.html',
  styleUrl: './outreach-page.component.scss',
})
export class OutreachPageComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly origin = inject(NavOriginService);
  readonly org = inject(OrganizationContextService);

  /** "Back" from the lead returns to this list as it is now (ADR 0017). */
  rememberOrigin(): void { this.origin.remember('conversations', this.router.url); }

  readonly channelLabels = CHANNEL_LABELS;
  readonly categories = Object.entries(TEMPLATE_CATEGORIES).map(([key, label]) => ({ key, label }));
  readonly categoryLabels = TEMPLATE_CATEGORIES;
  readonly tab = signal<Tab>('conversations');
  readonly canTeam = computed(() => this.org.hasPermission('sales.view_team'));
  readonly canShare = computed(() => this.org.hasPermission('templates.manage_shared'));

  // Conversations
  readonly conversations = signal<Conversation[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly channels = signal<Channels | null>(null);
  readonly counts = signal<ConversationCounts | null>(null);
  readonly filters: { key: keyof ConversationCounts; label: string; hint: string }[] = [
    { key: 'needs_reply', label: 'Needs your reply', hint: 'They answered — reply first' },
    { key: 'due', label: 'Follow-up due', hint: 'Your next step is today or overdue' },
    { key: 'waiting', label: 'Waiting on them', hint: 'You reached out; the next follow-up is later' },
    { key: 'no_response', label: 'No response', hint: '3+ tries and they’ve never answered' },
    { key: 'all', label: 'All', hint: 'Every conversation' },
  ];
  readonly statusLabels: Record<string, string> = {
    needs_reply: 'Needs your reply', due: 'Follow-up due', waiting: 'Waiting on them', no_response: 'No response yet', closed: 'Closed',
  };
  readonly nextActionLabel = nextActionLabel;
  // The thread open in the side panel.
  readonly thread = signal<Workspace | null>(null);
  readonly threadId = signal<string | null>(null);
  readonly threadEntries = computed(() => {
    const w = this.thread();
    if (!w) return [];
    const entries: { at: string; activity?: Activity; note?: LeadNote }[] = [
      ...w.activities.map((a) => ({ at: a.occurredAt || a.createdAt, activity: a })),
      ...w.notes.map((n) => ({ at: n.createdAt, note: n })),
    ];
    return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  });
  filter = 'needs_reply';
  scope = 'mine';
  q = '';

  // Templates
  readonly templates = signal<MessageTemplate[]>([]);
  readonly placeholders = signal<Record<string, string>>({});
  readonly editing = signal<MessageTemplate | 'new' | null>(null);
  readonly preview = signal<RenderedMessage | null>(null);
  readonly saving = signal(false);
  readonly templateError = signal('');
  readonly message = signal('');
  channelFilter = '';
  showArchived = false;
  form = {
    name: '', channel: 'email', category: 'intro', subject: '', body: '', scope: 'personal',
  };

  ngOnInit(): void {
    this.tab.set(this.route.snapshot.queryParamMap.get('tab') === 'templates' ? 'templates' : 'conversations');
    this.loadConversations();
    this.loadTemplates();
    this.sales.channels().subscribe({ next: (c) => this.channels.set(c), error: () => undefined });
    this.sales.placeholders().subscribe({ next: (p) => this.placeholders.set(p), error: () => undefined });
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.router.navigate([], { queryParams: { tab: tab === 'templates' ? 'templates' : null }, replaceUrl: true });
  }

  setFilter(key: string): void {
    this.filter = key;
    this.loadConversations();
  }

  loadConversations(): void {
    this.loading.set(true);
    this.sales.conversations({ filter: this.filter, scope: this.scope, q: this.q, limit: 100 }).subscribe({
      next: (res) => {
        this.conversations.set(res.items);
        this.total.set(res.total);
        this.counts.set(res.counts);
        this.loading.set(false);
        this.error.set('');
        // Open on the busiest useful tab the first time.
        if (this.filter === 'needs_reply' && !res.counts.needs_reply && res.counts.all && !this.autoPicked) {
          this.autoPicked = true;
          this.setFilter(res.counts.due ? 'due' : 'all');
        }
      },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'Conversations could not be loaded.'); },
    });
  }

  loadTemplates(): void {
    this.sales.templates({ channel: this.channelFilter || undefined, includeArchived: this.showArchived || undefined }).subscribe({
      next: (list) => this.templates.set(list),
      error: (err) => this.templateError.set(err.error?.message || 'Templates could not be loaded.'),
    });
  }

  private autoPicked = false;

  openThread(c: Conversation): void {
    this.threadId.set(c.opportunityId);
    this.thread.set(null);
    this.sales.workspace(c.opportunityId).subscribe({ next: (w) => this.thread.set(w), error: () => this.threadId.set(null) });
  }

  channelSummary(c: Conversation): string {
    const names: Record<string, string> = { email: 'email', call: 'call', sms: 'text', in_person: 'visit', other: 'other' };
    return Object.entries(c.channels).map(([k, n]) => `${n} ${names[k] ?? k}${n === 1 ? '' : 's'}`).join(' · ');
  }

  lastLabel(c: Conversation): string {
    const last = c.last;
    if (!last) return '';
    const who = last.direction === 'inbound' ? 'They' : 'You';
    const how = CHANNEL_LABELS[last.channel] ?? last.channel;
    const where = last.origin === 'platform' ? '' : last.origin === 'external' ? ' (outside Leadzaro)' : ' (logged)';
    return `${who} · ${how}${where}`;
  }

  startNew(): void {
    this.form = {
      name: '', channel: 'email', category: 'intro', subject: '', body: '', scope: 'personal',
    };
    this.preview.set(null);
    this.templateError.set('');
    this.editing.set('new');
  }

  edit(t: MessageTemplate): void {
    this.form = {
      name: t.name, channel: t.channel, category: t.category, subject: t.subject ?? '', body: t.body, scope: t.scope,
    };
    this.preview.set(null);
    this.templateError.set('');
    this.editing.set(t);
    this.runPreview();
  }

  ph(key: string): string {
    return `{{${key}}}`;
  }

  insert(key: string): void {
    this.form.body = `${this.form.body}{{${key}}}`;
  }

  runPreview(): void {
    this.sales.render(null, { subject: this.form.channel === 'email' ? this.form.subject : null, body: this.form.body, channel: this.form.channel }).subscribe({
      next: (r) => this.preview.set(r),
      error: (err) => this.templateError.set(err.error?.message || 'Preview failed.'),
    });
  }

  save(): void {
    const current = this.editing();
    this.saving.set(true);
    this.templateError.set('');
    const body = { ...this.form, subject: this.form.channel === 'email' ? this.form.subject : null };
    const request = current === 'new' ? this.sales.createTemplate(body) : this.sales.updateTemplate((current as MessageTemplate).id, body);
    request.subscribe({
      next: () => { this.saving.set(false); this.editing.set(null); this.message.set('Template saved.'); this.loadTemplates(); },
      error: (err) => { this.saving.set(false); this.templateError.set(err.error?.message || 'The template could not be saved.'); },
    });
  }

  archive(t: MessageTemplate): void {
    this.sales.updateTemplate(t.id, { archived: !t.archivedAt }).subscribe({
      next: () => { this.message.set(t.archivedAt ? 'Template restored.' : 'Template archived.'); this.loadTemplates(); },
      error: (err) => this.message.set(err.error?.message || 'That didn’t work.'),
    });
  }

  copy(t: MessageTemplate): void {
    this.sales.copyTemplate(t.id).subscribe({
      next: (copy) => { this.message.set('Copied to your templates.'); this.loadTemplates(); this.edit(copy); },
      error: (err) => this.message.set(err.error?.message || 'That didn’t work.'),
    });
  }
}
