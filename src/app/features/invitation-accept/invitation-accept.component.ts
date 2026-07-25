import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';

@Component({
  selector: 'app-invitation-accept',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './invitation-accept.component.html',
  styleUrl: './invitation-accept.component.scss',
})
export class InvitationAcceptComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  auth = inject(AuthService);
  private readonly orgContext = inject(OrganizationContextService);

  token = '';
  loading = signal(true);
  loadError = signal('');
  submitting = signal(false);
  submitError = signal('');

  info = signal<{ email: string; membershipType: string; organizationName: string; requiresPassword: boolean } | null>(null);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  get isLoggedInAsInviteeEmail(): boolean {
    const user = this.auth.currentUser();
    return !!user && !!this.info() && user.email.toLowerCase() === this.info()!.email.toLowerCase();
  }

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.loadError.set('This invitation link is missing a token.');
      this.loading.set(false);
      return;
    }

    this.auth.lookupInvitation(this.token).subscribe({
      next: (res) => { this.info.set(res.data); this.loading.set(false); },
      error: (err) => {
        this.loadError.set(err.error?.message || 'This invitation link is invalid or has expired.');
        this.loading.set(false);
      },
    });
  }

  submitNewAccount() {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set('');

    this.auth.acceptInvitation({
      token: this.token,
      name: this.form.value.name!,
      password: this.form.value.password!,
    }).subscribe({
      next: () => this.orgContext.load().subscribe(() => this.router.navigate(['/app/dashboard'])),
      error: (err) => {
        this.submitError.set(err.error?.message || 'Failed to accept invitation.');
        this.submitting.set(false);
      },
    });
  }

  acceptAsCurrentUser() {
    this.submitting.set(true);
    this.submitError.set('');
    this.auth.acceptInvitation({ token: this.token }).subscribe({
      next: () => this.orgContext.load().subscribe(() => this.router.navigate(['/app/dashboard'])),
      error: (err) => {
        this.submitError.set(err.error?.message || 'Failed to accept invitation.');
        this.submitting.set(false);
      },
    });
  }
}
