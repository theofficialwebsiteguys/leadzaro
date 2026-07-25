import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private orgContext = inject(OrganizationContextService);

  loading = signal(false);
  errorMsg = signal('');
  showPassword = signal(false);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  get email() { return this.form.get('email')!; }
  get password() { return this.form.get('password')!; }

  submit() {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    this.auth.login({ email: this.email.value!, password: this.password.value! }).subscribe({
      next: () => {
        const inviteToken = this.route.snapshot.queryParamMap.get('inviteToken');
        this.orgContext.load().subscribe(() => {
          if (inviteToken) {
            this.router.navigate(['/accept-invite'], { queryParams: { token: inviteToken } });
          } else {
            this.router.navigate(['/app/dashboard']);
          }
        });
      },
      error: (err) => {
        this.errorMsg.set(err.error?.message || 'Login failed. Please try again.');
        this.loading.set(false);
      },
    });
  }
}
