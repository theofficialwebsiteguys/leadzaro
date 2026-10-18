import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { OrganizationContextService } from './organization-context.service';
import { WorkRole } from '../models/workflow.model';

const KEY = 'lz.workMode';

export const MODE_LABELS: Record<WorkRole, string> = {
  sales: 'Sales', qualifier: 'Qualifying', client_manager: 'Onboarding', admin: 'Admin',
};

/**
 * "Working as" (ADR 0016): someone who holds several roles picks one at a
 * time, and the menu and home page show only that role's work. A display
 * choice only — the server still authorizes every request by permission.
 */
@Injectable({ providedIn: 'root' })
export class WorkModeService {
  private readonly org = inject(OrganizationContextService);
  private readonly chosen = signal<WorkRole | null>(this.read());

  /** The roles this person holds, in the order they're most often worked. */
  readonly available = computed<WorkRole[]>(() => {
    const has = (k: string) => this.org.hasPermission(k);
    const roles: WorkRole[] = [];
    if (has('outreach.send')) roles.push('sales');
    if (has('qualification.work')) roles.push('qualifier');
    if (has('clients.onboard')) roles.push('client_manager');
    if (has('sales.approve_close') || has('team.review_work')) roles.push('admin');
    return roles;
  });

  readonly mode = computed<WorkRole | null>(() => {
    const roles = this.available();
    const chosen = this.chosen();
    return chosen && roles.includes(chosen) ? chosen : roles[0] ?? null;
  });

  constructor() {
    effect(() => {
      const mode = this.chosen();
      try {
        if (mode) localStorage.setItem(KEY, mode);
      } catch { /* storage unavailable — the choice lasts for this page */ }
    });
  }

  set(mode: WorkRole): void {
    this.chosen.set(mode);
  }

  private read(): WorkRole | null {
    try {
      return localStorage.getItem(KEY) as WorkRole | null;
    } catch {
      return null;
    }
  }
}
