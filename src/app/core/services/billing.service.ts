import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ConversionAttempt, ConvertResult, PaymentLinkRequest, ProjectBilling, ServicePlan, Subscription,
} from '../models/billing.model';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);

  listServicePlans(): Observable<{ data: { servicePlans: ServicePlan[] } }> {
    return this.http.get<{ data: { servicePlans: ServicePlan[] } }>('/api/v1/billing/service-plans');
  }

  listPaymentLinks(opportunityId: string): Observable<{ data: { paymentLinkRequests: PaymentLinkRequest[] } }> {
    return this.http.get<{ data: { paymentLinkRequests: PaymentLinkRequest[] } }>(`/api/v1/crm/opportunities/${opportunityId}/payment-links`);
  }

  createPaymentLink(opportunityId: string, servicePlanId: string, addOnServicePlanIds: string[] = []): Observable<{ data: { paymentLinkRequest: PaymentLinkRequest } }> {
    return this.http.post<{ data: { paymentLinkRequest: PaymentLinkRequest } }>(`/api/v1/crm/opportunities/${opportunityId}/payment-links`, { servicePlanId, addOnServicePlanIds });
  }

  convertToClient(opportunityId: string, servicePlanId?: string): Observable<{ data: ConvertResult }> {
    return this.http.post<{ data: ConvertResult }>(`/api/v1/crm/opportunities/${opportunityId}/convert`, { servicePlanId });
  }

  listConversionAttempts(status?: string): Observable<{ data: { conversionAttempts: ConversionAttempt[] } }> {
    const url = status ? `/api/v1/billing/conversion-attempts?status=${encodeURIComponent(status)}` : '/api/v1/billing/conversion-attempts';
    return this.http.get<{ data: { conversionAttempts: ConversionAttempt[] } }>(url);
  }

  listSubscriptions(status?: string): Observable<{ data: { subscriptions: Subscription[] } }> {
    const url = status ? `/api/v1/billing/subscriptions?status=${encodeURIComponent(status)}` : '/api/v1/billing/subscriptions';
    return this.http.get<{ data: { subscriptions: Subscription[] } }>(url);
  }

  getProjectBilling(projectId: string): Observable<{ data: { billing: ProjectBilling | null } }> {
    return this.http.get<{ data: { billing: ProjectBilling | null } }>(`/api/v1/projects/${projectId}/billing`);
  }

  getPortalLink(organizationId: string): Observable<{ data: { url: string } }> {
    return this.http.post<{ data: { url: string } }>(`/api/v1/billing/organizations/${organizationId}/portal-link`, {});
  }
}
