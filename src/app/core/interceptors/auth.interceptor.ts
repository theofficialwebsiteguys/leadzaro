import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { OrganizationContextService } from '../services/organization-context.service';

const AUTH_RETRY_EXEMPT = ['/api/v1/auth/refresh', '/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/invitations/accept'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const orgContext = inject(OrganizationContextService);
  const router = inject(Router);

  const token = auth.getToken();
  const activeOrgId = orgContext.activeOrganizationId();

  let authedReq = req.clone({
    withCredentials: true,
    setHeaders: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(activeOrgId ? { 'X-Organization-Id': activeOrgId } : {}),
    },
  });

  const isExempt = AUTH_RETRY_EXEMPT.some((path) => req.url.startsWith(path));

  return next(authedReq).pipe(
    catchError((err) => {
      // Exempt endpoints (the silent bootstrap refresh chief among them)
      // 401 as their normal, expected outcome for a logged-out visitor —
      // that must never force a logout/redirect, or every public page
      // (landing, login, register, accept-invite, a shared audit report)
      // would bounce an anonymous visitor to /login on every load.
      if (err.status === 401 && isExempt) {
        return throwError(() => err);
      }

      if (err.status === 401 && token) {
        return auth.refreshAccessToken().pipe(
          switchMap((newToken) => {
            authedReq = req.clone({
              withCredentials: true,
              setHeaders: {
                Authorization: `Bearer ${newToken}`,
                ...(activeOrgId ? { 'X-Organization-Id': activeOrgId } : {}),
              },
            });
            return next(authedReq);
          }),
          catchError((refreshErr) => {
            auth.logout();
            router.navigate(['/login']);
            return throwError(() => refreshErr);
          })
        );
      }

      if (err.status === 401) {
        auth.logout();
        router.navigate(['/login']);
      }

      return throwError(() => err);
    })
  );
};
