import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OrganizationContextService } from '../services/organization-context.service';

/**
 * UI-convenience route gate only — mirrors HasPermissionDirective. The
 * server is the real authorization boundary; this only prevents a user
 * without any admin permission from landing on a mostly-empty screen.
 */
export function requireAnyPermissionGuard(keys: string[]): CanActivateFn {
  return () => {
    const orgContext = inject(OrganizationContextService);
    const router = inject(Router);

    if (orgContext.hasAnyPermission(keys)) return true;

    router.navigate(['/app/dashboard']);
    return false;
  };
}
