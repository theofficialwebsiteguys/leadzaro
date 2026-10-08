import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MembershipService } from '../../../core/services/membership.service';
import { InvitationService } from '../../../core/services/invitation.service';
import { RoleOption, RoleService } from '../../../core/services/role.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { AuthService } from '../../../core/services/auth.service';
import { SalesService } from '../../../core/services/sales.service';
import { Invitation, Member } from '../../../core/models/organization.model';
import { UserRef } from '../../../core/models/sales.model';

// Plain-English summaries of the fixed role catalog (server/core/authorization/catalog.js).
export const ROLE_GUIDE: Record<string, string> = {
  administrator: 'Everything, including team access, integrations and workspace settings.',
  sales_manager: 'All sales work plus team reports, goals, shared templates, reassigning leads, custom-priced offers and manual payments.',
  sales_representative: 'Finding and working leads, outreach, and payment links from the Stripe catalog.',
  project_manager: 'Client projects: stages, tasks, requests, meetings, files, publishing and cancellations.',
  designer: 'Client projects: tasks, requests, meetings, files and website editing.',
  advanced_designer: 'Designer access plus publishing and developer tools.',
  developer: 'Client projects plus website publishing and developer tools.',
  support: 'Client projects: tasks, requests, meetings and files.',
  billing: 'Stripe webhook recovery, service plans, SEO entitlements and manual payments.',
};

/**
 * Team & access (ADR 0012): members and roles, invitations, and what each
 * role allows. Every change goes through the existing membership and
 * invitation endpoints, which enforce memberships.manage /
 * invitations.manage on the server.
 */
@Component({
  selector: 'app-team-settings',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>Team &amp; access</h2><p>Who can sign in to the workspace and what they can do.</p></div>
      @if (message()) { <div class="alert alert-info" role="status">{{ message() }}</div> }

      @if (canManageMembers()) {
        <div class="set-card">
          <div class="set-card-head"><div><h3>Members</h3><p>Roles decide what each person can see and change. You can give someone more than one role.</p></div>
            <span class="scope-tag workspace">Whole workspace</span></div>
          <div class="set-card-body">
            @if (loadingMembers()) { <div class="loading-state"><div class="spinner"></div></div> }
            @for (m of employees(); track m.id) {
              <div class="member" [class.suspended]="m.status !== 'active'">
                <div class="who">
                  <strong>{{ m.user?.name }}</strong>@if (m.userId === auth.currentUser()?.id) { <span class="tag tag-primary">You</span> }
                  <span class="text-sm text-muted">{{ m.user?.email }}@if (m.title) { · {{ m.title }} }</span>
                  @if (editing() !== m.id) {
                    <div class="roles">@for (r of m.roles ?? []; track r.key) { <span class="tag tag-muted">{{ r.name }}</span> } @empty { <span class="text-xs text-muted">No roles</span> }
                      @if (m.status !== 'active') { <span class="tag tag-warning">{{ m.status }}</span> }</div>
                  } @else {
                    <div class="role-pick">
                      @for (r of employeeRoles(); track r.key) {
                        <label><input type="checkbox" [checked]="editingKeys.has(r.key)" (change)="toggleKey(r.key)" /> {{ r.name }}</label>
                      }
                    </div>
                  }
                </div>
                <div class="actions">
                  @if (editing() === m.id) {
                    <button class="btn btn-ghost btn-sm" (click)="editing.set(null)">Cancel</button>
                    <button class="btn btn-primary btn-sm" (click)="saveRoles(m)" [disabled]="!editingKeys.size">Save roles</button>
                  } @else if (m.userId !== auth.currentUser()?.id) {
                    <button class="btn btn-ghost btn-sm" (click)="startEdit(m)">Change roles</button>
                    <button class="btn btn-ghost btn-sm" (click)="toggleStatus(m)">{{ m.status === 'active' ? 'Suspend' : 'Reactivate' }}</button>
                    <button class="btn btn-ghost btn-sm" (click)="signOut(m)">Sign out everywhere</button>
                  } @else { <span class="text-xs text-muted">Ask another administrator to change your own access.</span> }
                </div>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="set-card">
          <div class="set-card-head"><div><h3>Your team</h3><p>Only an administrator can change who has access or what they can do.</p></div></div>
          <div class="set-card-body team-list">
            @for (m of teammates(); track m.id) { <span class="tag tag-muted">{{ m.name }}</span> } @empty { <span class="text-sm text-muted">No teammates to show.</span> }
          </div>
        </div>
      }

      @if (canInvite()) {
        <form class="set-card" (ngSubmit)="invite()">
          <div class="set-card-head"><div><h3>Invite someone</h3><p>They get an email link to set their own password. Invitations expire after a week.</p></div></div>
          <div class="set-card-body">
            <div class="form-group"><label class="form-label" for="inv-email">Their email (becomes their login)</label>
              <input id="inv-email" type="email" class="form-control" name="email" [(ngModel)]="inviteEmail" autocomplete="off" /></div>
            <div class="form-group"><span class="form-label">Roles</span>
              <div class="role-pick">@for (r of employeeRoles(); track r.key) { <label><input type="checkbox" [checked]="inviteKeys.has(r.key)" (change)="toggleInvite(r.key)" /> {{ r.name }}</label> }</div></div>
            @if (inviteError()) { <div class="alert alert-error">{{ inviteError() }}</div> }
          </div>
          <div class="set-actions"><button type="submit" class="btn btn-primary btn-sm" [disabled]="inviting()">{{ inviting() ? 'Sending…' : 'Send invitation' }}</button></div>
        </form>

        <div class="set-card">
          <div class="set-card-head"><div><h3>Pending invitations</h3></div></div>
          <div class="set-card-body">
            @for (i of pending(); track i.id) {
              <div class="member">
                <div class="who"><strong>{{ i.email }}</strong><span class="text-xs text-muted">{{ roleNames(i.roleKeys) }} · expires {{ i.expiresAt | date: 'MMM d' }}</span></div>
                <div class="actions"><button class="btn btn-ghost btn-sm" (click)="resend(i)">Resend</button><button class="btn btn-ghost btn-sm" (click)="revoke(i)">Revoke</button></div>
              </div>
            } @empty { <p class="text-sm text-muted">No pending invitations.</p> }
          </div>
        </div>
      }

      <div class="set-card">
        <div class="set-card-head"><div><h3>What each role can do</h3><p>Roles are fixed; a person’s job title or sales focus never changes their access.</p></div></div>
        <div class="set-card-body guide">
          @for (r of guide(); track r.key) { <div><strong>{{ r.name }}</strong><span>{{ r.summary }}</span></div> }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .member { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border-light); flex-wrap: wrap;
      &:first-of-type { border-top: none; } &.suspended { opacity: .7; } }
    .who { display: flex; flex-direction: column; gap: 3px; min-width: 0; strong { margin-right: 6px; } }
    .roles { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
    .role-pick { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .8125rem; label { display: flex; gap: 6px; align-items: center; } input { accent-color: var(--primary); } }
    .actions { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
    .team-list { flex-direction: row; flex-wrap: wrap; gap: 6px; }
    .guide { display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      @media (max-width: 640px) { grid-template-columns: 1fr; }
      div { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: var(--bg); border-radius: var(--radius); font-size: .85rem; }
      span { color: var(--text-muted); font-size: .78rem; } }
  `],
})
export class TeamSettingsComponent implements OnInit {
  private readonly memberships = inject(MembershipService);
  private readonly invitations = inject(InvitationService);
  private readonly roles = inject(RoleService);
  private readonly sales = inject(SalesService);
  readonly org = inject(OrganizationContextService);
  readonly auth = inject(AuthService);

  readonly members = signal<Member[]>([]);
  readonly employeeRoles = signal<RoleOption[]>([]);
  readonly invites = signal<Invitation[]>([]);
  readonly teammates = signal<UserRef[]>([]);
  readonly loadingMembers = signal(false);
  readonly editing = signal<string | null>(null);
  readonly message = signal('');
  readonly inviting = signal(false);
  readonly inviteError = signal('');
  editingKeys = new Set<string>();
  inviteKeys = new Set<string>();
  inviteEmail = '';

  readonly canManageMembers = computed(() => this.org.hasPermission('memberships.manage'));
  readonly canInvite = computed(() => this.org.hasPermission('invitations.manage'));
  readonly employees = computed(() => this.members().filter((m) => m.membershipType === 'employee' && m.status !== 'removed'));
  readonly pending = computed(() => this.invites().filter((i) => i.status === 'pending'));
  readonly guide = computed(() => {
    const list = this.employeeRoles().length ? this.employeeRoles() : Object.keys(ROLE_GUIDE).map((key) => ({ key, name: key.replace(/_/g, ' ') } as RoleOption));
    return list.map((r) => ({ key: r.key, name: r.name, summary: ROLE_GUIDE[r.key] ?? 'Custom role.' }));
  });

  ngOnInit(): void {
    this.roles.list('employee').subscribe({ next: (res) => this.employeeRoles.set(res.data.roles.filter((r) => r.scope === 'employee')), error: () => undefined });
    if (this.canManageMembers()) this.loadMembers();
    else this.sales.team().subscribe({ next: (r) => this.teammates.set(r.members), error: () => undefined });
    if (this.canInvite()) this.loadInvites();
  }

  loadMembers(): void {
    this.loadingMembers.set(true);
    this.memberships.list().subscribe({
      next: (res) => { this.members.set(res.data.memberships); this.loadingMembers.set(false); },
      error: (err) => { this.loadingMembers.set(false); this.message.set(err.error?.message || 'Members couldn’t be loaded.'); },
    });
  }

  loadInvites(): void {
    this.invitations.list().subscribe({ next: (res) => this.invites.set(res.data.invitations), error: () => undefined });
  }

  startEdit(m: Member): void {
    this.editingKeys = new Set((m.roles ?? []).map((r) => r.key));
    this.editing.set(m.id);
  }

  toggleKey(key: string): void {
    if (this.editingKeys.has(key)) this.editingKeys.delete(key);
    else this.editingKeys.add(key);
  }

  saveRoles(m: Member): void {
    const keys = [...this.editingKeys];
    const adding = keys.includes('administrator') && !(m.roles ?? []).some((r) => r.key === 'administrator');
    if (adding && !confirm(`Make ${m.user?.name} an administrator? They’ll be able to change everyone’s access and all settings.`)) return;
    this.memberships.updateRoles(m.id, keys).subscribe({
      next: () => { this.editing.set(null); this.message.set(`Roles updated for ${m.user?.name}.`); this.loadMembers(); },
      error: (err) => this.message.set(err.error?.message || 'Roles couldn’t be updated.'),
    });
  }

  toggleStatus(m: Member): void {
    const next = m.status === 'active' ? 'suspended' : 'active';
    if (!confirm(next === 'suspended' ? `Suspend ${m.user?.name}? They won’t be able to sign in until reactivated.` : `Reactivate ${m.user?.name}?`)) return;
    this.memberships.updateStatus(m.id, next).subscribe({
      next: () => { this.message.set(next === 'suspended' ? 'Suspended.' : 'Reactivated.'); this.loadMembers(); },
      error: (err) => this.message.set(err.error?.message || 'That didn’t work.'),
    });
  }

  signOut(m: Member): void {
    if (!confirm(`Sign ${m.user?.name} out on every device?`)) return;
    this.memberships.revokeAllSessions(m.userId).subscribe({
      next: () => this.message.set('Signed out everywhere.'),
      error: (err) => this.message.set(err.error?.message || 'That didn’t work.'),
    });
  }

  toggleInvite(key: string): void {
    if (this.inviteKeys.has(key)) this.inviteKeys.delete(key);
    else this.inviteKeys.add(key);
  }

  invite(): void {
    const email = this.inviteEmail.trim();
    if (!email || !email.includes('@')) { this.inviteError.set('Enter their email address.'); return; }
    if (!this.inviteKeys.size) { this.inviteError.set('Choose at least one role.'); return; }
    this.inviting.set(true);
    this.inviteError.set('');
    this.invitations.create({ email, membershipType: 'employee', roleKeys: [...this.inviteKeys] }).subscribe({
      next: () => { this.inviting.set(false); this.inviteEmail = ''; this.inviteKeys = new Set(); this.message.set(`Invitation sent to ${email}.`); this.loadInvites(); },
      error: (err) => { this.inviting.set(false); this.inviteError.set(err.error?.message || 'The invitation couldn’t be sent.'); },
    });
  }

  resend(i: Invitation): void {
    this.invitations.resend(i.id).subscribe({ next: () => { this.message.set(`Invitation resent to ${i.email}.`); this.loadInvites(); }, error: (err) => this.message.set(err.error?.message || 'Couldn’t resend.') });
  }

  revoke(i: Invitation): void {
    if (!confirm(`Revoke the invitation for ${i.email}? The link will stop working.`)) return;
    this.invitations.revoke(i.id).subscribe({ next: () => this.loadInvites(), error: (err) => this.message.set(err.error?.message || 'Couldn’t revoke.') });
  }

  roleNames(keys: string[]): string {
    return keys.map((k) => this.employeeRoles().find((r) => r.key === k)?.name ?? k).join(', ');
  }
}
