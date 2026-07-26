import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: Router;
  let authService: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    authService = TestBed.inject(AuthService);
    spyOn(router, 'navigate');
    // logout() itself fires a POST /api/v1/auth/logout — irrelevant to what
    // these tests verify (the interceptor's redirect decision), and it
    // would otherwise leave an unflushed request for httpMock.verify().
    spyOn(authService, 'logout');
  });

  afterEach(() => httpMock.verify());

  it('does not force a logout/redirect when an exempt endpoint 401s — this is the silent bootstrap refresh 401ing for every anonymous visitor to a public page', () => {
    let errorStatus: number | undefined;
    http.post('/api/v1/auth/refresh', {}).subscribe({ error: (err) => { errorStatus = err.status; } });

    httpMock.expectOne('/api/v1/auth/refresh')
      .flush({ message: 'No session' }, { status: 401, statusText: 'Unauthorized' });

    expect(errorStatus).toBe(401);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('redirects to /login when a non-exempt request 401s with no access token present', () => {
    http.get('/api/v1/crm/opportunities').subscribe({ error: () => {} });

    httpMock.expectOne('/api/v1/crm/opportunities')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('attempts a silent token refresh when a non-exempt request 401s with a token present, and redirects to /login only if that refresh itself fails', () => {
    authService.login({ email: 't@example.test', password: 'irrelevant' }).subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({
      data: { token: 'fake-token', user: { id: 'u1', name: 'Test User', email: 't@example.test' } },
    });

    http.get('/api/v1/crm/opportunities').subscribe({ error: () => {} });
    httpMock.expectOne('/api/v1/crm/opportunities')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    // The interceptor attempts a silent refresh before giving up...
    expect(router.navigate).not.toHaveBeenCalled();
    httpMock.expectOne('/api/v1/auth/refresh')
      .flush({ message: 'Refresh failed' }, { status: 401, statusText: 'Unauthorized' });

    // ...and only redirects once that refresh itself fails.
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
