import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { OrganizationContextService } from './core/services/organization-context.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // paramsInheritanceStrategy: 'always' lets a project tab route (e.g.
    // projects/:projectId/tasks) read the parent's :projectId from its own
    // ActivatedRoute.paramMap, needed by the project shell below.
    provideRouter(routes, withViewTransitions(), withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Silently exchanges the HttpOnly refresh cookie (if any) for an
    // in-memory access token before the router activates any guard, so a
    // page reload restores the session without ever having stored a
    // privileged token in localStorage.
    provideAppInitializer(async () => {
      const auth = inject(AuthService);
      const orgContext = inject(OrganizationContextService);
      const authenticated = await firstValueFrom(auth.bootstrap());
      if (authenticated) {
        await firstValueFrom(orgContext.load());
      }
    }),
  ],
};
