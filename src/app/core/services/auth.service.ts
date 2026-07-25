import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse, LoginPayload, RegisterPayload, User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly TOKEN_KEY = 'lz_token';
  private readonly USER_KEY = 'lz_user';

  private http = inject(HttpClient);
  private router = inject(Router);

  currentUser = signal<User | null>(this.getStoredUser());
  isAuthenticated = computed(() => !!this.currentUser());

  register(payload: RegisterPayload): Observable<{ data: AuthResponse }> {
    return this.http.post<{ data: AuthResponse }>('/api/auth/register', payload).pipe(
      tap((res) => this.setSession(res.data.token, res.data.user))
    );
  }

  login(payload: LoginPayload): Observable<{ data: AuthResponse }> {
    return this.http.post<{ data: AuthResponse }>('/api/auth/login', payload).pipe(
      tap((res) => this.setSession(res.data.token, res.data.user))
    );
  }

  getMe(): Observable<{ data: { user: User } }> {
    return this.http.get<{ data: { user: User } }>('/api/auth/me').pipe(
      tap((res) => {
        this.currentUser.set(res.data.user);
        localStorage.setItem(this.USER_KEY, JSON.stringify(res.data.user));
      })
    );
  }

  updateProfile(payload: Partial<User>): Observable<{ data: { user: User } }> {
    return this.http.put<{ data: { user: User } }>('/api/auth/profile', payload).pipe(
      tap((res) => {
        this.currentUser.set(res.data.user);
        localStorage.setItem(this.USER_KEY, JSON.stringify(res.data.user));
      })
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<unknown> {
    return this.http.put('/api/auth/password', { currentPassword, newPassword });
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  private setSession(token: string, user: User): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  private getStoredUser(): User | null {
    try {
      const raw = localStorage.getItem(this.USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
