import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { KeyValuePipe } from '@angular/common';
import { SalesService } from '../../../core/services/sales.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import {
  CHANNEL_LABELS, Channels, Conversation, MessageTemplate, RenderedMessage, TEMPLATE_CATEGORIES,
} from '../../../core/models/sales.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { RelativeDayPipe } from '../shared/sales-format';

type Tab = 'conversations' | 'templates';

/**
 * Outreach (ADR 0011): the conversations inbox (replies first) and the
 * message templates — personal ones for everyone, shared ones managed by
 * managers — with a live preview.
 */
@Component({
  selector: 'app-outreach-page',
  standalone: true,
  imports: [RouterLink, FormsModule, KeyValuePipe, IconComponent, DialogComponent, RelativeDayPipe],
  templateUrl: './outreach-page.component.html',
  styleUrl: './outreach-page.component.scss',
})
export class OutreachPageComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly org = inject(OrganizationContextService);

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
  filter = 'all';
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

  loadConversations(): void {
    this.loading.set(true);
    this.sales.conversations({ filter: this.filter, scope: this.scope, q: this.q }).subscribe({
      next: (res) => { this.conversations.set(res.items); this.total.set(res.total); this.loading.set(false); this.error.set(''); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'Conversations could not be loaded.'); },
    });
  }

  loadTemplates(): void {
    this.sales.templates({ channel: this.channelFilter || undefined, includeArchived: this.showArchived || undefined }).subscribe({
      next: (list) => this.templates.set(list),
      error: (err) => this.templateError.set(err.error?.message || 'Templates could not be loaded.'),
    });
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
