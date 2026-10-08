import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings.service';
import { NotificationCategory, NotificationSettings } from '../../../core/models/settings.model';
import { HasUnsavedChanges, Snapshot } from '../unsaved-changes.guard';

/**
 * Notifications (ADR 0012): only events Leadzaro actually sends to you,
 * and only channels that work. Switching one off really stops it — muted
 * in-app notifications aren't created and muted email isn't sent.
 */
@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>Notifications</h2><p>Choose what Leadzaro tells you about. These settings are yours alone.</p></div>
      @if (loadError()) { <div class="alert alert-error">{{ loadError() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @else if (!data()) { <div class="loading-state"><div class="spinner"></div></div> }
      @else {
        @let d = data()!;
        <form class="set-card" (ngSubmit)="save()">
          <div class="set-card-head"><div><h3>What you’re notified about</h3>
            <p>In-app notifications appear under the bell. @if (d.emailAvailable) { Email goes to {{ d.emailTo }}. } @else { Email delivery isn’t connected yet, so only in-app notifications are sent. }</p></div>
            <span class="scope-tag personal">Only you</span></div>
          <div class="set-card-body">
            <table class="notif">
              <thead><tr><th scope="col">Event</th><th scope="col">In app</th><th scope="col">Email</th></tr></thead>
              @for (group of groups(); track group.name) {
                <tbody>
                  <tr class="group"><th colspan="3" scope="rowgroup">{{ group.name }}</th></tr>
                  @for (c of group.items; track c.key) {
                    <tr>
                      <td>{{ c.label }}</td>
                      <td><label class="switch"><input type="checkbox" [(ngModel)]="c.inApp" [name]="c.key + '-app'" [attr.aria-label]="c.label + ' in app'" /><span></span></label></td>
                      <td>
                        @if (c.email !== null) {
                          <label class="switch"><input type="checkbox" [(ngModel)]="c.email" [name]="c.key + '-email'" [disabled]="!d.emailAvailable" [attr.aria-label]="c.label + ' by email'" /><span></span></label>
                        } @else { <span class="text-xs text-muted">In app only</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              }
            </table>
            <p class="form-hint">Daily or weekly digests aren’t available yet — notifications arrive as they happen.</p>
          </div>
          <div class="set-actions">
            @if (dirty()) { <span class="dirty">Unsaved changes</span> } @else if (message()) { <span class="saved" role="status">{{ message() }}</span> }
            @if (error()) { <span class="form-error" role="alert">{{ error() }}</span> }
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset()" [disabled]="!dirty()">Discard</button>
            <button type="submit" class="btn btn-primary btn-sm" [disabled]="!dirty() || saving()">{{ saving() ? 'Saving…' : 'Save notifications' }}</button>
          </div>
        </form>
      }
    </section>
  `,
  styles: [`
    .notif { width: 100%; font-size: .85rem;
      th { text-align: left; font-size: .72rem; text-transform: uppercase; color: var(--text-muted); padding: 6px 8px; }
      th:not(:first-child), td:not(:first-child) { width: 90px; text-align: center; }
      td { padding: 9px 8px; border-top: 1px solid var(--border-light); }
      .group th { padding-top: 16px; color: var(--primary-dark); background: none; }
    }
  `],
})
export class NotificationSettingsComponent implements OnInit, HasUnsavedChanges {
  private readonly settings = inject(SettingsService);

  readonly data = signal<NotificationSettings | null>(null);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  private readonly snapshot = new Snapshot<NotificationCategory[]>();

  readonly groups = computed(() => {
    const map = new Map<string, NotificationCategory[]>();
    for (const c of this.data()?.categories ?? []) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set('');
    this.settings.notifications().subscribe({
      next: (d) => this.apply(d),
      error: (err) => this.loadError.set(err.error?.message || 'Notification settings couldn’t be loaded.'),
    });
  }

  private apply(d: NotificationSettings): void {
    this.data.set(d);
    this.snapshot.set(d.categories);
  }

  dirty(): boolean {
    const d = this.data();
    return Boolean(d) && this.snapshot.isDirty(d!.categories);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  reset(): void {
    this.load();
  }

  save(): void {
    const d = this.data();
    if (!d) return;
    this.saving.set(true);
    this.error.set('');
    this.settings.updateNotifications(d.categories.map((c) => ({ key: c.key, inApp: c.inApp, ...(c.email === null ? {} : { email: c.email }) }))).subscribe({
      next: (res) => { this.saving.set(false); this.apply(res); this.message.set('Notification settings saved.'); },
      error: (err) => { this.saving.set(false); this.error.set(err.error?.message || 'Not saved — your choices are still here.'); },
    });
  }
}
