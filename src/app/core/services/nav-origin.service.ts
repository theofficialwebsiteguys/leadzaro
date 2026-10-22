import { Injectable } from '@angular/core';

export type OriginKey = 'my-work' | 'leads' | 'conversations';

const LABELS: Record<OriginKey, string> = { 'my-work': 'My Work', leads: 'Leads', conversations: 'Conversations' };
const DEFAULT_URL: Record<OriginKey, string> = { 'my-work': '/app/my-work', leads: '/app/leads', conversations: '/app/outreach' };

/**
 * Where a lead was opened from (ADR 0017), so "back" returns to the same
 * list with its filters — not always to My Work. Kept for the browser
 * session; a direct link or a refresh falls back to the list's plain address.
 */
@Injectable({ providedIn: 'root' })
export class NavOriginService {
  remember(key: OriginKey, url: string): void {
    try { sessionStorage.setItem(`lz.origin.${key}`, url); } catch { /* the plain list address is used instead */ }
  }

  get(key: string | null): { key: OriginKey; label: string; url: string } {
    const k: OriginKey = key === 'leads' || key === 'conversations' ? key : 'my-work';
    let url = DEFAULT_URL[k];
    try { url = sessionStorage.getItem(`lz.origin.${k}`) || url; } catch { /* default */ }
    return { key: k, label: LABELS[k], url };
  }
}
