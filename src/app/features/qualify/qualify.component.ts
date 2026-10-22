import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { WorkflowService } from '../../core/services/workflow.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import {
  ContactStatus, Qualification, QualificationResponse, SourceKey, SourceStatus,
} from '../../core/models/workflow.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { EmailSourceComponent } from '../../shared/email-source/email-source.component';
import { QualifyDraft, QualifyFlowComponent, QualifyStart } from './qualify-flow.component';

const STEPS = [
  { n: 1, label: 'Business' },
  { n: 2, label: 'Links' },
  { n: 3, label: 'Contact' },
  { n: 4, label: 'Reason' },
  { n: 5, label: 'Review & assign' },
];
const SOURCES: { key: SourceKey; label: string; hint: string }[] = [
  { key: 'google', label: 'Google listing', hint: 'Their Google Maps / Business Profile page' },
  { key: 'website', label: 'Website', hint: 'Their own site — a missing website can be the reason to reach out' },
  { key: 'facebook', label: 'Facebook page', hint: 'The business’s own page, not a search' },
];

/**
 * Guided qualification (ADR 0016): one step at a time — the business, its
 * links, contact details, one reason to reach out, then review and assign.
 * Every step saves to the server, so research resumes after a refresh and
 * nothing typed is lost on an error.
 */
@Component({
  selector: 'app-qualify',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, IconComponent, QualifyFlowComponent, EmailSourceComponent],
  template: `
    <div class="page qualify">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a routerLink="/app/my-work">My Work</a><span aria-hidden="true">›</span>
        <a routerLink="/app/qualify">Qualifying</a><span aria-hidden="true">›</span>
        <span>{{ isNew() ? 'Add a business' : (resumeData()?.start?.name || qq()?.business?.name || 'Research') }}</span>
      </nav>

      @if (isNew()) {
        <!-- Manual entry (ADR 0016): same steps as from search; nothing becomes a lead until it's decided. -->
        @for (k of [manualKey()]; track k) {
          <h1 class="manual-title">Add a business</h1>
          <app-qualify-flow [start]="manualStart" nextText="Add another business" (next)="manualKey.set(manualKey() + 1)" />
        }
      } @else if (resumeKey()) {
        <!-- Research saved earlier (ADR 0017), resumed from My Work or a link. -->
        @if (resumeData(); as r) {
          @for (k of [resumeKey()]; track k) {
            <app-qualify-flow [start]="r.start" [saved]="r.draft" [resumeKey]="k" [nextText]="nextDraftKey() ? 'Next saved research' : 'Find more businesses'" (next)="nextResearch()" (skip)="router.navigate(['/app/my-work'])" />
          }
        } @else if (error()) {
          <div class="alert alert-error">{{ error() }} <a routerLink="/app/my-work">Back to My Work</a></div>
        } @else {
          <div class="loading-state"><div class="spinner"></div><span>Loading your research…</span></div>
        }
      } @else if (loading() && !qq()) {
        <div class="loading-state"><div class="spinner"></div><span>Loading research…</span></div>
      } @else if (!qq() && error()) {
        <div class="alert alert-error">{{ error() }}</div>
      } @else if (qq()) {
        @let q = qq()!;
        <header class="q-head">
          <div>
            <p class="eyebrow">Qualification · <span class="status" [attr.data-status]="q.status">{{ q.statusLabel }}</span></p>
            <h1>{{ q.business.name }}</h1>
            <p class="sub">{{ q.business.category || 'Business' }}@if (q.business.city) { · {{ q.business.city }}@if (q.business.state) {, {{ q.business.state }}} }
              @if (q.business.rating) { · {{ q.business.rating }}★ ({{ q.business.reviewCount }}) }</p>
          </div>
        </header>

        @if (q.note && q.status !== 'assigned' && q.status !== 'needs_review') { <div class="alert alert-warning">{{ q.status === 'needs_correction' ? 'Returned for correction: ' : 'Note: ' }}{{ q.note }}</div> }
        @if (q.review; as rv) {
          <section class="card review">
            <h2>Possible duplicate — waiting for a manager</h2>
            <p class="sub">{{ rv.requestedBy?.name || 'The qualifier' }} saved this separately on {{ rv.requestedAt | date: 'MMM d' }} because it may already be in Leadzaro.@if (rv.note) { “{{ rv.note }}” }
              It isn’t in any sales queue and doesn’t count as completed work until it’s settled.</p>
            <ul class="review-matches">
              @for (m of rv.matches; track m.opportunityId ?? m.organizationId) {
                <li>
                  <span><strong>{{ m.name }}</strong>@if (m.location) { · {{ m.location }} } — {{ m.label }}@if (m.assignedTo) { · {{ m.assignedTo.name }} }
                    @if (m.reasons?.length) { <span class="hint">Matched on {{ m.reasons!.join(', ') }}</span> }</span>
                  @if (q.canResolveReview && m.opportunityId && m.mergeable) { <button class="btn btn-outline btn-sm" (click)="resolve('merge', m.opportunityId)" [disabled]="busy()">Same business — add research to it</button> }
                </li>
              }
            </ul>
            @if (q.canResolveReview) {
              <input class="form-control" [(ngModel)]="reviewNote" maxlength="500" placeholder="Note for the qualifier (optional)" aria-label="Note for the qualifier" />
              <div class="actions">
                <button class="btn btn-ghost danger" (click)="resolve('dismiss')" [disabled]="busy()">Discard it</button>
                <span class="spacer"></span>
                <button class="btn btn-primary" (click)="resolve('separate')" [disabled]="busy()">Different business — go ahead@if (rv.assignee) { (to {{ rv.assignee.name }}) }</button>
              </div>
            } @else { <p class="hint">A manager will check it. You can still correct the research below.</p> }
          </section>
        }
        @if (q.credit?.reviewNote && (q.credit?.status === 'needs_correction' || q.credit?.status === 'rejected')) { <div class="alert alert-warning">Review feedback: {{ q.credit?.reviewNote }}</div> }

        @if (done(); as d) {
          <section class="card step-card done-card">
            <lz-icon name="check-circle" [size]="28" />
            <div><h2>{{ d }}</h2><p class="sub">Your work is recorded with today’s date. Ready for the next one?</p></div>
            <div class="actions">
              <a routerLink="/app/my-work" class="btn btn-ghost">Back to My Work</a>
              <a routerLink="/app/qualify/new" class="btn btn-outline">Add a business by hand</a>
              <a routerLink="/app/qualify" class="btn btn-primary">Qualify next business</a>
            </div>
          </section>
        } @else {
          <ol class="progress" aria-label="Qualification steps">
            @for (s of steps; track s.n) {
              <li [class.current]="s.n === step()" [class.done]="s.n < step() || !missingIn(s.n)">
                <button type="button" (click)="goTo(s.n)" [disabled]="busy()">{{ s.n }}. {{ s.label }}</button>
              </li>
            }
          </ol>

          @if (!q.canEdit) { <div class="alert alert-info">You can view this research but not change it.</div> }

          <section class="card step-card">
            @switch (step()) {
              @case (1) {
                <h2>Is this the right business?</h2>
                <p class="sub">Enough location detail to tell it apart from others with a similar name.</p>
                <div class="grid2">
                  <div class="form-group span2"><label class="form-label" for="b-name">Business name *</label><input id="b-name" class="form-control" [(ngModel)]="form.business.name" /></div>
                  <div class="form-group span2"><label class="form-label" for="b-addr">Street address</label><input id="b-addr" class="form-control" [(ngModel)]="form.business.addressLine1" /></div>
                  <div class="form-group"><label class="form-label" for="b-city">Town / city *</label><input id="b-city" class="form-control" [(ngModel)]="form.business.city" /></div>
                  <div class="form-group"><label class="form-label" for="b-state">State</label><input id="b-state" class="form-control" [(ngModel)]="form.business.state" /></div>
                  <div class="form-group"><label class="form-label" for="b-cat">Kind of business</label><input id="b-cat" class="form-control" [(ngModel)]="form.business.category" /></div>
                </div>
              }
              @case (2) {
                <h2>Check and save their links</h2>
                <p class="sub">Open or search for each one, then paste the business’s own page. If you can’t find one, say so — don’t guess.</p>
                @for (s of sources; track s.key) {
                  <div class="check-block">
                    <div class="check-top">
                      <div><strong>{{ s.label }}</strong><p class="hint">{{ s.hint }}</p></div>
                      <div class="link-actions">
                        @if (form.sources[s.key].url) { <a class="btn btn-ghost btn-sm" [href]="form.sources[s.key].url" target="_blank" rel="noopener">Open ↗</a> }
                        <a class="btn btn-ghost btn-sm" [href]="searchUrl(s.key)" target="_blank" rel="noopener">Search ↗</a>
                      </div>
                    </div>
                    <div class="seg" role="radiogroup" [attr.aria-label]="s.label">
                      @for (o of sourceOptions; track o.key) {
                        <button type="button" role="radio" [attr.aria-checked]="form.sources[s.key].status === o.key" [class.active]="form.sources[s.key].status === o.key" (click)="form.sources[s.key].status = o.key">{{ o.label }}</button>
                      }
                    </div>
                    @if (form.sources[s.key].status === 'found') {
                      <input class="form-control" [(ngModel)]="form.sources[s.key].url" placeholder="Paste the link (https://…)" [attr.aria-label]="s.label + ' link'" />
                    }
                  </div>
                }
              }
              @case (3) {
                <h2>Collect contact details</h2>
                <p class="sub">Email is preferred; a working phone number is enough for a call. Copy details exactly as published — never guess an owner or build an email address.</p>
                <div class="check-block">
                  <div class="check-top"><div><strong>Email</strong>
                    <p class="hint">@if (q.emailDiscovery.status === 'checking') { Checking their website… } @else if (q.emailDiscovery.summary) { {{ q.emailDiscovery.summary }} } @else { Look on their website’s contact page and Facebook “About”. }</p></div>
                    <div class="link-actions">@if (q.canEdit && form.sources.website.url) { <button class="btn btn-ghost btn-sm" (click)="findEmail()" [disabled]="busy()">Check website for email</button> }</div>
                  </div>
                  @for (c of q.emailDiscovery.candidates.slice(0, 3); track c.email) {
                    @if (c.email !== form.contacts.email.value) {
                      <button type="button" class="suggest" (click)="useEmail(c.email, c.sourceUrl || null)">Use {{ c.email }} @if (c.sourceUrl) { <span class="hint">· found on {{ host(c.sourceUrl) }}</span> }</button>
                    }
                  }
                  <div class="seg" role="radiogroup" aria-label="Email">
                    @for (o of contactOptions; track o.key) { <button type="button" role="radio" [attr.aria-checked]="form.contacts.email.status === o.key" [class.active]="form.contacts.email.status === o.key" (click)="form.contacts.email.status = o.key">{{ o.label }}</button> }
                  </div>
                  @if (form.contacts.email.status === 'found') {
                    <input class="form-control" type="email" [class.is-invalid]="!!err('contacts.email.values.0.value')" [(ngModel)]="form.contacts.email.value" (ngModelChange)="clearErr('contacts.email.values.0.value')" placeholder="name@business.com" aria-label="Email address" />
                    @if (err('contacts.email.values.0.value')) { <p class="field-err" role="alert">{{ err('contacts.email.values.0.value') }}</p> }
                    <app-email-source [(type)]="form.contacts.email.sourceType" [(note)]="form.contacts.email.sourceNote" [(url)]="form.contacts.email.sourceUrl" [email]="form.contacts.email.value"
                      [typeError]="err('contacts.email.values.0.sourceType')" [noteError]="err('contacts.email.values.0.sourceNote')" [urlError]="err('contacts.email.values.0.sourceUrl')"
                      (changed)="clearErr('contacts.email.values.0.' + $event)" />
                    <p class="hint">Format is checked only — an email isn’t marked verified until someone confirms it.</p>
                  } @else if (form.contacts.email.status === 'not_found') { <p class="hint">Recorded as checked with no email found — no placeholder needed.</p> }
                </div>
                <div class="check-block">
                  <div class="check-top"><div><strong>Phone</strong>@if (q.contacts.phone.from === 'search') { <p class="hint">From their Google listing</p> }</div></div>
                  <div class="seg" role="radiogroup" aria-label="Phone">
                    @for (o of contactOptions; track o.key) { <button type="button" role="radio" [attr.aria-checked]="form.contacts.phone.status === o.key" [class.active]="form.contacts.phone.status === o.key" (click)="form.contacts.phone.status = o.key">{{ o.label }}</button> }
                  </div>
                  @if (form.contacts.phone.status === 'found') {
                    <input class="form-control" [class.is-invalid]="!!err('contacts.phone.values.0.value')" [(ngModel)]="form.contacts.phone.value" (ngModelChange)="clearErr('contacts.phone.values.0.value')" placeholder="(555) 555-0100" aria-label="Phone number" />
                    @if (err('contacts.phone.values.0.value')) { <p class="field-err" role="alert">{{ err('contacts.phone.values.0.value') }}</p> }
                  }
                </div>
                <div class="check-block">
                  <div class="check-top"><div><strong>Owner or contact name</strong><p class="hint">Only if it’s published — leave “Not found” otherwise.</p></div></div>
                  <div class="seg" role="radiogroup" aria-label="Contact name">
                    @for (o of contactOptions; track o.key) { <button type="button" role="radio" [attr.aria-checked]="form.contacts.owner.status === o.key" [class.active]="form.contacts.owner.status === o.key" (click)="form.contacts.owner.status = o.key">{{ o.label }}</button> }
                  </div>
                  @if (form.contacts.owner.status === 'found') {
                    <div class="grid2">
                      <input class="form-control" [(ngModel)]="form.contacts.owner.name" placeholder="Name" aria-label="Contact name" />
                      <input class="form-control" [(ngModel)]="form.contacts.owner.title" placeholder="Role, e.g. Owner" aria-label="Contact role" />
                    </div>
                  }
                </div>
                @if (form.sources.facebook.url) { <p class="hint">Facebook (from the last step): <a [href]="form.sources.facebook.url" target="_blank" rel="noopener">{{ form.sources.facebook.url }}</a> — its About section often lists an email.</p> }
              }
              @case (4) {
                <h2>Why should we reach out?</h2>
                <p class="sub">One short, specific observation from what you checked. Say what you saw — “No website found” is not the same as “has no website”.</p>
                <div class="chips">
                  @for (r of reasonOptions(); track r.key) {
                    <button type="button" class="chip" [class.on]="form.reason.tags.includes(r.key)" (click)="toggleReason(r.key, r.text)">{{ r.label }}</button>
                  }
                </div>
                <div class="form-group"><label class="form-label" for="r-text">Your observation *</label>
                  <textarea id="r-text" class="form-control" rows="3" [(ngModel)]="form.reason.text" maxlength="1000" placeholder="e.g. Their Google listing links to a Facebook page only; no website found on Google or Facebook."></textarea></div>
                <p class="hint">No audit, proposal or budget needed here — sales finds those out.</p>
              }
              @case (5) {
                <h2>Review and assign</h2>
                <dl class="summary">
                  <dt>Business</dt><dd>{{ q.business.name }} — {{ [q.business.addressLine1, q.business.city, q.business.state].filter(truthy).join(', ') || 'location not set' }}</dd>
                  <dt>Links</dt><dd>@for (s of sources; track s.key) { <span class="pair">{{ s.label }}: @if (q.sources[s.key].status === 'found' && q.sources[s.key].url) { <a [href]="q.sources[s.key].url" target="_blank" rel="noopener">found ↗</a> } @else { {{ statusWord(q.sources[s.key].status) }} }</span> }</dd>
                  <dt>Contact</dt><dd>
                    <span class="pair">Email: {{ q.contacts.email.value || statusWord(q.contacts.email.status) }}</span>
                    <span class="pair">Phone: {{ q.contacts.phone.value || statusWord(q.contacts.phone.status) }}</span>
                    <span class="pair">Name: {{ q.contacts.owner.name ? q.contacts.owner.name + (q.contacts.owner.title ? ' (' + q.contacts.owner.title + ')' : '') : statusWord(q.contacts.owner.status) }}</span></dd>
                  <dt>Reason</dt><dd>{{ q.reason.text || '—' }}</dd>
                  <dt>Qualifier</dt><dd>{{ q.researcher?.name || 'You' }}@if (q.qualifiedAt) { · first completed {{ q.qualifiedAt | date: 'MMM d' }} }</dd>
                </dl>
                @if (q.missing.length) {
                  <div class="alert alert-warning">Still needed: @for (m of q.missing; track m.key; let last = $last) { <button class="link-btn" (click)="goTo(m.step)">{{ m.label }}</button>{{ last ? '' : ', ' }} }</div>
                } @else if (!q.hasUsableContact) {
                  <div class="alert alert-warning">No usable email or phone, so sales can’t contact them. Save it as needing more information, or not suitable.</div>
                }
                @if (q.status === 'assigned') {
                  <p class="state">Assigned to <strong>{{ q.assignedTo?.name }}</strong>.</p>
                } @else {
                  <div class="form-group"><label class="form-label" for="a-who">Assign to</label>
                    <select id="a-who" class="form-select" [(ngModel)]="assigneeId">
                      <option value="">Choose a salesperson…</option>
                      @for (a of assignees(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                    </select></div>
                }
                <details class="park">
                  <summary>Can’t qualify it?</summary>
                  <div class="inline">
                    <input class="form-control" [(ngModel)]="parkNote" maxlength="500" placeholder="Why, e.g. no phone or email anywhere" aria-label="Note" />
                    <button class="btn btn-ghost btn-sm" (click)="park('needs_research')" [disabled]="busy() || !parkNote.trim()">Needs more information</button>
                    <button class="btn btn-ghost btn-sm danger" (click)="park('unsuitable')" [disabled]="busy() || !parkNote.trim()">Not suitable</button>
                  </div>
                </details>
              }
            }

            @if (error()) { <div class="alert alert-error" role="alert">{{ error() }}</div> }
            @if (savedNote()) { <p class="saved" role="status">{{ savedNote() }}</p> }

            @if (q.canEdit) {
              <div class="actions">
                @if (step() > 1) { <button class="btn btn-ghost" (click)="goTo(step() - 1)" [disabled]="busy()">← Previous step</button> }
                <span class="spacer"></span>
                @if (step() < 5) {
                  <button class="btn btn-outline" (click)="saveStep(step())" [disabled]="busy()">Save draft</button>
                  <button class="btn btn-primary" (click)="goTo(step() + 1)" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save & continue' }}</button>
                } @else if (q.status !== 'assigned' && q.status !== 'needs_review') {
                  <button class="btn btn-outline" (click)="complete(false)" [disabled]="busy() || q.missing.length > 0 || !q.hasUsableContact">Ready for assignment (no salesperson yet)</button>
                  <button class="btn btn-primary" (click)="complete(true)" [disabled]="busy() || !assigneeId || q.missing.length > 0 || !q.hasUsableContact">Complete qualification &amp; assign</button>
                }
              </div>
            }
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .qualify { max-width: 1080px; }
    .crumbs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: .8rem; color: var(--text-muted); margin: 0 0 6px; a { color: var(--text-muted); text-decoration: none; &:hover { color: var(--primary); } } }
    .field-err { margin: 0; font-size: .78rem; color: var(--danger-text); }
    .is-invalid { border-color: var(--danger) !important; }
    .review { padding: 18px 20px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; border-left: 4px solid var(--warning); h2 { margin: 0; font-size: 1.05rem; } .sub { margin: 0; color: var(--text-muted); font-size: .86rem; }
      .danger { color: var(--danger-text); } }
    .review-matches { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: .86rem;
      li { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; } .hint { display: block; } }
    .q-head { margin: 8px 0 16px; h1 { font-family: var(--font-display); font-size: 1.6rem; margin: 2px 0 0; } .sub { color: var(--text-muted); margin: 4px 0 0; font-size: .875rem; } }
    .eyebrow { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); margin: 0; font-weight: 600; }
    .status { color: var(--primary-dark); &[data-status='needs_correction'], &[data-status='needs_research'] { color: var(--warning-text, #92400e); } &[data-status='unsuitable'] { color: var(--danger-text); } }
    .progress { list-style: none; display: flex; gap: 6px; padding: 0; margin: 0 0 12px; flex-wrap: wrap;
      button { border: 1px solid var(--border); background: var(--card); border-radius: var(--radius-full); padding: 6px 12px; font-size: .78rem; cursor: pointer; color: var(--text-secondary); }
      li.done button { border-color: var(--success); color: var(--success); }
      li.current button { border-color: var(--primary); background: var(--primary-50); color: var(--primary-dark); font-weight: 600; }
    }
    .step-card { padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; h2 { margin: 0; font-size: 1.1rem; } .sub { margin: 0; color: var(--text-muted); font-size: .85rem; } }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; .span2 { grid-column: 1 / -1; } @media (max-width: 600px) { grid-template-columns: 1fr; } }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; @media (max-width: 600px) { grid-template-columns: 1fr; } }
    .check-block { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .check-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; strong { font-size: .9rem; } }
    .link-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .hint { font-size: .78rem; color: var(--text-muted); margin: 2px 0 0; }
    .suggest { text-align: left; border: 1px dashed var(--primary-200); background: var(--primary-50); border-radius: var(--radius); padding: 6px 10px; font-size: .8125rem; cursor: pointer; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { border: 1px solid var(--border); background: var(--card); border-radius: var(--radius-full); padding: 6px 12px; font-size: .8125rem; cursor: pointer;
      &.on { border-color: var(--primary-200); background: var(--primary-50); color: var(--primary-dark); } }
    .summary { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 0; font-size: .875rem;
      dt { color: var(--text-muted); } dd { margin: 0; } .pair { margin-right: 14px; display: inline-block; } }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; .spacer { flex: 1; } }
    .dupes { border: 1px solid var(--warning); background: var(--warning-bg); border-radius: var(--radius); padding: 12px; font-size: .85rem; ul { margin: 6px 0; padding-left: 18px; } }
    .park { font-size: .85rem; summary { cursor: pointer; color: var(--text-secondary); } .inline { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; .form-control { flex: 1; min-width: 200px; } } .danger { color: var(--danger-text); } }
    .link-btn { background: none; border: 0; color: var(--primary); cursor: pointer; padding: 0; text-decoration: underline; font: inherit; }
    .saved { font-size: .78rem; color: var(--success); margin: 0; }
    .state { margin: 0; }
    .manual-title { font-family: var(--font-display); font-size: 1.5rem; margin: 10px 0 14px; }
    .done-card { flex-direction: row; align-items: center; flex-wrap: wrap; color: var(--success); h2 { color: var(--text-primary); } > div { flex: 1; min-width: 220px; } }
  `],
})
export class QualifyComponent implements OnInit, OnDestroy {
  private readonly workflow = inject(WorkflowService);
  private readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  readonly manualStart: QualifyStart = { name: '', source: 'manual' };
  readonly manualKey = signal(0);
  readonly org = inject(OrganizationContextService);

  readonly steps = STEPS;
  readonly sources = SOURCES;
  readonly sourceOptions: { key: SourceStatus; label: string }[] = [
    { key: 'found', label: 'Found' }, { key: 'not_found', label: 'Not found' }, { key: 'unable', label: 'Couldn’t open' },
  ];
  readonly contactOptions: { key: ContactStatus; label: string }[] = [{ key: 'found', label: 'Found' }, { key: 'not_found', label: 'Not found' }];
  readonly truthy = (v: unknown) => Boolean(v);

  readonly isNew = signal(false);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly savedNote = signal('');
  readonly qq = signal<Qualification | null>(null);
  readonly assignees = signal<QualificationResponse['assignees']>([]);
  readonly reasonOptions = signal<QualificationResponse['reasonOptions']>([]);
  readonly step = signal(1);
  readonly done = signal<string | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});
  /** Saved progress being resumed (ADR 0017). */
  readonly resumeKey = signal<string | null>(null);
  readonly resumeData = signal<{ start: QualifyStart; draft: QualifyDraft | null } | null>(null);
  readonly nextDraftKey = signal<string | null>(null);
  reviewNote = '';
  private id = '';

  assigneeId = '';
  parkNote = '';
  form = this.emptyForm();

  readonly missingIn = (n: number) => (this.qq()?.missing ?? []).some((m) => m.step === n);
  readonly hasMissing = computed(() => (this.qq()?.missing.length ?? 0) > 0);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      const resume = params.get('key');
      this.done.set(null);
      this.error.set('');
      this.resumeKey.set(resume);
      this.resumeData.set(null);
      if (resume) {
        this.isNew.set(false);
        this.loading.set(false);
        this.workflow.draft(resume).subscribe({
          next: (r) => this.resumeData.set({ start: (r.start as QualifyStart) || { name: '', source: 'manual' }, draft: (r.draft as QualifyDraft) || null }),
          error: (err) => this.error.set(err.status === 404 ? 'That saved research isn’t there any more — it may have been finished or discarded.' : 'Couldn’t load your saved research.'),
        });
        this.workflow.drafts().subscribe({ next: (r) => this.nextDraftKey.set(r.items.find((d) => d.key !== resume)?.key ?? null), error: () => undefined });
        return;
      }
      if (!id || id === 'new') {
        this.isNew.set(true);
        this.loading.set(false);
        return;
      }
      this.isNew.set(false);
      this.id = id;
      this.load(true);
    });
  }

  ngOnDestroy(): void {
    this.workflow.focusLead.set(null);
  }

  private emptyForm() {
    const src = () => ({ status: 'not_checked' as SourceStatus, url: '' });
    return {
      business: { name: '', addressLine1: '', city: '', state: '', postalCode: '', category: '' },
      sources: { google: src(), website: src(), facebook: src() } as Record<SourceKey, { status: SourceStatus; url: string }>,
      contacts: {
        email: { status: 'not_checked' as ContactStatus, value: '', sourceType: '', sourceNote: '', sourceUrl: '' },
        phone: { status: 'not_checked' as ContactStatus, value: '', sourceUrl: '' },
        owner: { status: 'not_checked' as ContactStatus, name: '', title: '', sourceUrl: '' },
      },
      reason: { tags: [] as string[], text: '' },
    };
  }

  private apply(res: QualificationResponse, { resetStep = false } = {}): void {
    const q = res.qualification;
    this.qq.set(q);
    this.assignees.set(res.assignees);
    this.reasonOptions.set(res.reasonOptions);
    this.workflow.focusLead.set({ id: q.opportunityId, name: q.business.name });
    const f = this.emptyForm();
    f.business = {
      name: q.business.name || '', addressLine1: q.business.addressLine1 || '', city: q.business.city || '', state: q.business.state || '', postalCode: q.business.postalCode || '', category: q.business.category || '',
    };
    for (const s of SOURCES) f.sources[s.key] = { status: q.sources[s.key].status, url: q.sources[s.key].url || '' };
    const source = q.contacts.email.source;
    f.contacts.email = {
      status: q.contacts.email.status, value: q.contacts.email.value || '', sourceType: source?.type || '', sourceNote: source?.type === 'other' ? (source.label.replace(/^Other — /, '') || '') : '', sourceUrl: source?.url || '',
    };
    f.contacts.phone = { status: q.contacts.phone.status, value: q.contacts.phone.value || '', sourceUrl: q.contacts.phone.sourceUrl || '' };
    f.contacts.owner = { status: q.contacts.owner.status, name: q.contacts.owner.name || '', title: q.contacts.owner.title || '', sourceUrl: q.contacts.owner.sourceUrl || '' };
    f.reason = { tags: [...q.reason.tags], text: q.reason.text || '' };
    this.form = f;
    if (!this.assigneeId && q.assignedTo) this.assigneeId = q.assignedTo.id;
    if (resetStep) this.step.set(q.status === 'assigned' ? 5 : Math.min(Math.max(q.step, 1), 5));
  }

  load(resetStep = false): void {
    this.loading.set(true);
    this.workflow.qualification(this.id).subscribe({
      next: (res) => { this.apply(res, { resetStep }); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(err.status === 404 ? 'This research doesn’t exist or isn’t yours.' : (err.error?.message || 'Couldn’t load this research.')); },
    });
  }

  private payloadFor(n: number): Record<string, unknown> | null {
    const f = this.form;
    switch (n) {
      case 1: return { business: f.business };
      case 2: return { sources: f.sources };
      case 3: {
        const contacts: Record<string, unknown> = {};
        for (const key of ['email', 'phone', 'owner'] as const) if (f.contacts[key].status !== 'not_checked') contacts[key] = f.contacts[key];
        return { contacts };
      }
      case 4: return { reason: f.reason };
      default: return null;
    }
  }

  private save(n: number, nextStep: number): Observable<QualificationResponse> | null {
    const body = this.payloadFor(n);
    if (!body || !this.qq()?.canEdit) return null;
    return this.workflow.saveResearch(this.id, { ...body, step: nextStep });
  }

  saveStep(n: number): void {
    const request = this.save(n, n);
    if (!request) return;
    this.run(request, () => this.flash('Draft saved.'));
  }

  /** Saves the step on screen, then moves. A failed save keeps you on the step with your entries intact. */
  goTo(n: number): void {
    if (n < 1 || n > 5) return;
    const request = this.save(this.step(), n);
    if (!request) { this.step.set(n); return; }
    this.run(request, () => this.step.set(n));
  }

  private run(request: Observable<QualificationResponse>, after?: () => void): void {
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: (res) => { this.busy.set(false); this.fieldErrors.set({}); this.apply(res); after?.(); },
      error: (err) => {
        this.busy.set(false);
        if (err.error?.fields) this.fieldErrors.set(err.error.fields);
        this.error.set(err.error?.message || 'Not saved — your entries are still here. Try again.');
      },
    });
  }

  err(field: string): string | null { return this.fieldErrors()[field] ?? null; }

  clearErr(field: string): void {
    const { [field]: _gone, ...rest } = this.fieldErrors();
    this.fieldErrors.set(rest);
  }

  /** After finishing saved research: the next saved item, or a new search. */
  nextResearch(): void {
    const next = this.nextDraftKey();
    this.router.navigate(next ? ['/app/qualify/resume', next] : ['/app/qualify']);
  }

  /** A manager settles a possible duplicate (ADR 0017). */
  resolve(action: 'separate' | 'merge' | 'dismiss', targetOpportunityId?: string): void {
    this.busy.set(true);
    this.error.set('');
    this.workflow.resolveReview(this.id, { action, targetOpportunityId, note: this.reviewNote || undefined }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.done.set({ separate: 'Settled — it went ahead as a separate business', merge: 'Settled — the research was added to the existing lead', dismiss: 'Settled — the extra record was discarded' }[action]);
        if (r.opportunityId !== this.id) this.id = r.opportunityId;
        this.load();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not settled — try again.'); },
    });
  }

  private flash(text: string): void {
    this.savedNote.set(text);
    setTimeout(() => this.savedNote.set(''), 2500);
  }

  findEmail(): void {
    const request = this.save(3, 3) ?? this.workflow.qualification(this.id);
    this.run(request, () => this.run(this.workflow.findEmail(this.id), () => this.flash('Website checked.')));
  }

  useEmail(email: string, sourceUrl: string | null): void {
    this.form.contacts.email = {
      status: 'found', value: email, sourceType: /facebook\.com|fb\.com/i.test(sourceUrl || '') ? 'facebook' : 'website', sourceNote: '', sourceUrl: sourceUrl || '',
    };
  }

  toggleReason(key: string, text: string): void {
    const tags = this.form.reason.tags;
    if (tags.includes(key)) this.form.reason.tags = tags.filter((t) => t !== key);
    else {
      this.form.reason.tags = [...tags, key];
      if (text && !this.form.reason.text.includes(text)) this.form.reason.text = this.form.reason.text ? `${this.form.reason.text.replace(/\.?\s*$/, '')}. ${text}.` : `${text}.`;
    }
  }

  complete(assign: boolean): void {
    this.busy.set(true);
    this.error.set('');
    this.workflow.completeQualification(this.id, assign ? this.assigneeId : null).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.apply(res);
        const name = this.assignees().find((a) => a.id === this.assigneeId)?.name;
        this.done.set(assign ? `Assigned to ${name || 'sales'}` : 'Saved as ready for assignment');
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not completed — nothing was lost. Try again.'); },
    });
  }

  park(status: 'needs_research' | 'unsuitable'): void {
    this.busy.set(true);
    this.workflow.setQualificationStatus(this.id, status, this.parkNote).subscribe({
      next: (res) => { this.busy.set(false); this.apply(res); this.done.set(status === 'unsuitable' ? 'Saved as not suitable' : 'Saved as needing more information'); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — try again.'); },
    });
  }

  searchUrl(key: SourceKey): string {
    const b = this.form.business;
    const q = encodeURIComponent([b.name, b.city, b.state].filter(Boolean).join(' '));
    if (key === 'google') return `https://www.google.com/maps/search/${q}`;
    if (key === 'facebook') return `https://www.facebook.com/search/pages/?q=${q}`;
    return `https://www.google.com/search?q=${q}`;
  }

  statusWord(status: string): string {
    return ({ found: 'found', not_found: 'not found', unable: 'couldn’t open', not_checked: 'not checked' } as Record<string, string>)[status] ?? status;
  }

  host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }
}
