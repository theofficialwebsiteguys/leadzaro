import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { SALESPERSON_TYPES } from '../../core/models/user.model';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [ReactiveFormsModule, SlicePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  auth = inject(AuthService);

  readonly salespersonTypes = SALESPERSON_TYPES;

  profileSaving = signal(false);
  profileMsg = signal('');
  pwSaving = signal(false);
  pwMsg = signal('');
  pwError = signal('');

  profileForm = this.fb.group({
    name: ['', [Validators.required]],
    companyName: [''],
    salespersonType: ['', Validators.required],
    targetIndustry: [''],
    serviceArea: [''],
  });

  pwForm = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  ngOnInit() {
    const u = this.auth.currentUser();
    if (u) {
      this.profileForm.patchValue({
        name: u.name,
        companyName: u.companyName || '',
        salespersonType: u.salespersonType,
        targetIndustry: u.targetIndustry || '',
        serviceArea: u.serviceArea || '',
      });
    }
  }

  saveProfile() {
    if (this.profileForm.invalid || this.profileSaving()) return;
    this.profileSaving.set(true);
    this.profileMsg.set('');

    const v = this.profileForm.value;
    this.auth.updateProfile({
      name: v.name ?? undefined,
      companyName: v.companyName ?? undefined,
      salespersonType: (v.salespersonType ?? undefined) as any,
      targetIndustry: v.targetIndustry ?? undefined,
      serviceArea: v.serviceArea ?? undefined,
    }).subscribe({
      next: () => { this.profileMsg.set('Profile updated successfully.'); this.profileSaving.set(false); },
      error: () => { this.profileMsg.set('Failed to update profile.'); this.profileSaving.set(false); },
    });
  }

  changePassword() {
    if (this.pwForm.invalid || this.pwSaving()) return;
    this.pwSaving.set(true);
    this.pwMsg.set('');
    this.pwError.set('');

    const v = this.pwForm.value;
    this.auth.changePassword(v.currentPassword ?? '', v.newPassword ?? '').subscribe({
      next: () => { this.pwMsg.set('Password changed successfully.'); this.pwForm.reset(); this.pwSaving.set(false); },
      error: (err) => { this.pwError.set(err.error?.message || 'Failed to change password.'); this.pwSaving.set(false); },
    });
  }
}
