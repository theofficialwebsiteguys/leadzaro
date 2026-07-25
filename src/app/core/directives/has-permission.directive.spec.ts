import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HasPermissionDirective } from './has-permission.directive';
import { OrganizationContextService } from '../services/organization-context.service';

@Component({
  standalone: true,
  imports: [HasPermissionDirective],
  template: `
    <div *hasPermission="requiredPermission()" class="gated">Visible</div>
  `,
})
class HostComponent {
  requiredPermission = signal<string | string[]>('invitations.manage');
}

describe('HasPermissionDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let orgContextSpy: jasmine.SpyObj<OrganizationContextService>;

  beforeEach(() => {
    orgContextSpy = jasmine.createSpyObj('OrganizationContextService', ['hasPermission', 'hasAnyPermission']);

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: OrganizationContextService, useValue: orgContextSpy }],
    });

    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders the element when the permission is present', () => {
    orgContextSpy.hasPermission.and.returnValue(true);
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.gated');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('Visible');
  });

  it('does not render the element when the permission is missing', () => {
    orgContextSpy.hasPermission.and.returnValue(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.gated')).toBeNull();
  });

  it('supports an array of permissions ("any of") via hasAnyPermission', () => {
    fixture.componentInstance.requiredPermission.set(['audit.view', 'invitations.manage']);
    orgContextSpy.hasAnyPermission.and.returnValue(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.gated')).not.toBeNull();
    expect(orgContextSpy.hasAnyPermission).toHaveBeenCalledWith(['audit.view', 'invitations.manage']);
  });
});
