import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ClientService } from '../../../core/services/client.service';
import { BillingService } from '../../../core/services/billing.service';
import { SalesService } from '../../../core/services/sales.service';
import { BillingSummary } from '../../../core/models/sales.model';
import { MoneyPipe } from '../../sales/shared/sales-format';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import {
  BILLING_FREQUENCIES, BILLING_FREQUENCY_LABELS, BillingFrequency, LinkEntry, PAYMENT_STATUSES, PaymentStatus,
} from '../../../core/models/client.model';
import { CentsPipe } from '../../../shared/pipes/cents.pipe';
import { LabelPipe } from '../../../shared/pipes/label.pipe';
import { HostPipe } from '../../../shared/pipes/host.pipe';
import { ClientStore } from '../client.store';
import { ClientStripeLinkComponent } from './client-stripe-link.component';
import { LinkListEditorComponent } from '../link-list-editor/link-list-editor.component';
import {
  centsToDollars, dollarsToCents, frequencySuffix, monthlyEquivalentCents,
} from '../client-format';

interface BillingForm {
  setupPrice: string;
  recurringPrice: string;
  billingFrequency: BillingFrequency | '';
  paymentStatus: PaymentStatus | '';
  billingNotes: string;
  internalMonthlyCost: string;
  internalCostNotes: string;
}

@Component({
  selector: 'app-client-billing',
  standalone: true,
  imports: [FormsModule, DatePipe, CentsPipe, LabelPipe, HostPipe, LinkListEditorComponent, MoneyPipe, ClientStripeLinkComponent],
  templateUrl: './client-billing.component.html',
  styleUrl: './client-billing.component.scss',
})
export class ClientBillingComponent {
  readonly store = inject(ClientStore);
  private readonly clientService = inject(ClientService);
  private readonly billingService = inject(BillingService);
  private readonly sales = inject(SalesService);

  /** Payments recorded by the sales workflow and, on refresh, Stripe invoices (ADR 0011). */
  readonly salesBilling = signal<BillingSummary | null>(null);
  readonly salesBillingBusy = signal(false);
  readonly salesBillingError = signal('');

  loadSalesBilling(live: boolean) {
    this.salesBillingBusy.set(true);
    this.salesBillingError.set('');
    this.sales.billing(this.store.clientId, live).subscribe({
      next: (b) => { this.salesBilling.set(b); this.salesBillingBusy.set(false); },
      error: (err) => { this.salesBillingBusy.set(false); this.salesBillingError.set(err.error?.message || 'Payment history could not be loaded.'); },
    });
  }
  readonly org = inject(OrganizationContextService);

  readonly frequencies = BILLING_FREQUENCIES;
  readonly frequencyLabels = BILLING_FREQUENCY_LABELS;
  readonly paymentStatuses = PAYMENT_STATUSES;
  readonly frequencySuffix = frequencySuffix;

  readonly profile = computed(() => this.store.detail()!.profile);
  readonly stripe = computed(() => this.store.detail()?.stripe ?? null);
  readonly canEdit = computed(() => this.org.hasPermission('projects.manage'));
  /** The API only sends our costs to people who manage projects. */
  readonly showInternals = computed(() => !!this.store.detail()?.canSeeInternals);

  readonly clientPaysSet = computed(() => {
    const p = this.profile();
    return p.setupPriceCents !== null || p.recurringPriceCents !== null || p.paymentStatus !== null || p.billingLinks.length > 0 || !!p.billingNotes;
  });
  readonly costSet = computed(() => (this.profile().internalMonthlyCostCents ?? null) !== null || !!this.profile().internalCostNotes);

  readonly monthlyRevenue = computed(() => monthlyEquivalentCents(this.profile().recurringPriceCents, this.profile().billingFrequency));
  readonly monthlyMargin = computed(() => {
    const revenue = this.monthlyRevenue();
    const cost = this.profile().internalMonthlyCostCents ?? null;
    return revenue !== null && cost !== null ? revenue - cost : null;
  });

  editing = signal(false);
  saving = signal(false);
  error = signal('');
  portalError = signal('');
  openingPortal = signal(false);
  form: BillingForm = this.fromProfile();
  links = signal<LinkEntry[]>([]);

  constructor() {
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('edit') && this.canEdit()) this.startEdit();
    // Payments recorded in Leadzaro load straight away; Stripe itself is only read on Refresh.
    this.loadSalesBilling(false);
  }

  private fromProfile(): BillingForm {
    const p = this.store.detail()?.profile;
    return {
      setupPrice: centsToDollars(p?.setupPriceCents ?? null),
      recurringPrice: centsToDollars(p?.recurringPriceCents ?? null),
      billingFrequency: p?.billingFrequency ?? '',
      paymentStatus: p?.paymentStatus ?? '',
      billingNotes: p?.billingNotes ?? '',
      internalMonthlyCost: centsToDollars(p?.internalMonthlyCostCents ?? null),
      internalCostNotes: p?.internalCostNotes ?? '',
    };
  }

  startEdit() {
    this.form = this.fromProfile();
    this.links.set((this.store.detail()?.profile.billingLinks ?? []).map((link) => ({ ...link })));
    this.error.set('');
    this.editing.set(true);
  }

  async save() {
    if (this.saving()) return;
    const setupPriceCents = dollarsToCents(this.form.setupPrice);
    const recurringPriceCents = dollarsToCents(this.form.recurringPrice);
    const internalMonthlyCostCents = dollarsToCents(this.form.internalMonthlyCost);
    if ([setupPriceCents, recurringPriceCents, internalMonthlyCostCents].some((value) => Number.isNaN(value))) {
      this.error.set('Prices must be numbers, e.g. 99 or 1499.50');
      return;
    }
    if (recurringPriceCents !== null && !this.form.billingFrequency) {
      this.error.set('Choose how often the recurring price is billed.');
      return;
    }

    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.clientService.update(this.store.clientId, {
        setupPriceCents,
        recurringPriceCents,
        billingFrequency: this.form.billingFrequency || null,
        paymentStatus: this.form.paymentStatus || null,
        billingNotes: this.form.billingNotes,
        billingLinks: this.links(),
        internalMonthlyCostCents,
        internalCostNotes: this.form.internalCostNotes,
      }));
      await this.store.refresh();
      this.editing.set(false);
    } catch (err) {
      this.error.set((err as { error?: { message?: string } })?.error?.message || 'Billing could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }

  openStripePortal() {
    this.openingPortal.set(true);
    this.portalError.set('');
    this.billingService.getPortalLink(this.store.clientId).subscribe({
      next: (res) => {
        this.openingPortal.set(false);
        window.open(res.data.url, '_blank', 'noopener');
      },
      error: (err) => {
        this.openingPortal.set(false);
        this.portalError.set(err.error?.message || 'The Stripe billing portal could not be opened.');
      },
    });
  }
}
