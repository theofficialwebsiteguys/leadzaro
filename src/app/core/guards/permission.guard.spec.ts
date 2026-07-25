import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { requireAnyPermissionGuard } from './permission.guard';
import { OrganizationContextService } from '../services/organization-context.service';

describe('requireAnyPermissionGuard', () => {
  let orgContextSpy: jasmine.SpyObj<OrganizationContextService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    orgContextSpy = jasmine.createSpyObj('OrganizationContextService', ['hasAnyPermission']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: OrganizationContextService, useValue: orgContextSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });
  });

  it('allows activation when the user has one of the required permissions', () => {
    orgContextSpy.hasAnyPermission.and.returnValue(true);
    const guard = requireAnyPermissionGuard(['audit.view', 'invitations.manage']);

    const result = TestBed.runInInjectionContext(() => guard({} as any, {} as any));

    expect(result).toBeTrue();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('redirects to the dashboard and denies activation when the user has none of the required permissions', () => {
    orgContextSpy.hasAnyPermission.and.returnValue(false);
    const guard = requireAnyPermissionGuard(['audit.view']);

    const result = TestBed.runInInjectionContext(() => guard({} as any, {} as any));

    expect(result).toBeFalse();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/app/dashboard']);
  });
});
