import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConversionAttempt, ConvertResult, PaymentLinkRequest, ServicePlan } from '../models/billing.model';

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
}
