export interface CancellationRequest {
  id: string;
  projectId: string;
  initiatedBy: 'client' | 'agency';
  requestedByUserId: string;
  reason: string | null;
  status: 'requested' | 'confirmed' | 'withdrawn';
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  withdrawnByUserId: string | null;
  withdrawnAt: string | null;
  createdAt: string;
}
