import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { AuthResponse, LoginPayload, RegisterPayload, User } from '../models/user.model';

interface ImpersonationInfo {
  reason: string;
  organization: { id: string; name: string };
}

/**
 * Phase 1 session model: a short-lived access token held only in memory
 * (never localStorage) plus an HttpOnly refresh cookie the browser
 * already carries automatically. `bootstrap()` silently exchanges that
 * cookie for a fresh access token on app start so a page reload doesn't
 * log the user out, without ever persisting a long-lived token client-side.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private accessToken = signal<string | null>(null);
  currentUser = signal<User | null>(null);
  isAuthenticated = computed(() => !!this.currentUser());

  impersonation = signal<ImpersonationInfo | null>(null);
  private preImpersonationState: { token: string; user: User } | null = null;

  /** Called once at app startup (see app.config.ts). Never throws. */
  bootstrap(): Observable<boolean> {
    return this.http
      .post<{ data: AuthResponse }>('/api/v1/auth/refresh', {}, { withCredentials: true })
      .pipe(
        tap((res) => this.setSession(res.data.token, res.data.user)),
        map(() => true),
        catchError(() => of(false))
      );
  }

  register(payload: RegisterPayload): Observable<{ data: AuthResponse }> {
    return this.http
      .post<{ data: AuthResponse }>('/api/v1/auth/register', payload, { withCredentials: true })
      .pipe(tap((res) => this.setSession(res.data.token, res.data.user)));
  }

  login(payload: LoginPayload): Observable<{ data: AuthResponse }> {
    return this.http
      .post<{ data: AuthResponse }>('/api/v1/auth/login', payload, { withCredentials: true })
      .pipe(tap((res) => this.setSession(res.data.token, res.data.user)));
  }

  acceptInvitation(payload: { token: string; name?: string; password?: string }): Observable<{ data: AuthResponse }> {
    return this.http
      .post<{ data: AuthResponse }>('/api/v1/invitations/accept', payload, { withCredentials: true })
      .pipe(tap((res) => this.setSession(res.data.token, res.data.user)));
  }

  lookupInvitation(token: string): Observable<{ data: { email: string; membershipType: string; organizationName: string; requiresPassword: boolean } }> {
    return this.http.get<{ data: any }>(`/api/v1/invitations/lookup?token=${encodeURIComponent(token)}`);
  }

  /** Raw refresh call used by the interceptor to retry after a 401. */
  refreshAccessToken(): Observable<string> {
    return this.http
      .post<{ data: AuthResponse }>('/api/v1/auth/refresh', {}, { withCredentials: true })
      .pipe(
        tap((res) => this.setSession(res.data.token, res.data.user)),
        map((res) => res.data.token)
      );
  }

  getMe(): Observable<{ data: { user: User } }> {
    return this.http.get<{ data: { user: User } }>('/api/v1/auth/me').pipe(
      tap((res) => this.currentUser.set(res.data.user))
    );
  }

  updateProfile(payload: Partial<User>): Observable<{ data: { user: User } }> {
    return this.http.put<{ data: { user: User } }>('/api/v1/auth/profile', payload).pipe(
      tap((res) => this.currentUser.set(res.data.user))
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<unknown> {
    return this.http.put('/api/v1/auth/password', { currentPassword, newPassword });
  }

  requestPasswordReset(email: string): Observable<unknown> {
    return this.http.post('/api/v1/auth/password-reset/request', { email });
  }

  confirmPasswordReset(token: string, newPassword: string): Observable<unknown> {
    return this.http.post('/api/v1/auth/password-reset/confirm', { token, newPassword });
  }

  requestEmailVerification(): Observable<unknown> {
    return this.http.post('/api/v1/auth/email-verification/request', {});
  }

  startImpersonation(membershipId: string, reason: string): Observable<void> {
    return this.http
      .post<{ data: { token: string; user: User; impersonation: ImpersonationInfo } }>(
        '/api/v1/impersonation/start',
        { membershipId, reason }
      )
      .pipe(
        tap((res) => {
          const token = this.accessToken();
          const user = this.currentUser();
          if (token && user) this.preImpersonationState = { token, user };
          this.accessToken.set(res.data.token);
          this.currentUser.set(res.data.user);
          this.impersonation.set(res.data.impersonation);
        }),
        map(() => undefined)
      );
  }

  endImpersonation(): Observable<void> {
    return this.http.post('/api/v1/impersonation/end', {}).pipe(
      tap(() => {
        if (this.preImpersonationState) {
          this.accessToken.set(this.preImpersonationState.token);
          this.currentUser.set(this.preImpersonationState.user);
          this.preImpersonationState = null;
        }
        this.impersonation.set(null);
      }),
      map(() => undefined)
    );
  }

  logout(): void {
    this.http.post('/api/v1/auth/logout', {}, { withCredentials: true }).subscribe({
      complete: () => this.finishLogout(),
      error: () => this.finishLogout(),
    });
  }

  private finishLogout(): void {
    this.accessToken.set(null);
    this.currentUser.set(null);
    this.impersonation.set(null);
    this.preImpersonationState = null;
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.accessToken();
  }

  private setSession(token: string, user: User): void {
    this.accessToken.set(token);
    this.currentUser.set(user);
  }
}
