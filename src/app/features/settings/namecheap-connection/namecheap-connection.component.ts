import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomainService } from '../../../core/services/domain.service';
import { ConnectionStatus, ConnectionTestResult } from '../../../core/models/domain.model';
import { CentsPipe } from '../../../shared/pipes/cents.pipe';

interface CredentialsForm {
  apiUser: string;
  userName: string;
  apiKey: string;
  clientIp: string;
  environment: 'production' | 'sandbox';
}

const POLL_MS = 3000;

/**
 * Admin-only Namecheap connection (ADR 0009). The API key is write-only:
 * it is sent once to be encrypted server-side and is never shown again.
 * "Connected" appears only after Namecheap has actually answered.
 */
@Component({
  selector: 'app-namecheap-connection',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, CentsPipe],
  templateUrl: './namecheap-connection.component.html',
  styleUrl: './namecheap-connection.component.scss',
})
export class NamecheapConnectionComponent implements OnInit {
  private readonly domainService = inject(DomainService);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<ConnectionStatus | null>(null);
  readonly loadError = signal('');
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly formError = signal('');
  readonly lastTest = signal<ConnectionTestResult | null>(null);
  readonly detecting = signal(false);
  readonly detectedIp = signal<string | null>(null);
  readonly detectError = signal('');
  readonly confirmDisconnect = signal(false);
  form: CredentialsForm = {
    apiUser: '', userName: '', apiKey: '', clientIp: '', environment: 'production',
  };
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly statusLabel = computed(() => {
    const status = this.status();
    if (!status) return 'Loading…';
    if (status.syncing) return 'Syncing…';
    return {
      not_configured: 'Not connected', unverified: 'Not verified yet', connected: 'Connected', error: 'Connection problem',
    }[status.status];
  });

  readonly syncErrors = computed(() => this.status()?.lastSyncSummary?.errors ?? []);

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.domainService.getConnectionStatus().subscribe({
      next: (res) => {
        this.status.set(res.data.connection);
        this.loadError.set('');
        if (!res.data.connection.configured && !this.editing()) this.startEdit();
        if (res.data.connection.syncing) this.schedulePoll();
      },
      error: (err) => this.loadError.set(err.error?.message || 'Could not load the Namecheap connection.'),
    });
  }

  startEdit(): void {
    const status = this.status();
    this.form = {
      apiUser: status?.apiUser ?? '',
      userName: status?.accountUserName && status.accountUserName !== status.apiUser ? status.accountUserName : '',
      apiKey: '',
      clientIp: status?.clientIp ?? '',
      environment: status?.environment ?? 'production',
    };
    this.formError.set('');
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.form.apiKey = '';
    this.editing.set(false);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set('');
    this.lastTest.set(null);
    this.domainService.saveCredentials({
      apiUser: this.form.apiUser.trim(),
      userName: this.form.userName.trim() || undefined,
      apiKey: this.form.apiKey.trim() || undefined,
      clientIp: this.form.clientIp.trim(),
      environment: this.form.environment,
    }).subscribe({
      next: (res) => {
        this.form.apiKey = '';
        this.status.set(res.data.connection);
        this.lastTest.set(res.data.test);
        this.saving.set(false);
        if (res.data.test.ok) this.editing.set(false);
      },
      error: (err) => {
        this.formError.set(err.error?.message || 'The credentials could not be saved.');
        this.saving.set(false);
      },
    });
  }

  test(): void {
    if (this.testing()) return;
    this.testing.set(true);
    this.lastTest.set(null);
    this.domainService.testConnection().subscribe({
      next: (res) => {
        this.status.set(res.data.connection);
        this.lastTest.set(res.data.test);
        this.testing.set(false);
      },
      error: (err) => {
        this.lastTest.set({ ok: false, error: { kind: 'request', message: err.error?.message || 'The test could not run.' } });
        this.testing.set(false);
      },
    });
  }

  syncNow(): void {
    this.domainService.syncNow().subscribe({
      next: (res) => {
        this.status.set(res.data.connection);
        this.schedulePoll();
      },
      error: (err) => this.loadError.set(err.error?.message || 'The sync could not be started.'),
    });
  }

  disconnect(): void {
    this.domainService.disconnect().subscribe({
      next: (res) => {
        this.status.set(res.data.connection);
        this.confirmDisconnect.set(false);
        this.lastTest.set(null);
        this.startEdit();
      },
      error: (err) => this.loadError.set(err.error?.message || 'Could not disconnect.'),
    });
  }

  detectIp(): void {
    this.detecting.set(true);
    this.detectError.set('');
    this.domainService.detectIp().subscribe({
      next: (res) => {
        this.detectedIp.set(res.data.ip);
        if (!this.form.clientIp) this.form.clientIp = res.data.ip;
        this.detecting.set(false);
      },
      error: (err) => {
        this.detectError.set(err.error?.message || 'Could not detect the IP address.');
        this.detecting.set(false);
      },
    });
  }

  useDetectedIp(): void {
    const ip = this.detectedIp();
    if (ip) this.form.clientIp = ip;
  }

  private schedulePoll(): void {
    this.stopPolling();
    this.pollTimer = setTimeout(() => {
      this.domainService.getConnectionStatus().subscribe((res) => {
        this.status.set(res.data.connection);
        if (res.data.connection.syncing) this.schedulePoll();
      });
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
