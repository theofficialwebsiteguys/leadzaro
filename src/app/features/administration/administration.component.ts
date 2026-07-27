import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { MembershipService } from '../../core/services/membership.service';
import { InvitationService } from '../../core/services/invitation.service';
import { SessionService } from '../../core/services/session.service';
import { AuditService } from '../../core/services/audit.service';
import { RoleService, RoleOption } from '../../core/services/role.service';
import { AuthService } from '../../core/services/auth.service';
import { ImpersonationCandidateService, ImpersonationCandidate } from '../../core/services/impersonation.service';
import { Member, Invitation, AuthSessionInfo, AuditLogEntry, MembershipType } from '../../core/models/organization.model';
import { SectionDefinitionService } from '../../core/services/sectionDefinition.service';
import { DesignSystemTemplateService } from '../../core/services/designSystemTemplate.service';
import { SectionDefinition } from '../../core/models/sectionDefinition.model';
import { DesignSystemTemplate } from '../../core/models/designSystemTemplate.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';
import { IconComponent } from '../../shared/icon/icon.component';

type Tab = 'members' | 'invitations' | 'sessions' | 'audit' | 'impersonation' | 'library';

@Component({
  selector: 'app-administration',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, IconComponent],
  templateUrl: './administration.component.html',
  styleUrl: './administration.component.scss',
})
export class AdministrationComponent implements OnInit {
  private readonly membershipService = inject(MembershipService);
  private readonly invitationService = inject(InvitationService);
  private readonly sessionService = inject(SessionService);
  private readonly auditService = inject(AuditService);
  private readonly roleService = inject(RoleService);
  private readonly impersonationCandidateService = inject(ImpersonationCandidateService);
  private readonly sectionDefinitionService = inject(SectionDefinitionService);
  private readonly designSystemTemplateService = inject(DesignSystemTemplateService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly org = inject(OrganizationContextService);

  tab = signal<Tab>('members');

  members = signal<Member[]>([]);
  employeeRoles = signal<RoleOption[]>([]);
  clientRoles = signal<RoleOption[]>([]);
  editingMemberId = signal<string | null>(null);
  editingRoleKeys = new Set<string>();

  invitations = signal<Invitation[]>([]);
  inviteEmail = '';
  inviteMembershipType: MembershipType = 'employee';
  inviteRoleKeys = new Set<string>();
  inviteError = signal('');
  inviteSubmitting = signal(false);

  sessions = signal<AuthSessionInfo[]>([]);

  auditEntries = signal<AuditLogEntry[]>([]);
  auditPage = signal(1);
  auditTotalPages = signal(1);

  loading = signal(false);
  actionMessage = signal('');

  impersonationCandidates = signal<ImpersonationCandidate[]>([]);
  impersonationStarting = signal(false);

  sectionLibrary = signal<SectionDefinition[]>([]);
  newLibrarySectionName = '';
  newLibrarySectionComponentKey = '';
  newLibrarySectionCategory = '';

  designSystemLibrary = signal<DesignSystemTemplate[]>([]);
  newLibraryDesignSystemName = '';

  ngOnInit() {
    // Mirrors the tab gating in the template: land on the first tab this
    // membership actually has permission for, rather than assuming
    // 'members' (memberships.manage) is available to everyone who passed
    // the route guard on some other admin permission (e.g. audit.view).
    const initialTab = this.availableTabs().find((t) => this.tabPermission(t) === null || this.org.hasPermission(this.tabPermission(t)!));
    this.tab.set(initialTab || 'members');

    if (this.tab() === 'members') this.loadMembers();
    if (this.tab() === 'invitations') this.loadInvitations();
    if (this.tab() === 'audit') this.loadAudit(1);
    if (this.tab() === 'impersonation') this.loadImpersonationCandidates();
    if (this.tab() === 'library') this.loadLibrary();

    this.roleService.list().subscribe((res) => {
      this.employeeRoles.set(res.data.roles.filter((r) => r.scope === 'employee'));
      this.clientRoles.set(res.data.roles.filter((r) => r.scope === 'client'));
    });
  }

  private availableTabs(): Tab[] {
    return ['members', 'invitations', 'sessions', 'audit', 'impersonation', 'library'];
  }

  private tabPermission(tab: Tab): string | null {
    const map: Record<Tab, string | null> = {
      members: 'memberships.manage',
      invitations: 'invitations.manage',
      sessions: null,
      audit: 'audit.view',
      impersonation: 'impersonation.use',
      library: 'builder.manage',
    };
    return map[tab];
  }

  setTab(tab: Tab) {
    this.tab.set(tab);
    if (tab === 'invitations' && this.invitations().length === 0) this.loadInvitations();
    if (tab === 'sessions' && this.sessions().length === 0) this.loadSessions();
    if (tab === 'audit' && this.auditEntries().length === 0) this.loadAudit(1);
    if (tab === 'impersonation') this.loadImpersonationCandidates();
    if (tab === 'library') this.loadLibrary();
  }

  loadImpersonationCandidates() {
    this.impersonationCandidateService.list().subscribe((res) => this.impersonationCandidates.set(res.data.candidates));
  }

  viewAs(candidate: ImpersonationCandidate) {
    const reason = prompt(`Why are you viewing the app as ${candidate.userName} (${candidate.organizationName})?`);
    if (!reason || !reason.trim()) return;

    this.impersonationStarting.set(true);
    this.auth.startImpersonation(candidate.membershipId, reason.trim()).subscribe({
      next: () => {
        this.org.load().subscribe(() => {
          this.impersonationStarting.set(false);
          this.router.navigate(['/app/dashboard']);
        });
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to start impersonation.');
        this.impersonationStarting.set(false);
      },
    });
  }

  loadMembers() {
    this.loading.set(true);
    this.membershipService.list().subscribe({
      next: (res) => { this.members.set(res.data.memberships); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  startEditRoles(member: Member) {
    this.editingMemberId.set(member.id);
    this.editingRoleKeys = new Set((member.roles || []).map((r) => r.key));
  }

  toggleEditingRole(key: string) {
    if (this.editingRoleKeys.has(key)) this.editingRoleKeys.delete(key);
    else this.editingRoleKeys.add(key);
  }

  saveRoles(member: Member) {
    const roleKeys = Array.from(this.editingRoleKeys);
    if (roleKeys.length === 0) return;
    this.membershipService.updateRoles(member.id, roleKeys).subscribe({
      next: () => {
        this.actionMessage.set('Roles updated.');
        this.editingMemberId.set(null);
        this.loadMembers();
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to update roles.'),
    });
  }

  toggleMemberStatus(member: Member) {
    const next = member.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${member.user?.name}?`)) return;
    this.membershipService.updateStatus(member.id, next).subscribe({
      next: () => this.loadMembers(),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to update status.'),
    });
  }

  revokeAllSessions(member: Member) {
    if (!confirm(`Revoke all active sessions for ${member.user?.name}? They will be signed out everywhere.`)) return;
    this.membershipService.revokeAllSessions(member.userId).subscribe({
      next: () => this.actionMessage.set('Sessions revoked.'),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to revoke sessions.'),
    });
  }

  loadInvitations() {
    this.invitationService.list().subscribe((res) => this.invitations.set(res.data.invitations));
  }

  toggleInviteRole(key: string) {
    if (this.inviteRoleKeys.has(key)) this.inviteRoleKeys.delete(key);
    else this.inviteRoleKeys.add(key);
  }

  sendInvitation() {
    const roleKeys = Array.from(this.inviteRoleKeys);
    if (!this.inviteEmail || roleKeys.length === 0) {
      this.inviteError.set('Email and at least one role are required.');
      return;
    }
    this.inviteSubmitting.set(true);
    this.inviteError.set('');
    this.invitationService.create({ email: this.inviteEmail, membershipType: this.inviteMembershipType, roleKeys }).subscribe({
      next: () => {
        this.inviteEmail = '';
        this.inviteRoleKeys.clear();
        this.inviteSubmitting.set(false);
        this.loadInvitations();
      },
      error: (err) => {
        this.inviteError.set(err.error?.message || 'Failed to send invitation.');
        this.inviteSubmitting.set(false);
      },
    });
  }

  resendInvitation(id: string) {
    this.invitationService.resend(id).subscribe(() => this.loadInvitations());
  }

  revokeInvitation(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    this.invitationService.revoke(id).subscribe(() => this.loadInvitations());
  }

  loadSessions() {
    this.sessionService.list().subscribe((res) => this.sessions.set(res.data.sessions));
  }

  revokeSession(id: string) {
    this.sessionService.revoke(id).subscribe(() => this.loadSessions());
  }

  loadAudit(page: number) {
    this.auditPage.set(page);
    this.auditService.list(page).subscribe((res) => {
      this.auditEntries.set(res.data.items);
      this.auditTotalPages.set(res.data.pagination.totalPages);
    });
  }

  rolesForType(type: MembershipType): RoleOption[] {
    return type === 'employee' ? this.employeeRoles() : this.clientRoles();
  }

  loadLibrary() {
    this.sectionDefinitionService.listForGovernance().subscribe((res) => this.sectionLibrary.set(res.data.sectionDefinitions));
    this.designSystemTemplateService.listForGovernance().subscribe((res) => this.designSystemLibrary.set(res.data.designSystemTemplates));
  }

  createLibrarySection() {
    if (!this.newLibrarySectionName.trim() || !this.newLibrarySectionComponentKey.trim() || !this.newLibrarySectionCategory.trim()) return;
    this.sectionDefinitionService.create({
      name: this.newLibrarySectionName,
      componentKey: this.newLibrarySectionComponentKey,
      category: this.newLibrarySectionCategory,
    }).subscribe({
      next: () => {
        this.newLibrarySectionName = '';
        this.newLibrarySectionComponentKey = '';
        this.newLibrarySectionCategory = '';
        this.loadLibrary();
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to create section'),
    });
  }

  publishLibrarySection(section: SectionDefinition) {
    this.sectionDefinitionService.publish(section.id).subscribe(() => this.loadLibrary());
  }

  deprecateLibrarySection(section: SectionDefinition) {
    this.sectionDefinitionService.deprecate(section.id).subscribe(() => this.loadLibrary());
  }

  createLibraryDesignSystemTemplate() {
    if (!this.newLibraryDesignSystemName.trim()) return;
    this.designSystemTemplateService.create({ name: this.newLibraryDesignSystemName }).subscribe({
      next: () => {
        this.newLibraryDesignSystemName = '';
        this.loadLibrary();
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to create design system template'),
    });
  }

  publishLibraryDesignSystemTemplate(template: DesignSystemTemplate) {
    this.designSystemTemplateService.publish(template.id).subscribe(() => this.loadLibrary());
  }

  deprecateLibraryDesignSystemTemplate(template: DesignSystemTemplate) {
    this.designSystemTemplateService.deprecate(template.id).subscribe(() => this.loadLibrary());
  }
}
