import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { OrganizationContextService } from '../services/organization-context.service';

/**
 * Structural directive mirroring *ngIf, gated on the current org context's
 * permission set. UI convenience only — the server is the real
 * authorization boundary (see OrganizationContextService doc comment).
 *
 * Usage: `<button *hasPermission="'invitations.manage'">Invite</button>`
 * or with an array for "any of": `*hasPermission="['a','b']"`.
 */
@Directive({
  selector: '[hasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private org = inject(OrganizationContextService);
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);

  private hasView = false;

  hasPermission = input.required<string | string[]>();

  constructor() {
    effect(() => {
      const keys = this.hasPermission();
      const allowed = Array.isArray(keys)
        ? this.org.hasAnyPermission(keys)
        : this.org.hasPermission(keys);

      if (allowed && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!allowed && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
