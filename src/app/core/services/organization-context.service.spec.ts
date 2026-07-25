import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { OrganizationContextService } from './organization-context.service';
import { CurrentOrganizationContext } from '../models/organization.model';

describe('OrganizationContextService', () => {
  let service: OrganizationContextService;
  let httpMock: HttpTestingController;

  const mockContext: CurrentOrganizationContext = {
    organization: { id: 'org-1', name: 'Test Org', slug: 'test-org', type: 'agency' },
    membership: { id: 'mem-1', membershipType: 'employee' },
    permissions: ['leads.search', 'leads.read'],
    availableMemberships: [{ organizationId: 'org-1', organizationName: 'Test Org', membershipType: 'employee' }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrganizationContextService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('has no permissions before load() resolves', () => {
    expect(service.hasPermission('leads.search')).toBeFalse();
    expect(service.organization()).toBeNull();
  });

  it('populates organization/membership/permissions after a successful load()', () => {
    let result: boolean | undefined;
    service.load().subscribe((ok) => (result = ok));

    const req = httpMock.expectOne('/api/v1/organizations/current');
    req.flush({ data: mockContext });

    expect(result).toBeTrue();
    expect(service.organization()?.name).toBe('Test Org');
    expect(service.hasPermission('leads.search')).toBeTrue();
    expect(service.hasPermission('invitations.manage')).toBeFalse();
    expect(service.hasAnyPermission(['invitations.manage', 'leads.read'])).toBeTrue();
    expect(service.hasMultipleOrganizations()).toBeFalse();
  });

  it('clears context and resolves false when the request fails (e.g. no active membership)', () => {
    let result: boolean | undefined;
    service.load().subscribe((ok) => (result = ok));

    const req = httpMock.expectOne('/api/v1/organizations/current');
    req.flush({ message: 'No active organization membership' }, { status: 403, statusText: 'Forbidden' });

    expect(result).toBeFalse();
    expect(service.organization()).toBeNull();
    expect(service.hasPermission('leads.search')).toBeFalse();
  });

  it('clear() resets the cached context', () => {
    service.load().subscribe();
    httpMock.expectOne('/api/v1/organizations/current').flush({ data: mockContext });
    expect(service.organization()).not.toBeNull();

    service.clear();
    expect(service.organization()).toBeNull();
    expect(service.activeOrganizationId()).toBeNull();
  });
});
