export interface ServicePlan {
  id: string;
  key: string;
  name: string;
  priceType: 'recurring' | 'one_time';
  amountCents: number;
  billingInterval?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PaymentLinkRequest {
  id: string;
  opportunityId: string;
  servicePlanId: string;
  addOnServicePlanIds: string[];
  stripePaymentLinkId?: string | null;
  stripePaymentLinkUrl?: string | null;
  status: string;
  createdAt: string;
  servicePlan?: ServicePlan;
}

export interface ConversionAttempt {
  id: string;
  opportunityId: string | null;
  agencyOrganizationId: string | null;
  source: 'webhook' | 'manual';
  status: 'completed' | 'needs_attention' | 'failed';
  failureReason?: string | null;
  resultingClientOrganizationId?: string | null;
  createdAt: string;
}

export interface ConvertResult {
  conversionAttempt: ConversionAttempt;
  alreadyConverted: boolean;
}
