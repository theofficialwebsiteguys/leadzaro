import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { InvitationAcceptComponent } from './invitation-accept.component';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';

describe('InvitationAcceptComponent', () => {
  let fixture: ComponentFixture<InvitationAcceptComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let router: Router;
  let orgContextSpy: jasmine.SpyObj<OrganizationContextService>;

  function setup(token: string, lookupResult: any, lookupError = false, currentUser: any = null) {
    authSpy = jasmine.createSpyObj('AuthService', ['lookupInvitation', 'acceptInvitation'], {
      currentUser: () => currentUser,
    });
    authSpy.lookupInvitation.and.returnValue(
      lookupError ? throwError(() => ({ error: { message: 'This invitation link is invalid or has expired.' } })) : of({ data: lookupResult })
    );
    orgContextSpy = jasmine.createSpyObj('OrganizationContextService', ['load']);
    orgContextSpy.load.and.returnValue(of(true));

    TestBed.configureTestingModule({
      imports: [InvitationAcceptComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authSpy },
        { provide: OrganizationContextService, useValue: orgContextSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ token }) } },
        },
      ],
    });

    router = TestBed.inject(Router);
    spyOn(router, 'navigate');

    fixture = TestBed.createComponent(InvitationAcceptComponent);
    fixture.detectChanges();
  }

  it('shows an error when no token is present in the URL', () => {
    setup('', null);
    expect(fixture.componentInstance.loadError()).toContain('missing a token');
  });

  it('shows a load error when the invitation lookup fails', () => {
    setup('bad-token', null, true);
    expect(fixture.componentInstance.loadError()).toContain('invalid or has expired');
  });

  it('loads invitation info and requires a password form for a brand-new invitee', () => {
    setup('good-token', {
      email: 'new@example.test', membershipType: 'employee', organizationName: 'The Website Guys', requiresPassword: true,
    });

    expect(fixture.componentInstance.info()?.email).toBe('new@example.test');
    expect(fixture.componentInstance.isLoggedInAsInviteeEmail).toBeFalse();
  });

  it('submits the new-account form and navigates to the dashboard on success', () => {
    setup('good-token', {
      email: 'new@example.test', membershipType: 'employee', organizationName: 'The Website Guys', requiresPassword: true,
    });
    authSpy.acceptInvitation.and.returnValue(of({ data: { token: 'x', user: {} as any } }));

    fixture.componentInstance.form.setValue({ name: 'New Person', password: 'LongEnoughPass1!' });
    fixture.componentInstance.submitNewAccount();

    expect(authSpy.acceptInvitation).toHaveBeenCalledWith({ token: 'good-token', name: 'New Person', password: 'LongEnoughPass1!' });
    expect(router.navigate).toHaveBeenCalledWith(['/app/dashboard']);
  });

  it('recognizes an already-authenticated user whose email matches the invitation', () => {
    setup('good-token', {
      email: 'existing@example.test', membershipType: 'employee', organizationName: 'The Website Guys', requiresPassword: false,
    }, false, { email: 'existing@example.test' });

    expect(fixture.componentInstance.isLoggedInAsInviteeEmail).toBeTrue();
  });
});
