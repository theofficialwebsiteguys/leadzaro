import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { SALESPERSON_TYPES } from '../../../core/models/user.model';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly salespersonTypes = SALESPERSON_TYPES;

  step = signal(1);
  loading = signal(false);
  errorMsg = signal('');
  showPassword = signal(false);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    salespersonType: ['Website Developer', Validators.required],
    companyName: [''],
    targetIndustry: [''],
    serviceArea: [''],
  });

  get name() { return this.form.get('name')!; }
  get email() { return this.form.get('email')!; }
  get password() { return this.form.get('password')!; }
  get salespersonType() { return this.form.get('salespersonType')!; }

  nextStep() {
    if (this.name.invalid || this.email.invalid || this.password.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.step.set(2);
  }

  submit() {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.errorMsg.set('');

    const val = this.form.value;
    this.auth.register({
      name: val.name!,
      email: val.email!,
      password: val.password!,
      salespersonType: val.salespersonType as any,
      companyName: val.companyName || undefined,
      targetIndustry: val.targetIndustry || undefined,
      serviceArea: val.serviceArea || undefined,
    }).subscribe({
      next: () => this.router.navigate(['/app/dashboard']),
      error: (err) => {
        this.errorMsg.set(err.error?.message || 'Registration failed. Please try again.');
        this.loading.set(false);
      },
    });
  }
}
