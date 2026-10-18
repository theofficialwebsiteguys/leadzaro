import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { WorkflowService } from '../../core/services/workflow.service';
import { LeadService } from '../../core/services/lead.service';
import { AuthService } from '../../core/services/auth.service';
import { ContactStatus, SourceKey, SourceStatus } from '../../core/models/workflow.model';
import { Lead, PlaceDetails } from '../../core/models/lead.model';
import { IconComponent } from '../../shared/icon/icon.component';

/** What we already know about the business when qualifying starts (a search result, or nothing for manual entry). */
export interface QualifyStart {
  googlePlaceId?: string | null;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  website?: string | null;
  googleMapsUrl?: string | null;
  category?: string | null;
  rating?: number | string | null;
  reviewCount?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string | null;
  facebookUrl?: string | null;
}

export type QualifyOutcome = 'qualified' | 'needs_info' | 'not_relevant';
export interface QualifyResult { opportunityId: string; summary: string; outcome: QualifyOutcome }

const STEPS = ['Worth it?', 'Links', 'Contact', 'Reason', 'Decide'];
const SOURCES: { key: SourceKey; label: string; icon: string }[] = [
  { key: 'google', label: 'Google listing', icon: 'search' },
  { key: 'website', label: 'Website', icon: 'globe' },
  { key: 'facebook', label: 'Facebook page', icon: 'users' },
];
const STATE: Record<string, { state: string; value: string }> = {
  found: { state: 'yes', value: 'Found' }, not_found: { state: 'no', value: 'Not found' }, unable: { state: 'warn', value: 'Couldn’t open' }, not_checked: { state: '', value: '' },
};
const NOT_RELEVANT = ['Permanently closed', 'Chain or franchise', 'Not a business we serve', 'Already has a strong website', 'Already a client or lead', 'Other'];

interface Draft {
  step: number;
  business: { name: string; address: string; city: string; state: string; zip: string; category: string };
  sources: Record<SourceKey, { status: SourceStatus; url: string }>;
  socials: { platform: string; url: string }[];
  contacts: {
    email: { status: ContactStatus; values: { value: string; sourceUrl: string }[] };
    phone: { status: ContactStatus; values: { value: string; label: string; sourceUrl?: string }[] };
    owner: { status: ContactStatus; people: { name: string; title: string }[] };
  };
  reason: { tags: string[]; text: string };
  emailChecked: boolean;
}

interface Existing {
  opportunityId: string; name?: string; label: string; qualificationStatus?: string | null;
  researcher: { id?: string; name: string } | null; assignedTo: { id?: string; name: string } | null; mergeable?: boolean; reason?: string | null; mine?: boolean;
}

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram' }, { key: 'linkedin', label: 'LinkedIn' }, { key: 'tiktok', label: 'TikTok' }, { key: 'x', label: 'X / Twitter' },
  { key: 'youtube', label: 'YouTube' }, { key: 'yelp', label: 'Yelp' }, { key: 'nextdoor', label: 'Nextdoor' }, { key: 'pinterest', label: 'Pinterest' }, { key: 'other', label: 'Other' },
];

/**
 * Qualifying one business, one step at a time (ADR 0016). First decide if
 * it's worth researching; then links, contact details and the reason to
 * reach out; then qualify it, mark it as needing more info, or not
 * relevant. Nothing is saved to Leadzaro until one of those decisions —
 * progress stays in this browser so a refresh doesn't lose it.
 */
@Component({
  selector: 'app-qualify-flow',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    @let message = done();
    <div class="qf" [class.no-aside]="!!message">
      <div class="main">
        <ol class="stepper" aria-label="Steps">
          @for (s of steps; track s; let i = $index) {
            <li [class.current]="d.step === i + 1 && !message" [class.done]="d.step > i + 1 || !!message">
              <button type="button" (click)="goTo(i + 1)" [disabled]="i + 1 > d.step || !!message">
                <span class="dot">@if (d.step > i + 1 || message) { <lz-icon name="check" [size]="12" /> } @else { {{ i + 1 }} }</span>
                <span class="lbl">{{ s }}</span>
              </button>
            </li>
          }
        </ol>

        <section class="card step-card">
          @if (existing(); as e) {
            <p class="eyebrow">Already in Leadzaro</p>
            <h2>{{ start().name }}</h2>
            <p class="sub">{{ e.label }}@if (e.researcher) { · researched by {{ e.researcher.name }} }@if (e.assignedTo) { · {{ e.assignedTo.name }} }</p>
            @if (e.mine) {
              <div class="foot"><span class="spacer"></span><a class="btn btn-primary" [routerLink]="['/app/qualify', e.opportunityId]">Continue it</a></div>
            } @else if (e.mergeable) {
              <p class="hint">You can still qualify it — your research is added to that lead, and it stays with its salesperson.</p>
              <div class="foot"><span class="spacer"></span><button class="btn btn-primary btn-lg" (click)="mergeInto(e)">Qualify it anyway</button></div>
            } @else { <p class="hint">Nothing to do here: {{ e.reason }}</p> }
          } @else if (message) {
            <div class="done">
              <span class="done-icon"><lz-icon name="check-circle" [size]="30" /></span>
              <h2>{{ message }}</h2>
              <p class="sub">Recorded as your work today.</p>
              <button class="btn btn-primary btn-lg" (click)="next.emit()">Next business →</button>
            </div>
          } @else {
            @if (claimedBy(); as who) { <div class="alert alert-warning">{{ who }} started researching this. <button class="link" (click)="takeOver()">Research it anyway</button></div> }
            <p class="eyebrow">Step {{ d.step }} of 5</p>

            @switch (d.step) {
              @case (1) {
                @if (fromSearch() && !editing()) {
                  <h2>Worth researching?</h2>
                  <p class="sub">A quick look before you spend time on it.</p>
                  <ul class="signals">
                    @if (closedWarning()) { <li class="bad"><lz-icon name="alert" [size]="15" /> Google says: {{ closedWarning() }}</li> }
                    @if (start().website) {
                      <li><lz-icon name="globe" [size]="15" /> Has a website — <a [href]="start().website" target="_blank" rel="noopener">take a look ↗</a> and see if it’s outdated or hard to use</li>
                    } @else {
                      <li class="good"><lz-icon name="globe" [size]="15" /> No website listed on Google — often a reason to reach out</li>
                    }
                    @if (start().rating) {
                      <li [class.good]="(start().reviewCount ?? 0) >= 20"><lz-icon name="star" [size]="15" /> {{ start().rating }}★ from {{ start().reviewCount }} reviews{{ (start().reviewCount ?? 0) >= 20 ? ' — an established business' : '' }}</li>
                    } @else { <li><lz-icon name="star" [size]="15" /> No Google reviews yet</li> }
                    @if (details() && !filled(d.contacts.phone.values).length) { <li><lz-icon name="phone" [size]="15" /> No phone on Google</li> }
                  </ul>
                  <div class="gate">
                    <button class="btn btn-outline btn-lg" (click)="trashOpen.set(true)"><lz-icon name="x" [size]="16" /> Not relevant</button>
                    <button class="btn btn-primary btn-lg" (click)="goTo(2)">Research it <lz-icon name="arrow-right" [size]="16" /></button>
                  </div>
                  <button class="link" (click)="editing.set(true)">Details wrong? Edit them</button>
                } @else {
                  <h2>Which business?</h2>
                  <p class="sub">Enough to tell it apart from others with a similar name.</p>
                  <div class="field"><label class="form-label" for="qf-name">Business name</label>
                    <input id="qf-name" class="form-control" [(ngModel)]="d.business.name" (ngModelChange)="save()" /></div>
                  <div class="field"><label class="form-label" for="qf-addr">Street address</label>
                    <input id="qf-addr" class="form-control" [(ngModel)]="d.business.address" (ngModelChange)="save()" /></div>
                  <div class="two">
                    <div class="field"><label class="form-label" for="qf-city">Town</label><input id="qf-city" class="form-control" [(ngModel)]="d.business.city" (ngModelChange)="save()" /></div>
                    <div class="field"><label class="form-label" for="qf-state">State</label><input id="qf-state" class="form-control" [(ngModel)]="d.business.state" (ngModelChange)="save()" /></div>
                  </div>
                  <div class="field"><label class="form-label" for="qf-cat">Kind of business</label>
                    <input id="qf-cat" class="form-control" [(ngModel)]="d.business.category" (ngModelChange)="save()" placeholder="e.g. Roofer" /></div>
                }
              }
              @case (2) {
                <h2>Check their links</h2>
                <p class="sub">Open each one and say what you found. Paste the business’s own page — not a search.</p>
                @for (s of sources; track s.key) {
                  <div class="block" [attr.data-status]="d.sources[s.key].status">
                    <div class="block-top">
                      <span class="block-title"><lz-icon [name]="s.icon" [size]="16" /> {{ s.label }}</span>
                      <span class="links">
                        @if (d.sources[s.key].url) { <a class="btn btn-ghost btn-sm" [href]="d.sources[s.key].url" target="_blank" rel="noopener">Open ↗</a> }
                        <a class="btn btn-ghost btn-sm" [href]="searchUrl(s.key)" target="_blank" rel="noopener">Search ↗</a>
                      </span>
                    </div>
                    <div class="seg">@for (o of sourceOptions; track o.key) { <button type="button" [class.active]="d.sources[s.key].status === o.key" (click)="d.sources[s.key].status = o.key; save()">{{ o.label }}</button> }</div>
                    @if (d.sources[s.key].status === 'found') { <input class="form-control" [(ngModel)]="d.sources[s.key].url" (ngModelChange)="save()" placeholder="https://…" [attr.aria-label]="s.label + ' link'" /> }
                    @if (s.key === 'facebook') {
                      <div class="socials">
                        <span class="hint">Other social profiles (optional)</span>
                        @for (soc of d.socials; track $index; let i = $index) {
                          <div class="multi">
                            <select class="form-select" [(ngModel)]="soc.platform" (ngModelChange)="save()" aria-label="Platform">
                              @for (pl of platforms; track pl.key) { <option [value]="pl.key">{{ pl.label }}</option> }
                            </select>
                            <input class="form-control" [(ngModel)]="soc.url" (ngModelChange)="save()" placeholder="https://…" aria-label="Profile link" />
                            <button type="button" class="rm" (click)="removeAt(d.socials, i)" aria-label="Remove">×</button>
                          </div>
                        }
                        <button type="button" class="add" (click)="d.socials.push({ platform: 'instagram', url: '' }); save()"><lz-icon name="plus" [size]="13" /> Add Instagram, LinkedIn, TikTok…</button>
                      </div>
                    }
                  </div>
                }
              }
              @case (3) {
                <h2>How can sales reach them?</h2>
                <p class="sub">Copy what’s published. Never guess a name or make up an email. Add as many as you find — the first is the main one.</p>
                <div class="block" [attr.data-status]="d.contacts.email.status">
                  <div class="block-top"><span class="block-title"><lz-icon name="mail" [size]="16" /> Email</span>
                    @if (emailChecking()) { <span class="hint"><span class="spinner spinner-sm"></span> Checking their website…</span> }
                    @else if (canCheckEmail()) { <button class="btn btn-ghost btn-sm" (click)="checkEmail(true)">Check website again</button> }</div>
                  @if (emailSummary()) { <p class="hint">{{ emailSummary() }}</p> }
                  @for (cand of candidates(); track cand.email) {
                    @if (!hasEmail(cand.email)) { <button class="suggest" (click)="useEmail(cand.email, cand.sourceUrl)"><lz-icon name="plus" [size]="13" /> Use <strong>{{ cand.email }}</strong>@if (cand.sourceUrl) { <span class="hint">· {{ host(cand.sourceUrl) }}</span> }</button> }
                  }
                  <div class="seg">@for (o of contactOptions; track o.key) { <button type="button" [class.active]="d.contacts.email.status === o.key" (click)="setStatus('email', o.key)">{{ o.label }}</button> }</div>
                  @if (d.contacts.email.status === 'found') {
                    @for (e of d.contacts.email.values; track $index; let i = $index) {
                      <div class="multi">
                        <input class="form-control" type="email" [(ngModel)]="e.value" (ngModelChange)="save()" placeholder="name@business.com" [attr.aria-label]="'Email ' + (i + 1)" />
                        <input class="form-control" [(ngModel)]="e.sourceUrl" (ngModelChange)="save()" placeholder="Where you found it (link)" aria-label="Where you found it" />
                        @if (d.contacts.email.values.length > 1) { <button type="button" class="rm" (click)="removeAt(d.contacts.email.values, i)" aria-label="Remove">×</button> }
                        @if (i === 0 && d.contacts.email.values.length > 1) { <span class="main-tag">main</span> }
                      </div>
                    }
                    <button type="button" class="add" (click)="d.contacts.email.values.push({ value: '', sourceUrl: '' }); save()"><lz-icon name="plus" [size]="13" /> Add another email</button>
                  }
                </div>
                <div class="block" [attr.data-status]="d.contacts.phone.status">
                  <div class="block-top"><span class="block-title"><lz-icon name="phone" [size]="16" /> Phone</span>@if (phoneFromGoogle()) { <span class="hint">from Google</span> }</div>
                  <div class="seg">@for (o of contactOptions; track o.key) { <button type="button" [class.active]="d.contacts.phone.status === o.key" (click)="setStatus('phone', o.key)">{{ o.label }}</button> }</div>
                  @if (d.contacts.phone.status === 'found') {
                    @for (p of d.contacts.phone.values; track $index; let i = $index) {
                      <div class="multi">
                        <input class="form-control" [(ngModel)]="p.value" (ngModelChange)="save()" placeholder="(555) 555-0100" [attr.aria-label]="'Phone ' + (i + 1)" />
                        <select class="form-select" [(ngModel)]="p.label" (ngModelChange)="save()" aria-label="Which number">
                          <option value="">Main line</option><option value="Mobile">Mobile</option><option value="Owner">Owner</option><option value="Office">Office</option><option value="Other">Other</option>
                        </select>
                        @if (d.contacts.phone.values.length > 1) { <button type="button" class="rm" (click)="removeAt(d.contacts.phone.values, i)" aria-label="Remove">×</button> }
                      </div>
                    }
                    <button type="button" class="add" (click)="d.contacts.phone.values.push({ value: '', label: '' }); save()"><lz-icon name="plus" [size]="13" /> Add another number</button>
                  }
                </div>
                <div class="block" [attr.data-status]="d.contacts.owner.status">
                  <div class="block-top"><span class="block-title"><lz-icon name="user" [size]="16" /> Owner or contact people</span><span class="hint">only if published</span></div>
                  <div class="seg">@for (o of contactOptions; track o.key) { <button type="button" [class.active]="d.contacts.owner.status === o.key" (click)="setStatus('owner', o.key)">{{ o.label }}</button> }</div>
                  @if (d.contacts.owner.status === 'found') {
                    @for (person of d.contacts.owner.people; track $index; let i = $index) {
                      <div class="multi">
                        <input class="form-control" [(ngModel)]="person.name" (ngModelChange)="save()" placeholder="Name" [attr.aria-label]="'Person ' + (i + 1)" />
                        <input class="form-control" [(ngModel)]="person.title" (ngModelChange)="save()" placeholder="Role, e.g. Owner" aria-label="Role" />
                        @if (d.contacts.owner.people.length > 1) { <button type="button" class="rm" (click)="removeAt(d.contacts.owner.people, i)" aria-label="Remove">×</button> }
                      </div>
                    }
                    <button type="button" class="add" (click)="d.contacts.owner.people.push({ name: '', title: '' }); save()"><lz-icon name="plus" [size]="13" /> Add another person</button>
                  }
                </div>
              }
              @case (4) {
                <h2>Why should we reach out?</h2>
                <p class="sub">One specific thing you saw. “No website found” isn’t the same as “has no website”.</p>
                <div class="chips">@for (r of reasonOptions(); track r.key) { <button type="button" class="chip" [class.on]="d.reason.tags.includes(r.key)" (click)="toggleReason(r.key, r.text)">{{ r.label }}</button> }</div>
                <textarea class="form-control" rows="4" [(ngModel)]="d.reason.text" (ngModelChange)="save()" maxlength="1000" placeholder="e.g. Their Google listing only links to Facebook; no website found." aria-label="Reason to reach out"></textarea>
                <p class="hint right">{{ d.reason.text.length }}/1000</p>
              }
              @case (5) {
                <h2>Decide</h2>
                <p class="sub">Everything you found is on the right. Hand it to sales, or park it.</p>
                @if (mergeTarget(); as m) { <div class="merge-note"><lz-icon name="leads" [size]="15" /> Your research will be added to the existing lead ({{ m.label }}@if (m.assignedTo) { · {{ m.assignedTo.name }} }) — no duplicate is created.</div> }
                @if (d.reason.text) { <blockquote class="quote">{{ d.reason.text }}</blockquote> }
                @if (missing().length) {
                  <div class="alert alert-warning">To qualify it, still check: @for (m of missing(); track m.label; let last = $last) { <button class="link inline" (click)="goTo(m.step)">{{ m.label }}</button>{{ last ? '' : ', ' }} }</div>
                } @else if (!usable()) {
                  <div class="alert alert-warning">No email or phone, so sales can’t contact them. Mark it as needing more info, or not relevant.</div>
                } @else if (mergeTarget()?.assignedTo) {
                  <p class="hint">It stays with <strong>{{ mergeTarget()?.assignedTo?.name }}</strong>, who’ll be told about your research.</p>
                } @else {
                  <div class="field"><label class="form-label" for="qf-who">Assign to</label>
                    <select id="qf-who" class="form-select" [(ngModel)]="assignee">
                      <option value="">Choose a salesperson…</option>
                      @for (a of assignees(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                    </select></div>
                }
                @if (needsInfoOpen()) {
                  <div class="field"><label class="form-label" for="qf-need">What’s missing?</label>
                    <input id="qf-need" class="form-control" [(ngModel)]="needsInfoNote" placeholder="e.g. No phone or email anywhere — try Instagram" /></div>
                }
                @if (conflict(); as c) {
                  <div class="conflict">
                    <strong>{{ c.name }} is already in Leadzaro</strong>
                    <span>{{ c.label }}@if (c.assignedTo) { · {{ c.assignedTo.name }} }</span>
                    @if (c.mergeable) {
                      <p class="hint">Add your links, contacts and reason to that lead instead of creating a new one.</p>
                      <div class="foot-row"><button class="btn btn-primary" (click)="mergeInto(c)">Add my research to it</button></div>
                    } @else { <p class="hint">Can’t add research: {{ c.reason }}</p> }
                  </div>
                }
                @if (duplicates().length) {
                  <div class="conflict">
                    <strong>This may already be in Leadzaro</strong>
                    @for (x of duplicates(); track x.organizationId) {
                      <div class="dup-row">
                        <span><strong>{{ x.name }}</strong> — {{ x.reasons.join(', ') }}@if (x.stageLabel) { · {{ x.stageLabel }} }@if (x.assignedTo) { · {{ x.assignedTo.name }} }</span>
                        @if (x.opportunityId) { <button class="btn btn-outline btn-sm" (click)="mergeIntoId(x.opportunityId)">Merge into this one</button> }
                      </div>
                    }
                    <div class="foot-row"><button class="btn btn-ghost btn-sm" (click)="qualify(true)">It’s a different business — keep it separate</button></div>
                  </div>
                }
              }
            }

            @if (trashOpen()) {
              <div class="trash">
                <strong>Why isn’t it relevant?</strong>
                <div class="chips">@for (r of notRelevant; track r) { <button type="button" class="chip" [class.on]="trashReason === r" (click)="trashReason = r">{{ r }}</button> }</div>
                @if (trashReason === 'Other') { <input class="form-control" [(ngModel)]="trashDetail" placeholder="Say briefly why" aria-label="Why" /> }
                <div class="foot-row">
                  <button class="btn btn-ghost" (click)="trashOpen.set(false)">Cancel</button>
                  <button class="btn btn-danger" (click)="notRelevantSave()" [disabled]="busy() || !trashReason || (trashReason === 'Other' && !trashDetail.trim())">Mark not relevant</button>
                </div>
              </div>
            }
            @if (error()) { <div class="alert alert-error" role="alert">{{ error() }}</div> }

            @if (!(d.step === 1 && fromSearch() && !editing())) {
              <footer class="foot">
                @if (d.step > 1) { <button class="btn btn-ghost" (click)="goTo(d.step - 1)">← Back</button> }
                <button class="btn btn-ghost danger" (click)="trashOpen.set(true)">Not relevant</button>
                <span class="spacer"></span>
                @if (d.step < 5) {
                  <button class="btn btn-primary btn-lg" (click)="goTo(d.step + 1)" [disabled]="!stepReady()">Continue <lz-icon name="arrow-right" [size]="15" /></button>
                } @else if (needsInfoOpen()) {
                  <button class="btn btn-ghost" (click)="needsInfoOpen.set(false)">Cancel</button>
                  <button class="btn btn-primary" (click)="needsInfo()" [disabled]="busy() || !needsInfoNote.trim()">Save as needs more info</button>
                } @else {
                  <button class="btn btn-outline" (click)="needsInfoOpen.set(true)">Needs more info</button>
                  @if (!missing().length && usable()) {
                    <button class="btn btn-primary btn-lg" (click)="qualify(false)" [disabled]="busy() || (!assignee && !mergeTarget()?.assignedTo)">{{ busy() ? 'Saving…' : (mergeTarget() ? 'Qualify & add to lead' : 'Qualify & assign') }}</button>
                  }
                }
              </footer>
            }
          }
        </section>
        @if (!message) { <p class="note"><lz-icon name="check" [size]="12" /> Nothing is saved until you decide — your progress stays on this computer.</p> }
      </div>

      <aside class="aside">
        <section class="card snap">
          <div class="snap-head">
            <span class="avatar">{{ (d.business.name || '?').charAt(0).toUpperCase() }}</span>
            <div class="snap-name"><strong>{{ d.business.name || 'New business' }}</strong><span>{{ d.business.category || 'Business' }}</span></div>
          </div>
          @if (start().rating) { <p class="rating"><span class="stars">★ {{ start().rating }}</span> · {{ start().reviewCount }} reviews</p> }
          @if (closedWarning()) { <p class="closed"><lz-icon name="alert" [size]="13" /> {{ closedWarning() }}</p> }
          <ul class="snap-facts">
            <li><lz-icon name="globe" [size]="14" />
              @if (d.sources.website.status === 'found' && d.sources.website.url) { <a [href]="d.sources.website.url" target="_blank" rel="noopener">{{ host(d.sources.website.url) }}</a> }
              @else if (d.sources.website.status === 'not_found' || (!start().website && fromSearch())) { <span class="tag-warn">No website</span> }
              @else { <span class="muted">Website not checked</span> }</li>
            <li><lz-icon name="phone" [size]="14" />@if (filled(d.contacts.phone.values).length && d.contacts.phone.status === 'found') { <span class="stack">@for (ph of filled(d.contacts.phone.values); track $index) { <span>{{ ph.value }}@if (ph.label) { <span class="muted"> · {{ ph.label }}</span> }</span> }</span> } @else { <span class="muted">{{ d.contacts.phone.status === 'not_found' ? 'No phone found' : 'Phone not checked' }}</span> }</li>
            <li><lz-icon name="mail" [size]="14" />
              @if (d.contacts.email.status === 'found' && filled(d.contacts.email.values).length) { <span class="stack">@for (em of filled(d.contacts.email.values); track $index) { <span>{{ em.value }}</span> }</span> }
              @else if (emailChecking()) { <span class="muted">Checking website…</span> }
              @else { <span class="muted">{{ d.contacts.email.status === 'not_found' ? 'No email found' : 'Email not checked' }}</span> }</li>
            @if (d.contacts.owner.status === 'found') { @for (person of filledPeople(); track $index) { <li><lz-icon name="user" [size]="14" /> {{ person.name }}@if (person.title) { <span class="muted"> · {{ person.title }}</span> }</li> } }
            @if (todayHours()) { <li><lz-icon name="clock" [size]="14" /> <span>{{ todayHours() }}</span></li> }
            @if (d.business.address || d.business.city) { <li><lz-icon name="target" [size]="14" /> <span>{{ [d.business.address, d.business.city].filter(truthy).join(', ') }}</span></li> }
          </ul>
          <div class="snap-links">
            @if (d.sources.google.url) { <a [href]="d.sources.google.url" target="_blank" rel="noopener">Google listing ↗</a> }
            @if (d.sources.facebook.url) { <a [href]="d.sources.facebook.url" target="_blank" rel="noopener">Facebook ↗</a> } @else { <a [href]="searchUrl('facebook')" target="_blank" rel="noopener">Find on Facebook ↗</a> }
            @for (soc of d.socials; track $index) { @if (soc.url) { <a [href]="soc.url" target="_blank" rel="noopener">{{ platformLabel(soc.platform) }} ↗</a> } }
          </div>
        </section>

        <section class="card snap">
          <h4>Research so far</h4>
          <ul class="checklist">
            @for (row of checklist(); track row.label) {
              <li [attr.data-state]="row.state"><span class="mark">{{ row.state === 'yes' ? '✓' : row.state === 'no' ? '–' : row.state === 'warn' ? '!' : '' }}</span>{{ row.label }}<span class="val">{{ row.value }}</span></li>
            }
          </ul>
        </section>
        <ng-content />
      </aside>
    </div>
  `,
  styles: [`
    .qf { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start;
      &.no-aside { grid-template-columns: minmax(0, 1fr); .aside { display: none; } }
      @media (max-width: 960px) { grid-template-columns: 1fr; } }
    .main { min-width: 0; }

    .stepper { list-style: none; display: flex; padding: 0; margin: 0 0 14px;
      li { flex: 1; position: relative; }
      li + li::before { content: ''; position: absolute; top: 14px; left: calc(-50% + 16px); right: calc(50% + 16px); height: 2px; background: var(--border); }
      li.done + li::before, li.done + li.current::before { background: var(--success); }
      button { width: 100%; background: none; border: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; padding: 0; color: var(--text-muted); font-size: .74rem; }
      button:disabled { cursor: default; }
      .dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--card); border: 2px solid var(--border); font-weight: 700; font-size: .78rem; position: relative; z-index: 1; }
      li.done .dot { background: var(--success); border-color: var(--success); color: #fff; }
      li.done .lbl { color: var(--text-secondary); }
      li.current .dot { background: var(--primary); border-color: var(--primary); color: #fff; box-shadow: 0 0 0 4px var(--primary-50); }
      li.current .lbl { color: var(--primary-dark); font-weight: 700; } }

    .step-card { padding: 24px 26px; display: flex; flex-direction: column; gap: 12px;
      h2 { margin: 0; font-size: 1.4rem; font-family: var(--font-display); letter-spacing: -.01em; }
      .sub { margin: -4px 0 4px; color: var(--text-muted); font-size: .9rem; } }
    .eyebrow { margin: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--primary); font-weight: 700; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; @media (max-width: 560px) { grid-template-columns: 1fr; } }

    .signals { list-style: none; padding: 0; margin: 2px 0 6px; display: flex; flex-direction: column; gap: 8px;
      li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: var(--radius); background: var(--bg); font-size: .9rem; color: var(--text-secondary); }
      li.good { background: var(--success-bg, #dcfce7); color: var(--success); }
      li.bad { background: var(--danger-bg); color: var(--danger-text); font-weight: 600; } }
    .gate { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; .btn { justify-content: center; padding: 15px; gap: 8px; } }

    .block { border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; border-left-width: 4px;
      &[data-status='found'] { border-left-color: var(--success); }
      &[data-status='not_found'] { border-left-color: #94a3b8; }
      &[data-status='unable'] { border-left-color: var(--warning); } }
    .block-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; .links { display: flex; gap: 4px; } }
    .block-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-primary); }
    .seg { display: flex; gap: 6px; button { flex: 1; border: 1.5px solid var(--border); background: var(--card); border-radius: 10px; padding: 9px; font-size: .85rem; cursor: pointer; color: var(--text-secondary);
      &:hover { border-color: var(--primary-200); } &.active { border-color: var(--primary); background: var(--primary-50); color: var(--primary-dark); font-weight: 600; } } }
    .hint { font-size: .78rem; color: var(--text-muted); margin: 0; display: inline-flex; gap: 6px; align-items: center; &.right { align-self: flex-end; } }
    .suggest { display: flex; gap: 6px; align-items: center; text-align: left; border: 1px dashed var(--primary-200); background: var(--primary-50); border-radius: 10px; padding: 9px 12px; font-size: .86rem; cursor: pointer; color: var(--text-primary); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { border: 1.5px solid var(--border); background: var(--card); border-radius: var(--radius-full); padding: 8px 14px; font-size: .85rem; cursor: pointer;
      &:hover { border-color: var(--primary-200); } &.on { border-color: var(--primary); background: var(--primary-50); color: var(--primary-dark); font-weight: 600; } }
    .multi { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; position: relative; @media (max-width: 560px) { grid-template-columns: 1fr; } }
    .rm { background: none; border: 0; font-size: 1.2rem; color: var(--text-muted); cursor: pointer; padding: 0 6px; }
    .main-tag { position: absolute; right: 36px; top: -8px; font-size: .62rem; text-transform: uppercase; background: var(--primary); color: #fff; border-radius: 6px; padding: 1px 6px; }
    .add { align-self: flex-start; display: inline-flex; gap: 6px; align-items: center; background: none; border: 1px dashed var(--border); border-radius: 8px; padding: 6px 10px; font-size: .8rem; color: var(--primary); cursor: pointer; &:hover { border-color: var(--primary-200); } }
    .socials { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
    .conflict { border: 1.5px solid var(--warning); background: var(--warning-bg); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: .88rem; }
    .dup-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .merge-note { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 10px; background: var(--primary-50); font-size: .86rem; }
    .stack { display: flex; flex-direction: column; }
    .quote { margin: 0; padding: 12px 14px; border-left: 3px solid var(--primary); background: var(--primary-50); border-radius: 0 10px 10px 0; font-size: .92rem; }
    .trash { border: 1.5px solid var(--danger); background: var(--danger-bg); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .link { background: none; border: 0; color: var(--primary); cursor: pointer; padding: 0; font-size: .82rem; align-self: flex-start; &.inline { font-size: inherit; text-decoration: underline; } }
    .foot { display: flex; gap: 8px; align-items: center; margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border); .spacer { flex: 1; } .danger { color: var(--danger-text); } .btn-lg { gap: 6px; } }
    .foot-row { display: flex; gap: 8px; justify-content: flex-end; }
    .note { display: flex; gap: 6px; align-items: center; margin: 10px 2px 0; font-size: .74rem; color: var(--text-muted); }
    .done { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 30px 0; .done-icon { color: var(--success); } }

    .aside { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 16px; }
    .snap { padding: 16px 18px; h4 { margin: 0 0 10px; font-size: .75rem; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); } }
    .snap-head { display: flex; gap: 12px; align-items: center; }
    .avatar { width: 40px; height: 40px; border-radius: 12px; background: var(--brand-gradient); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 1.1rem; flex-shrink: 0; }
    .snap-name { display: flex; flex-direction: column; min-width: 0; strong { font-size: .98rem; line-height: 1.25; } span { font-size: .78rem; color: var(--text-muted); } }
    .rating { margin: 10px 0 0; font-size: .8rem; color: var(--text-muted); .stars { color: #b45309; font-weight: 700; } }
    .closed { margin: 8px 0 0; font-size: .8rem; color: var(--danger-text); display: flex; gap: 6px; align-items: center; font-weight: 600; }
    .snap-facts { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; font-size: .84rem;
      li { display: flex; gap: 8px; align-items: flex-start; min-width: 0; word-break: break-word; lz-icon { color: var(--text-muted); margin-top: 2px; flex-shrink: 0; } } }
    .muted { color: var(--text-muted); }
    .tag-warn { background: var(--warning-bg); color: var(--warning-text, #92400e); border-radius: var(--radius-full); padding: 1px 8px; font-size: .75rem; font-weight: 600; }
    .snap-links { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); font-size: .8rem; }
    .checklist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 7px; font-size: .84rem;
      li { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
      .mark { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border); display: grid; place-items: center; font-size: .68rem; font-weight: 800; flex-shrink: 0; }
      .val { margin-left: auto; font-size: .75rem; }
      li[data-state='yes'] { color: var(--text-primary); .mark { background: var(--success); border-color: var(--success); color: #fff; } }
      li[data-state='no'] { color: var(--text-secondary); .mark { background: #e2e8f0; border-color: #cbd5e1; color: #64748b; } }
      li[data-state='warn'] { color: var(--text-secondary); .mark { background: var(--warning-bg); border-color: var(--warning); color: #92400e; } } }
  `],
})
export class QualifyFlowComponent implements OnInit, OnDestroy {
  private readonly workflow = inject(WorkflowService);
  private readonly leads = inject(LeadService);
  private readonly auth = inject(AuthService);

  readonly start = input.required<QualifyStart>();
  /** In a session the parent moves on by itself after each decision. */
  readonly session = input(false);
  readonly completed = output<QualifyResult>();
  readonly next = output<void>();

  readonly steps = STEPS;
  readonly sources = SOURCES;
  readonly notRelevant = NOT_RELEVANT;
  readonly truthy = (v: unknown) => Boolean(v);
  readonly sourceOptions: { key: SourceStatus; label: string }[] = [{ key: 'found', label: 'Found' }, { key: 'not_found', label: 'Not found' }, { key: 'unable', label: 'Couldn’t open' }];
  readonly contactOptions: { key: ContactStatus; label: string }[] = [{ key: 'found', label: 'Found' }, { key: 'not_found', label: 'Not found' }];
  readonly assignees = signal<{ id: string; name: string }[]>([]);
  readonly reasonOptions = signal<{ key: string; label: string; text: string }[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly done = signal<string | null>(null);
  readonly claimedBy = signal<string | null>(null);
  readonly existing = signal<Existing | null>(null);
  readonly duplicates = signal<{ organizationId: string; name: string; reasons: string[]; opportunityId: string | null; stageLabel?: string | null; assignedTo: { name: string } | null }[]>([]);
  /** An existing lead this research will be added to, instead of creating a new one. */
  readonly mergeTarget = signal<Existing | null>(null);
  /** The listing turned out to be in Leadzaro already (found when saving). */
  readonly conflict = signal<Existing | null>(null);
  readonly platforms = PLATFORMS;
  readonly emailChecking = signal(false);
  readonly emailSummary = signal('');
  readonly candidates = signal<{ email: string; sourceUrl: string | null }[]>([]);
  readonly details = signal<PlaceDetails | null>(null);
  readonly editing = signal(false);
  readonly trashOpen = signal(false);
  readonly needsInfoOpen = signal(false);
  private readonly version = signal(0);

  d: Draft = this.blank();
  assignee = '';
  trashReason = '';
  trashDetail = '';
  needsInfoNote = '';

  readonly fromSearch = computed(() => Boolean(this.start().googlePlaceId));
  private get key(): string { return `lz.qualify.${this.start().googlePlaceId || 'manual'}`; }

  readonly missing = computed(() => {
    this.version();
    const d = this.d;
    const out: { step: number; label: string }[] = [];
    if (!d.business.name.trim()) out.push({ step: 1, label: 'business name' });
    if (!d.business.city.trim() && !d.business.address.trim()) out.push({ step: 1, label: 'town or address' });
    for (const s of SOURCES) if (d.sources[s.key].status === 'not_checked') out.push({ step: 2, label: s.label });
    if (d.contacts.email.status === 'not_checked') out.push({ step: 3, label: 'email' });
    else if (d.contacts.email.status === 'found' && !d.contacts.email.values.some((e) => e.value.trim())) out.push({ step: 3, label: 'email address' });
    if (d.contacts.phone.status === 'not_checked') out.push({ step: 3, label: 'phone' });
    else if (d.contacts.phone.status === 'found' && !d.contacts.phone.values.some((x) => x.value.trim())) out.push({ step: 3, label: 'phone number' });
    if (!d.reason.text.trim()) out.push({ step: 4, label: 'reason' });
    return out;
  });
  /** The running "research so far" list beside the steps. */
  readonly checklist = computed(() => {
    this.version();
    const d = this.d;
    const row = (label: string, status: string) => ({ label, ...STATE[status] });
    return [
      ...SOURCES.map((s) => row(s.label, d.sources[s.key].status)),
      row('Email', d.contacts.email.status),
      row('Phone', d.contacts.phone.status),
      row('Contact name', d.contacts.owner.status),
      { label: 'Reason to reach out', state: d.reason.text.trim() ? 'yes' : '', value: d.reason.text.trim() ? 'Written' : '' },
    ];
  });
  readonly usable = computed(() => { this.version(); return this.d.contacts.email.status === 'found' || this.d.contacts.phone.status === 'found'; });
  readonly closedWarning = computed(() => {
    const status = this.details()?.businessStatus;
    if (!status || status === 'OPERATIONAL') return '';
    return ({ CLOSED_PERMANENTLY: 'Permanently closed', CLOSED_TEMPORARILY: 'Temporarily closed' } as Record<string, string>)[status] ?? status;
  });
  readonly todayHours = computed(() => {
    const hours = this.details()?.hours ?? [];
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    return hours.find((h) => h.startsWith(day)) ?? hours[0] ?? '';
  });

  ngOnInit(): void {
    this.restore();
    this.workflow.qualifySetup().subscribe({ next: (r) => { this.assignees.set(r.assignees); this.reasonOptions.set(r.reasonOptions); }, error: () => undefined });
    const placeId = this.start().googlePlaceId;
    if (!placeId) return;
    this.workflow.claimResearch({ googlePlaceId: placeId, name: this.start().name }).subscribe({
      next: (r) => {
        if (r.existing) {
          const researching = ['draft', 'needs_research', 'needs_correction', 'ready'].includes(r.existing.qualificationStatus ?? '');
          this.existing.set({ ...r.existing, mine: researching && r.existing.researcher?.id === this.auth.currentUser()?.id });
        } else if (r.claimedBy) this.claimedBy.set(r.claimedBy.name);
      },
      error: () => undefined,
    });
    // Google's own details: phone, opening hours, and whether it's still open.
    this.leads.getFullDetails(placeId).subscribe({
      next: (res) => {
        const det = res.data.details;
        this.details.set(det);
        if (det.phone && this.d.contacts.phone.status === 'not_checked') this.d.contacts.phone = { status: 'found', values: [{ value: det.phone, label: '', sourceUrl: this.d.sources.google.url }] };
        if (det.googleMapsUrl && !this.d.sources.google.url) this.d.sources.google = { status: 'found', url: det.googleMapsUrl };
        if (det.address && !this.d.business.address) this.d.business.address = det.address;
        this.save();
      },
      error: () => this.details.set({ available: false, phone: null, hours: [] }),
    });
    if (this.d.step === 3) this.autoCheckEmail();
  }

  ngOnDestroy(): void {
    if (!this.done()) this.save();
  }

  private blank(): Draft {
    return {
      step: 1,
      business: { name: '', address: '', city: '', state: '', zip: '', category: '' },
      sources: { google: { status: 'not_checked', url: '' }, website: { status: 'not_checked', url: '' }, facebook: { status: 'not_checked', url: '' } },
      socials: [],
      contacts: {
        email: { status: 'not_checked', values: [{ value: '', sourceUrl: '' }] },
        phone: { status: 'not_checked', values: [{ value: '', label: '' }] },
        owner: { status: 'not_checked', people: [{ name: '', title: '' }] },
      },
      reason: { tags: [], text: '' },
      emailChecked: false,
    };
  }

  /** Picks up where you left off on this computer, or starts from what the search found. */
  private restore(): void {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) { this.d = this.upgrade({ ...this.blank(), ...JSON.parse(raw) }); this.bump(); return; }
    } catch { /* storage unavailable — start fresh */ }
    const s = this.start();
    const d = this.blank();
    d.business = { name: s.name || '', address: s.address || '', city: s.city || '', state: s.state || '', zip: s.zip || '', category: s.category || '' };
    const maps = s.googleMapsUrl || (s.googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${s.googlePlaceId}` : '');
    if (maps) d.sources.google = { status: 'found', url: maps };
    if (s.website) d.sources.website = { status: 'found', url: s.website };
    if (s.facebookUrl) d.sources.facebook = { status: 'not_checked', url: s.facebookUrl };
    if (s.phone) d.contacts.phone = { status: 'found', values: [{ value: s.phone, label: '', sourceUrl: maps }] };
    this.d = d;
    this.bump();
  }

  private bump(): void { this.version.update((v) => v + 1); }

  save(): void {
    this.bump();
    try { localStorage.setItem(this.key, JSON.stringify(this.d)); } catch { /* progress lasts while the page is open */ }
  }

  stepReady(): boolean {
    this.version();
    if (this.d.step === 1) return Boolean(this.d.business.name.trim() && (this.d.business.city.trim() || this.d.business.address.trim()));
    return true;
  }

  goTo(step: number): void {
    if (step < 1 || step > 5) return;
    this.error.set('');
    this.trashOpen.set(false);
    this.d.step = step;
    this.save();
    if (step === 3) this.autoCheckEmail();
  }

  takeOver(): void {
    const placeId = this.start().googlePlaceId;
    if (!placeId) return;
    this.workflow.claimResearch({ googlePlaceId: placeId, name: this.start().name, takeOver: true }).subscribe({ next: () => this.claimedBy.set(null), error: () => undefined });
  }

  // ---- contact helpers (none of these save anything)

  canCheckEmail(): boolean {
    return Boolean(this.start().googlePlaceId && this.d.sources.website.status === 'found' && this.d.sources.website.url);
  }

  private autoCheckEmail(): void {
    if (!this.d.emailChecked && this.canCheckEmail() && this.d.contacts.email.status === 'not_checked') this.checkEmail(false);
  }

  checkEmail(force: boolean): void {
    const s = this.start();
    this.emailChecking.set(true);
    this.leads.discoverEmail({ id: s.googlePlaceId!, googlePlaceId: s.googlePlaceId!, name: this.d.business.name, website: this.d.sources.website.url } as Lead, force).subscribe({
      next: (res) => {
        const r = res.data.discovery;
        this.emailChecking.set(false);
        this.d.emailChecked = true;
        this.emailSummary.set(r.summary || '');
        const list = [...(r.email ? [{ email: r.email, sourceUrl: r.emailSourceUrl }] : []), ...(r.candidates || []).map((c) => ({ email: c.email, sourceUrl: c.sourceUrl }))];
        this.candidates.set(list.filter((c, i) => list.findIndex((x) => x.email === c.email) === i));
        if (r.facebook?.url && !this.d.sources.facebook.url) this.d.sources.facebook.url = r.facebook.url;
        this.save();
      },
      error: () => { this.emailChecking.set(false); this.emailSummary.set('Couldn’t check the website — look on their contact page yourself.'); },
    });
  }

  useEmail(email: string, sourceUrl: string | null): void {
    const list = this.d.contacts.email.values.filter((e) => e.value.trim());
    this.d.contacts.email = { status: 'found', values: [...list, { value: email, sourceUrl: sourceUrl || '' }] };
    this.save();
  }

  hasEmail(email: string): boolean {
    return this.d.contacts.email.values.some((e) => e.value.trim().toLowerCase() === email.toLowerCase());
  }

  /** Found/Not found for a contact type; "found" always leaves one row to fill in. */
  setStatus(kind: 'email' | 'phone' | 'owner', status: ContactStatus): void {
    const c = this.d.contacts[kind];
    c.status = status;
    if (kind === 'email' && !this.d.contacts.email.values.length) this.d.contacts.email.values.push({ value: '', sourceUrl: '' });
    if (kind === 'phone' && !this.d.contacts.phone.values.length) this.d.contacts.phone.values.push({ value: '', label: '' });
    if (kind === 'owner' && !this.d.contacts.owner.people.length) this.d.contacts.owner.people.push({ name: '', title: '' });
    this.save();
  }

  removeAt<T>(list: T[], index: number): void {
    list.splice(index, 1);
    this.save();
  }

  filled<T extends { value: string }>(list: T[]): T[] {
    return list.filter((x) => x.value.trim());
  }

  filledPeople(): { name: string; title: string }[] {
    return this.d.contacts.owner.people.filter((p) => p.name.trim());
  }

  phoneFromGoogle(): boolean {
    return Boolean(this.d.contacts.phone.values[0]?.sourceUrl && this.d.contacts.phone.values[0]?.value);
  }

  platformLabel(key: string): string {
    return PLATFORMS.find((p) => p.key === key)?.label ?? 'Profile';
  }

  /** Drafts saved before lists existed are converted, so nothing typed is lost. */
  private upgrade(d: Draft): Draft {
    const c = d.contacts as unknown as Record<string, Record<string, unknown>>;
    if (!Array.isArray(c['email']?.['values'])) d.contacts.email = { status: (c['email']?.['status'] as ContactStatus) ?? 'not_checked', values: [{ value: String(c['email']?.['value'] ?? ''), sourceUrl: String(c['email']?.['sourceUrl'] ?? '') }] };
    if (!Array.isArray(c['phone']?.['values'])) d.contacts.phone = { status: (c['phone']?.['status'] as ContactStatus) ?? 'not_checked', values: [{ value: String(c['phone']?.['value'] ?? ''), label: '', sourceUrl: String(c['phone']?.['sourceUrl'] ?? '') }] };
    if (!Array.isArray(c['owner']?.['people'])) d.contacts.owner = { status: (c['owner']?.['status'] as ContactStatus) ?? 'not_checked', people: [{ name: String(c['owner']?.['name'] ?? ''), title: String(c['owner']?.['title'] ?? '') }] };
    d.socials = Array.isArray(d.socials) ? d.socials : [];
    return d;
  }

  // ---- merging into a lead that already exists

  mergeInto(e: Existing): void {
    this.existing.set(null);
    this.conflict.set(null);
    this.duplicates.set([]);
    this.mergeTarget.set({ ...e });
    if (this.d.step === 5 && !this.missing().length && this.usable() && e.assignedTo) this.qualify(false);
    else if (this.d.step < 2) this.goTo(2);
  }

  /** A possible match picked from the duplicate list. */
  mergeIntoId(opportunityId: string): void {
    const dup = this.duplicates().find((x) => x.opportunityId === opportunityId);
    this.mergeInto({ opportunityId, label: dup?.stageLabel ?? 'Lead', researcher: null, assignedTo: dup?.assignedTo ?? null, mergeable: true, name: dup?.name });
  }

  toggleReason(key: string, text: string): void {
    const r = this.d.reason;
    if (r.tags.includes(key)) r.tags = r.tags.filter((t) => t !== key);
    else {
      r.tags = [...r.tags, key];
      if (text && !r.text.includes(text)) r.text = r.text ? `${r.text.replace(/\.?\s*$/, '')}. ${text}.` : `${text}.`;
    }
    this.save();
  }

  // ---- decisions (the only things that save)

  private body(confirmNew: boolean): Record<string, unknown> {
    const s = this.start();
    const d = this.d;
    return {
      leadData: {
        name: d.business.name.trim(),
        address: d.business.address || null,
        city: d.business.city || null,
        state: d.business.state || null,
        zip: d.business.zip || null,
        category: d.business.category || null,
        phone: d.contacts.phone.status === 'found' ? (d.contacts.phone.values.find((x) => x.value.trim())?.value ?? null) : null,
        website: d.sources.website.status === 'found' ? d.sources.website.url : null,
        googleMapsUrl: d.sources.google.status === 'found' ? d.sources.google.url : (s.googleMapsUrl || null),
        googlePlaceId: s.googlePlaceId || null,
        rating: s.rating ?? null,
        reviewCount: s.reviewCount ?? 0,
        latitude: s.latitude ?? null,
        longitude: s.longitude ?? null,
        source: s.googlePlaceId ? (s.source === 'demo' ? 'demo' : 'google') : 'manual',
      },
      confirmNew,
      mergeIntoOpportunityId: this.mergeTarget()?.opportunityId ?? null,
      sources: d.sources,
      socials: d.socials.filter((x) => x.url.trim()),
      contacts: {
        email: { status: d.contacts.email.status, values: d.contacts.email.values.filter((x) => x.value.trim()) },
        phone: { status: d.contacts.phone.status, values: d.contacts.phone.values.filter((x) => x.value.trim()) },
        owner: { status: d.contacts.owner.status, people: d.contacts.owner.people.filter((x) => x.name.trim()) },
      },
      reason: d.reason,
    };
  }

  qualify(confirmNew: boolean): void {
    const merge = this.mergeTarget();
    const who = merge?.assignedTo?.name || this.assignees().find((a) => a.id === this.assignee)?.name || 'sales';
    this.submit({ ...this.body(confirmNew), assigneeUserId: this.assignee || null }, merge ? `Research added to the existing lead — ${who} has it` : `Qualified — assigned to ${who}`, 'qualified');
  }

  needsInfo(): void {
    this.submit({ ...this.body(true), park: { status: 'needs_research', note: this.needsInfoNote } }, 'Saved as needing more info', 'needs_info');
  }

  notRelevantSave(): void {
    const detail = this.trashDetail.trim();
    const note = this.trashReason === 'Other' ? detail : `${this.trashReason}${detail ? ` — ${detail}` : ''}`;
    this.submit({ ...this.body(true), park: { status: 'unsuitable', note } }, 'Marked not relevant', 'not_relevant');
  }

  private submit(body: Record<string, unknown>, summary: string, outcome: QualifyOutcome): void {
    this.busy.set(true);
    this.error.set('');
    this.duplicates.set([]);
    this.workflow.createQualified(body).subscribe({
      next: (res) => {
        this.busy.set(false);
        try { localStorage.removeItem(this.key); } catch { /* nothing stored */ }
        if (!this.session()) this.done.set(summary);
        this.completed.emit({ opportunityId: res.qualification.opportunityId, summary, outcome });
      },
      error: (err) => {
        this.busy.set(false);
        if (err.status === 409 && err.error?.possibleDuplicates) { this.goTo(5); this.duplicates.set(err.error.possibleDuplicates); return; }
        if (err.status === 409 && err.error?.existing) { this.goTo(5); this.conflict.set(err.error.existing); return; }
        if (err.error?.missing?.length) this.goTo(err.error.missing[0].step);
        this.error.set(err.error?.message || 'Not saved — your answers are still here. Try again.');
      },
    });
  }

  /** Lets the listing go (skipped), keeping nothing. */
  release(): void {
    try { localStorage.removeItem(this.key); } catch { /* nothing stored */ }
    const placeId = this.start().googlePlaceId;
    if (placeId) this.workflow.releaseResearch(placeId).subscribe({ error: () => undefined });
  }

  word(status: string): string {
    return ({ found: 'found', not_found: 'not found', unable: 'couldn’t open', not_checked: 'not checked' } as Record<string, string>)[status] ?? status;
  }

  host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  searchUrl(key: SourceKey): string {
    const q = encodeURIComponent([this.d.business.name, this.d.business.city, this.d.business.state].filter(Boolean).join(' '));
    if (key === 'google') return `https://www.google.com/maps/search/${q}`;
    if (key === 'facebook') return `https://www.facebook.com/search/pages/?q=${q}`;
    return `https://www.google.com/search?q=${q}`;
  }
}
