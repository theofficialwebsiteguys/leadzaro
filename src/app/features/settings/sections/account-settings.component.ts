import { PhoneInputDirective } from '../../../shared/forms/formatted-inputs';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SettingsService } from '../../../core/services/settings.service';
import { AuthService } from '../../../core/services/auth.service';
import { SessionService } from '../../../core/services/session.service';
import { MySettings } from '../../../core/models/settings.model';
import { AuthSessionInfo } from '../../../core/models/organization.model';
import { HasUnsavedChanges, Snapshot } from '../unsaved-changes.guard';

/** My account (ADR 0012): personal profile, sign-in and security, and the access you actually have. */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, PhoneInputDirective],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>My account</h2><p>Changes here affect only you.</p></div>

      @if (loadError()) { <div class="alert alert-error">{{ loadError() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @else if (!me()) { <div class="loading-state"><div class="spinner"></div></div> }
      @else {
        @let m = me()!;
        <form class="set-card" (ngSubmit)="saveProfile()">
          <div class="set-card-head">
            <div><h3>Profile</h3><p>How you appear to the team and in outreach templates.</p></div>
            <span class="scope-tag personal">Only you</span>
          </div>
          <div class="set-card-body set-grid">
            <div class="form-group"><label class="form-label" for="p-name">Full name</label>
              <input id="p-name" class="form-control" name="name" [(ngModel)]="profile.name" required maxlength="100" autocomplete="name" /></div>
            <div class="form-group"><label class="form-label" for="p-title">Job title</label>
              <input id="p-title" class="form-control" name="title" [(ngModel)]="profile.title" maxlength="100" placeholder="e.g. Sales Manager" />
              <span class="form-hint">Shown to your team. It doesn’t change what you can access.</span></div>
            <div class="form-group"><label class="form-label" for="p-phone">Your phone</label>
              <input id="p-phone" class="form-control" name="phone" [(ngModel)]="profile.phone" lzPhone placeholder="(555) 123-4567" />
              <span class="form-hint">Used to ring you for click-to-call and as your number in templates.</span></div>
          </div>
          <div class="set-actions">
            @if (profileDirty()) { <span class="dirty">Unsaved changes</span> } @else if (profileMsg()) { <span class="saved" role="status">{{ profileMsg() }}</span> }
            @if (profileError()) { <span class="form-error" role="alert">{{ profileError() }}</span> }
            <button type="button" class="btn btn-ghost btn-sm" (click)="resetProfile()" [disabled]="!profileDirty()">Discard</button>
            <button type="submit" class="btn btn-primary btn-sm" [disabled]="!profileDirty() || saving()">{{ saving() ? 'Saving…' : 'Save profile' }}</button>
          </div>
        </form>

        <div class="set-card">
          <div class="set-card-head"><div><h3>Sign-in &amp; security</h3><p>Your login is separate from the company’s contact email and from the address outreach is sent from.</p></div></div>
          <div class="set-card-body">
            <div class="set-grid">
              <div class="form-group"><span class="form-label">Login email</span>
                <span class="readonly-value">{{ m.user.email }} @if (m.user.emailVerified) { <span class="tag tag-success">Verified</span> } @else { <span class="tag tag-muted">Not verified</span> }</span>
                <span class="form-hint">Changing your login email isn’t supported here — ask an administrator.</span></div>
              <div class="form-group"><span class="form-label">Member since</span><span class="readonly-value">{{ m.membership.since | date: 'MMM d, y' }}</span></div>
            </div>

            <form class="pw" (ngSubmit)="changePassword()" autocomplete="off">
              <p class="eyebrow">Change password</p>
              <div class="pw-grid">
                <div class="form-group"><label class="form-label" for="pw-cur">Current password</label><input id="pw-cur" type="password" class="form-control" name="current" [(ngModel)]="pw.current" autocomplete="current-password" /></div>
                <div class="form-group"><label class="form-label" for="pw-new">New password</label><input id="pw-new" type="password" class="form-control" name="next" [(ngModel)]="pw.next" autocomplete="new-password" minlength="8" /></div>
                <div class="form-group"><label class="form-label" for="pw-conf">Confirm new password</label><input id="pw-conf" type="password" class="form-control" name="confirm" [(ngModel)]="pw.confirm" autocomplete="new-password" /></div>
              </div>
              @if (pwError()) { <div class="alert alert-error">{{ pwError() }}</div> }
              @if (pwMsg()) { <div class="alert alert-success" role="status">{{ pwMsg() }}</div> }
              <div class="pw-actions"><span class="form-hint">At least 8 characters. Your other devices are signed out when it changes.</span>
                <button type="submit" class="btn btn-outline btn-sm" [disabled]="pwSaving() || !pw.current || !pw.next">{{ pwSaving() ? 'Updating…' : 'Update password' }}</button></div>
            </form>

            <div>
              <p class="eyebrow">Signed-in devices</p>
              @for (s of sessions(); track s.id) {
                <div class="session">
                  <div><strong>{{ device(s) }}</strong>@if (s.isCurrent) { <span class="tag tag-primary">This device</span> }
                    <div class="text-xs text-muted">Signed in {{ s.createdAt | date: 'MMM d, y' }}@if (s.lastSeenAt) { · last active {{ s.lastSeenAt | date: 'MMM d, h:mm a' }} }</div></div>
                  @if (!s.isCurrent) { <button class="btn btn-ghost btn-sm" (click)="revoke(s)">Sign out</button> }
                </div>
              } @empty { <p class="text-sm text-muted">No active sessions found.</p> }
            </div>
          </div>
        </div>

        <div class="set-card">
          <div class="set-card-head"><div><h3>Your access</h3><p>What you can do in {{ m.workspace.name }}. Access comes from your roles, set by an administrator.</p></div></div>
          <div class="set-card-body">
            @for (r of m.membership.roles; track r.key) {
              <div class="role"><strong>{{ r.name }}</strong><span>{{ r.summary || 'Custom role.' }}</span></div>
            } @empty { <p class="text-sm text-muted">No roles assigned — ask an administrator.</p> }
            <p class="form-hint">Need different access? An administrator can change roles in <a routerLink="/app/settings/team">Team &amp; access</a>.</p>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .pw { border-top: 1px solid var(--border-light); padding-top: 14px; display: flex; flex-direction: column; gap: 10px; }
    .pw-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; @media (max-width: 720px) { grid-template-columns: 1fr; } }
    .pw-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .session { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--border-light); font-size: .85rem;
      strong { margin-right: 6px; } &:first-of-type { border-top: none; } }
    .role { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: var(--bg); border-radius: var(--radius); font-size: .85rem; span { color: var(--text-muted); font-size: .8rem; } }
  `],
})
export class AccountSettingsComponent implements OnInit, HasUnsavedChanges {
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  private readonly sessionService = inject(SessionService);

  readonly me = signal<MySettings | null>(null);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly profileMsg = signal('');
  readonly profileError = signal('');
  readonly pwSaving = signal(false);
  readonly pwMsg = signal('');
  readonly pwError = signal('');
  readonly sessions = signal<AuthSessionInfo[]>([]);

  profile = { name: '', title: '', phone: '' };
  pw = { current: '', next: '', confirm: '' };
  private readonly snapshot = new Snapshot<{ name: string; title: string; phone: string }>();

  ngOnInit(): void {
    this.load();
    this.loadSessions();
  }

  load(): void {
    this.loadError.set('');
    this.settings.me().subscribe({
      next: (m) => this.apply(m),
      error: (err) => this.loadError.set(err.error?.message || 'Your account settings couldn’t be loaded.'),
    });
  }

  private apply(m: MySettings): void {
    this.me.set(m);
    this.profile = { name: m.user.name, title: m.membership.title ?? '', phone: m.user.phone ?? '' };
    this.snapshot.set(this.profile);
  }

  profileDirty(): boolean {
    return this.snapshot.isDirty(this.profile);
  }

  hasUnsavedChanges(): boolean {
    return this.profileDirty() || Boolean(this.pw.current || this.pw.next);
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  resetProfile(): void {
    const m = this.me();
    if (m) this.apply(m);
  }

  saveProfile(): void {
    if (!this.profile.name.trim()) { this.profileError.set('Your name is required.'); return; }
    this.saving.set(true);
    this.profileError.set('');
    this.settings.updateProfile(this.profile).subscribe({
      next: (m) => { this.saving.set(false); this.apply(m); this.profileMsg.set('Profile saved.'); },
      error: (err) => { this.saving.set(false); this.profileError.set(err.error?.message || 'Not saved — your changes are still here.'); },
    });
  }

  changePassword(): void {
    this.pwError.set('');
    this.pwMsg.set('');
    if (this.pw.next.length < 8) { this.pwError.set('The new password needs at least 8 characters.'); return; }
    if (this.pw.next !== this.pw.confirm) { this.pwError.set('The new passwords don’t match.'); return; }
    this.pwSaving.set(true);
    this.auth.changePassword(this.pw.current, this.pw.next).subscribe({
      next: () => { this.pwSaving.set(false); this.pw = { current: '', next: '', confirm: '' }; this.pwMsg.set('Password changed. Other devices were signed out.'); this.loadSessions(); },
      error: (err) => { this.pwSaving.set(false); this.pwError.set(err.error?.message || 'The password couldn’t be changed.'); },
    });
  }

  loadSessions(): void {
    this.sessionService.list().subscribe({ next: (res) => this.sessions.set(res.data.sessions.filter((s) => !s.revokedAt)), error: () => this.sessions.set([]) });
  }

  revoke(s: AuthSessionInfo): void {
    if (!confirm('Sign this device out?')) return;
    this.sessionService.revoke(s.id).subscribe({ next: () => this.loadSessions(), error: () => this.pwError.set('That device couldn’t be signed out.') });
  }

  device(s: AuthSessionInfo): string {
    const ua = s.userAgent || '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} on ${os}` : browser;
  }
}
