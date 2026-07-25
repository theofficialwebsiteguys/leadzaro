export type MembershipType = 'employee' | 'client';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  type: 'agency' | 'client' | 'prospect';
}

export interface CurrentMembership {
  id: string;
  membershipType: MembershipType;
  title?: string | null;
}

export interface AvailableMembership {
  organizationId: string;
  organizationName: string;
  membershipType: MembershipType;
}

export interface CurrentOrganizationContext {
  organization: OrganizationSummary;
  membership: CurrentMembership;
  permissions: string[];
  availableMemberships: AvailableMembership[];
}

export interface Member {
  id: string;
  organizationId: string;
  userId: string;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  membershipType: MembershipType;
  title?: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string; isActive: boolean };
  roles?: { id: string; key: string; name: string }[];
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  membershipType: MembershipType;
  roleKeys: string[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface AuthSessionInfo {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  lastSeenAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  data?: unknown;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  id: string;
  category: string;
  channel: 'in_app' | 'email';
  frequency: 'immediate' | 'daily' | 'weekly' | 'muted';
}

export interface AuditLogEntry {
  id: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
}
