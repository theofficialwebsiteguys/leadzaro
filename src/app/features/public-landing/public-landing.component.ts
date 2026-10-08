import { PhoneInputDirective } from '../../shared/forms/formatted-inputs';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InboundLeadService } from '../../core/services/inbound-lead.service';
import { InboundCampaign, getInboundCampaign } from '../../core/models/inbound.model';

@Component({
  selector: 'app-public-landing',
  standalone: true,
  imports: [ReactiveFormsModule, PhoneInputDirective],
  templateUrl: './public-landing.component.html',
  styleUrl: './public-landing.component.scss',
})
export class PublicLandingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly inboundLeadService = inject(InboundLeadService);

  campaign = signal<InboundCampaign | null>(null);
  submitting = signal(false);
  submitted = signal(false);
  submitError = signal('');

  form = this.fb.group({
    businessName: [''],
    contactName: ['', [Validators.required, Validators.maxLength(150)]],
    contactEmail: ['', [Validators.email]],
    contactPhone: [''],
    message: [''],
    website: [''], // honeypot — must stay empty
  });

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.campaign.set(getInboundCampaign(slug));
  }

  submit() {
    const campaign = this.campaign();
    if (!campaign || this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.submitError.set('');

    this.inboundLeadService.submit({
      landingPageSlug: campaign.slug,
      businessName: this.form.value.businessName || undefined,
      contactName: this.form.value.contactName!,
      contactEmail: this.form.value.contactEmail || undefined,
      contactPhone: this.form.value.contactPhone || undefined,
      message: this.form.value.message || undefined,
      website: this.form.value.website || undefined,
      ...this.inboundLeadService.captureAttribution(),
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        this.submitError.set(err.error?.message || 'Something went wrong — please try again.');
      },
    });
  }
}
