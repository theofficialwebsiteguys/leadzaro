export type SalespersonType =
  | 'Website Developer'
  | 'Marketing Agency'
  | 'Roofing Company'
  | 'Real Estate Agent'
  | 'Insurance Agent'
  | 'Local Service Business'
  | 'Cannabis Sales'
  | 'Custom / Other';

export const SALESPERSON_TYPES: SalespersonType[] = [
  'Website Developer',
  'Marketing Agency',
  'Roofing Company',
  'Real Estate Agent',
  'Insurance Agent',
  'Local Service Business',
  'Cannabis Sales',
  'Custom / Other',
];

export interface User {
  id: string;
  name: string;
  email: string;
  companyName?: string;
  salespersonType: SalespersonType;
  targetIndustry?: string;
  serviceArea?: string;
  role: 'user' | 'admin';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  subscription?: UserSubscription;
}

export interface UserSubscription {
  id: string;
  status: 'active' | 'cancelled' | 'expired' | 'trialing';
  currentPeriodEnd: string;
  searchesUsedThisMonth: number;
  leadsUsedTotal: number;
  plan?: SubscriptionPlan;
}

export interface SubscriptionPlan {
  id: string;
  name: 'Free Trial' | 'Starter' | 'Pro' | 'Agency';
  price: number;
  monthlySearches: number;
  savedLeadsLimit: number;
  exportAccess: boolean;
  teamMembers: number;
  advancedFilters: boolean;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  companyName?: string;
  salespersonType: SalespersonType;
  targetIndustry?: string;
  serviceArea?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
