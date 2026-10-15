import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SettingsService } from '../../../core/services/settings.service';
import { GmailConnection } from '../../../core/models/settings.model';

/**
 * Settings → My account → Email sending (ADR 0015). Each person connects
 * their own Google Workspace mailbox; Leadzaro then sends their sales email
 * as them. Google redirects back here with ?gmail=connected|error.
 */
@Component({
  selector: 'app-gmail-connection',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="set-card" id="email-sending">
      <div class="set-card-head">
        <div><h3>Email sending</h3><p>Sales emails go out from your own business mailbox, so replies come straight to you and copies land in your Gmail Sent folder.</p></div>
        <span class="scope-tag personal">Only you</span>
      </div>
      <div class="set-card-body">
        @if (result(); as r) { <div class="alert" [class.alert-success]="r.ok" [class.alert-error]="!r.ok" role="status">{{ r.message }}</div> }
        @if (loading()) {
          <div class="loading-state"><div class="spinner"></div></div>
        } @else if (status()) {
          @let s = status()!;
          @if (!s.configured) {
            <p class="text-sm text-muted">Gmail sending isn’t set up on this server yet. An administrator adds the Google OAuth client (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET).</p>
          } @else if (s.connected) {
            <dl class="kv">
              <dt>Sends as</dt><dd><strong>{{ s.email }}</strong></dd>
              <dt>Connected</dt><dd>{{ s.connectedAt | date: 'MMM d, y' }}</dd>
              <dt>Last used</dt><dd>{{ s.lastUsedAt ? (s.lastUsedAt | date: 'MMM d, h:mm a') : 'Not yet' }}</dd>
            </dl>
            <p class="form-hint">Leadzaro can only send as you — it can’t read your inbox. You can also remove access any time from your Google Account → Security → Third-party connections.</p>
          } @else if (s.needsReconnect) {
            <div class="alert alert-warning">Your connection to {{ s.email }} stopped working{{ s.lastError ? ': ' + s.lastError : '' }}. Reconnect it to keep sending from Leadzaro.</div>
          } @else {
            <p class="text-sm">Not connected. Until you connect, use “Open in my email app” on a lead and confirm it was sent.</p>
          }
          @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
          @if (s.configured) {
            <div class="set-actions">
              @if (s.connected || s.needsReconnect) { <button type="button" class="btn btn-ghost btn-sm" (click)="disconnect()" [disabled]="busy()">Disconnect</button> }
              <button type="button" class="btn btn-sm" [class.btn-primary]="!s.connected" [class.btn-outline]="s.connected" (click)="connect()" [disabled]="busy()">
                {{ busy() ? 'Opening Google…' : s.connected ? 'Reconnect' : s.needsReconnect ? 'Reconnect Gmail' : 'Connect Gmail' }}
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class GmailConnectionComponent implements OnInit {
  private readonly settings = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly status = signal<GmailConnection | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<{ ok: boolean; message: string } | null>(null);

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    const outcome = q.get('gmail');
    if (outcome === 'connected') this.result.set({ ok: true, message: `Connected — sales emails will now be sent from ${q.get('email') || 'your mailbox'}.` });
    else if (outcome === 'error') this.result.set({ ok: false, message: q.get('reason') || 'Gmail wasn’t connected. Try again.' });
    if (outcome) {
      // Drop the one-time result from the address bar.
      this.router.navigate([], { queryParams: { gmail: null, email: null, reason: null }, queryParamsHandling: 'merge', replaceUrl: true, preserveFragment: true });
      setTimeout(() => document.getElementById('email-sending')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
    this.settings.gmailStatus().subscribe({
      next: (s) => { this.status.set(s); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'Couldn’t load your email connection.'); },
    });
  }

  connect(): void {
    this.busy.set(true);
    this.error.set('');
    this.settings.connectGmail().subscribe({
      // A full-page redirect to Google; it sends the browser back to this page.
      next: (res) => { window.location.href = res.url; },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Couldn’t start the Google connection.'); },
    });
  }

  disconnect(): void {
    if (!confirm('Disconnect your Gmail? Leadzaro will stop sending email as you until you connect again.')) return;
    this.busy.set(true);
    this.settings.disconnectGmail().subscribe({
      next: (s) => { this.busy.set(false); this.status.set(s); this.result.set({ ok: true, message: 'Gmail disconnected.' }); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Couldn’t disconnect — try again.'); },
    });
  }
}
