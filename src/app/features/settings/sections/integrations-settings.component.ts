import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SettingsService } from '../../../core/services/settings.service';
import { IntegrationItem, IntegrationsResponse } from '../../../core/models/settings.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { NamecheapConnectionComponent } from '../namecheap-connection/namecheap-connection.component';

const ICONS: Record<string, string> = {
  stripe: 'card', email: 'mail', twilio: 'phone', namecheap: 'globe', google_places: 'search',
};

/**
 * Integrations (ADR 0012): one card per connection, all showing the real
 * backend state. Secrets never reach the browser — Stripe, email, Twilio
 * and Google keys live in server configuration (setup steps shown to
 * administrators); Namecheap keeps its existing encrypted in-app setup.
 */
@Component({
  selector: 'app-integrations-settings',
  standalone: true,
  imports: [DatePipe, RouterLink, IconComponent, NamecheapConnectionComponent],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>Integrations</h2><p>Services Leadzaro connects to. The status shown is what the server reports right now.</p></div>

      @if (error()) { <div class="alert alert-error">{{ error() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @else if (!data()) { <div class="loading-state"><div class="spinner"></div></div> }
      @else {
        @let d = data()!;
        @if (!d.canManage) { <div class="alert alert-info">Only an administrator can connect or change these. If something you need isn’t connected, ask them.</div> }
        @for (item of d.items; track item.key) {
          <article class="set-card integ" [attr.data-state]="item.state">
            <div class="integ-head">
              <span class="integ-icon"><lz-icon [name]="icons[item.key]" [size]="18" /></span>
              <div class="integ-title">
                <h3>{{ item.name }}</h3>
                <p>{{ item.purpose }}</p>
              </div>
              <span class="state">{{ stateLabel(item) }}</span>
            </div>
            <div class="integ-body">
              <dl class="kv">
                @if (item.account) { <dt>{{ item.key === 'email' ? 'Sends as' : item.key === 'twilio' ? 'Number' : 'Account' }}</dt><dd>{{ item.account }}</dd> }
                <dt>Status</dt><dd>{{ item.detail }}</dd>
                @if (item.lastActivityLabel) { <dt>{{ item.lastActivityLabel }}</dt><dd>{{ item.lastActivityAt ? (item.lastActivityAt | date: 'MMM d, h:mm a') : 'None yet' }}</dd> }
                @if (item.personal) {
                  <dt>{{ item.personal.label }}</dt>
                  <dd>{{ item.personal.value || 'Not set' }} · <a routerLink="/app/settings/account">{{ item.personal.value ? 'Change' : 'Add your number' }}</a></dd>
                }
              </dl>

              <div class="integ-actions">
                @switch (item.key) {
                  @case ('namecheap') {
                    <a class="btn btn-ghost btn-sm" routerLink="/app/domains">Open Domains</a>
                    @if (item.manage === 'in_app') { <button class="btn btn-outline btn-sm" (click)="toggle('namecheap')">{{ open() === 'namecheap' ? 'Close' : item.state === 'not_connected' ? 'Connect' : 'Manage' }}</button> }
                  }
                  @default {
                    @if (d.canManage && d.setupSteps?.[item.key]) {
                      <button class="btn btn-outline btn-sm" (click)="toggle(item.key)">{{ open() === item.key ? 'Hide setup' : item.state === 'not_connected' ? 'How to connect' : item.state === 'attention' ? 'Fix' : 'Setup details' }}</button>
                    }
                  }
                }
              </div>
            </div>

            @if (open() === item.key) {
              <div class="integ-panel">
                @if (item.key === 'namecheap') {
                  <app-namecheap-connection />
                } @else {
                  @let steps = d.setupSteps?.[item.key];
                  @if (steps) {
                    <p class="text-sm">These values go in the server’s environment settings (the <code>.env</code> file or your host’s secret settings), never in this page. Restart the API afterwards and this card updates.</p>
                    <pre>{{ steps.env.join('\n') }}</pre>
                    @if (steps.permissions) { <p class="text-sm"><strong>Key permissions:</strong> {{ steps.permissions }}</p> }
                    @if (steps.webhookPath) {
                      <p class="text-sm"><strong>Webhook endpoint:</strong> <code>https://your-api-host{{ steps.webhookPath }}</code>, with these events:</p>
                      <ul class="events">@for (e of steps.events ?? []; track e) { <li><code>{{ e }}</code></li> }</ul>
                      <p class="text-sm">Use a test key (<code>rk_test_…</code>) first. Test and live records are kept separate automatically.</p>
                    }
                    @if (steps.inboundPath) { <p class="text-sm"><strong>Incoming texts:</strong> point the Twilio number’s messaging webhook at <code>https://your-api-host{{ steps.inboundPath }}</code>.</p> }
                  }
                  @if (item.diagnostics) {
                    <details class="diag"><summary>Technical details</summary>
                      <dl class="kv">@for (entry of diagEntries(item); track entry[0]) { <dt>{{ entry[0] }}</dt><dd>{{ entry[1] }}</dd> }</dl>
                    </details>
                  }
                }
              </div>
            }
          </article>
        }
        <p class="form-hint">Stripe here is for charging your clients. It isn’t related to any subscription you pay for Leadzaro itself.</p>
      }
    </section>
  `,
  styles: [`
    .integ { --tone: #CBD5E1; border-left: 3px solid var(--tone);
      &[data-state='connected'] { --tone: var(--success); }
      &[data-state='test'] { --tone: var(--info); }
      &[data-state='attention'] { --tone: var(--warning); }
    }
    .integ-head { display: flex; gap: 12px; align-items: flex-start; padding: 16px 20px 0; }
    .integ-icon { width: 36px; height: 36px; border-radius: var(--radius); display: grid; place-items: center; background: var(--bg-2); color: var(--text-secondary); flex-shrink: 0; }
    .integ-title { flex: 1; min-width: 0; h3 { margin: 0; font-size: .98rem; } p { margin: 2px 0 0; font-size: .8rem; color: var(--text-muted); } }
    .state { font-size: .72rem; font-weight: 700; padding: 3px 10px; border-radius: var(--radius-full); white-space: nowrap; background: var(--bg-2); color: var(--text-secondary); }
    [data-state='connected'] .state { background: var(--success-bg); color: var(--success-text); }
    [data-state='test'] .state { background: var(--info-bg); color: var(--info-text); }
    [data-state='attention'] .state { background: var(--warning-bg); color: var(--warning-text); }
    .integ-body { display: flex; justify-content: space-between; gap: 16px; padding: 12px 20px 16px 68px; flex-wrap: wrap;
      @media (max-width: 640px) { padding-left: 20px; }
      .kv { flex: 1; min-width: 240px; }
    }
    .integ-actions { display: flex; gap: 6px; align-items: flex-start; }
    .integ-panel { border-top: 1px solid var(--border-light); padding: 14px 20px 18px; background: var(--bg); border-radius: 0 0 var(--radius-lg) var(--radius-lg);
      pre { background: #0F172A; color: #E2E8F0; padding: 10px 12px; border-radius: var(--radius); font-size: .75rem; overflow-x: auto; }
      code { font-size: .75rem; background: var(--bg-2); padding: 1px 5px; border-radius: 4px; }
      .events { columns: 2; font-size: .78rem; padding-left: 18px; @media (max-width: 640px) { columns: 1; } }
    }
    .diag { margin-top: 10px; font-size: .8rem; summary { cursor: pointer; color: var(--text-secondary); } }
  `],
})
export class IntegrationsSettingsComponent implements OnInit {
  private readonly settings = inject(SettingsService);

  readonly icons = ICONS;
  readonly data = signal<IntegrationsResponse | null>(null);
  readonly error = signal('');
  readonly open = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.settings.integrations().subscribe({
      next: (d) => this.data.set(d),
      error: (err) => this.error.set(err.error?.message || 'Integration status couldn’t be loaded.'),
    });
  }

  toggle(key: string): void {
    this.open.set(this.open() === key ? null : key);
    if (this.open() === null && key === 'namecheap') this.load();
  }

  stateLabel(item: IntegrationItem): string {
    if (item.state === 'connected') return 'Connected';
    if (item.state === 'attention') return 'Needs attention';
    if (item.state === 'test') return item.mode === 'mock' ? 'Development mock' : item.mode === 'demo' ? 'Demo mode' : 'Test mode';
    return 'Not connected';
  }

  diagEntries(item: IntegrationItem): [string, string][] {
    const labels: Record<string, string> = {
      webhookPath: 'Webhook path', restrictedKey: 'Restricted key', failedWebhooks: 'Failed payment events', automaticTax: 'Stripe Tax', defaultCurrency: 'Default currency', accountId: 'Account ID', accountNote: 'Note',
    };
    return Object.entries(item.diagnostics ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => [labels[k] ?? k, typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)]);
  }
}
