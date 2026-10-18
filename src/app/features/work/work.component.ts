import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { SalesService, actionKey } from '../../core/services/sales.service';
import { WorkflowService } from '../../core/services/workflow.service';
import { WorkQueueService } from '../../core/services/work-queue.service';
import { Workspace } from '../../core/models/sales.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { DialogComponent } from '../../shared/dialog/dialog.component';
import { ComposerComponent } from '../sales/workspace/composer.component';
import {
  MoneyPipe, RelativeDayPipe, nextActionLabel, suggestDate, toLocalInput,
} from '../sales/shared/sales-format';
import { INTEREST_LABELS, InterestLevel } from '../../core/models/workflow.model';

type Task = 'researching' | 'blocked' | 'contact' | 'meeting' | 'pricing' | 'payment' | 'submit' | 'waiting' | 'done';
type ContactStep = 'reach' | 'outcome' | 'next';
type Outcome = 'no_answer' | 'voicemail' | 'email_sent' | 'interested' | 'not_now' | 'not_interested' | 'wrong_contact' | 'do_not_contact';

const OUTCOMES: { key: Outcome; label: string; tone?: string }[] = [
  { key: 'no_answer', label: 'No answer' },
  { key: 'voicemail', label: 'Left a voicemail' },
  { key: 'email_sent', label: 'Sent a message — waiting' },
  { key: 'interested', label: 'Interested', tone: 'good' },
  { key: 'not_now', label: 'Not right now' },
  { key: 'not_interested', label: 'Not interested' },
  { key: 'wrong_contact', label: 'Wrong number / contact' },
  { key: 'do_not_contact', label: 'Don’t contact us', tone: 'bad' },
];

function dates(days: number[]): { label: string; value: string }[] {
  const label = (d: number) => (d === 1 ? 'Tomorrow' : d < 7 ? `In ${d} days` : d === 7 ? 'Next week' : d < 60 ? `In ${Math.round(d / 7)} weeks` : `In ${Math.round(d / 30)} months`);
  return days.map((d) => ({ label: label(d), value: toLocalInput(suggestDate(d)) }));
}

/**
 * Work a lead, one step at a time (ADR 0016). The screen shows only the
 * one thing to do now — reach out, record what happened, set what's next —
 * and moves on to the next lead. Meetings, pricing, payment and closing
 * appear as the single card when the deal gets there. Everything else is
 * one click away in the full record. Nothing is sent or charged without an
 * explicit button.
 */
@Component({
  selector: 'app-work',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, IconComponent, DialogComponent, ComposerComponent, MoneyPipe, RelativeDayPipe],
  template: `
    <div class="work">
      @if (inQueue()) {
        <header class="card session-head">
          <div class="sh-top">
            <div><p class="eyebrow">Working through</p><h1>{{ queueLabel() }}</h1></div>
            <div class="sh-actions">
              <button class="btn btn-ghost btn-sm" (click)="nextLead(true)">Skip this one</button>
              <a class="btn btn-outline btn-sm" routerLink="/app/my-work" (click)="queue.stop()">End session</a>
            </div>
          </div>
          <div class="track">
            @for (item of queue.items(); track item.opportunityId; let i = $index) {
              <span class="seg-bar" [attr.data-state]="i === queue.index() ? 'current' : (queue.isDone(item.opportunityId) ? 'done' : (i < queue.index() ? 'skipped' : ''))"></span>
            }
          </div>
          <div class="sh-counts"><span>Lead <strong>{{ queue.index() + 1 }}</strong> of {{ queue.items().length }}</span><span class="c c-done">{{ queue.doneCount() }} done</span></div>
        </header>
      } @else {
        <a routerLink="/app/my-work" class="back">← My Work</a>
      }

      @let w = ws();
      @if (!w && loading()) {
        <div class="loading-state"><div class="spinner"></div></div>
      } @else if (!w) {
        <div class="alert alert-error">{{ error() || 'This lead could not be loaded.' }}</div>
      } @else {
        <div class="layout">
          <div class="main">
            <ol class="stepper" aria-label="Deal path">
              @for (s of path; track s.key; let i = $index) {
                <li [class.current]="s.key === pathStep()" [class.done]="i < pathIndex()"><span class="dot">@if (i < pathIndex()) { <lz-icon name="check" [size]="12" /> } @else { {{ i + 1 }} }</span><span class="lbl">{{ s.label }}</span></li>
              }
            </ol>

            <section class="card step">
              @if (saved(); as message) {
                <div class="done">
                  <span class="done-icon"><lz-icon name="check-circle" [size]="30" /></span>
                  <h2>{{ message }}</h2>
                  <div class="actions center">
                    @if (inQueue()) { <button class="btn btn-primary btn-lg" (click)="nextLead()">Next lead →</button> }
                    @else { <a routerLink="/app/my-work" class="btn btn-primary btn-lg">Back to My Work</a> }
                    <button class="btn btn-ghost" (click)="saved.set(null)">Stay on this lead</button>
                  </div>
                </div>
              } @else {
                @switch (task()) {
                  @case ('researching') {
                    <h2>Still being researched</h2>
                    <p class="hint">This lead isn’t ready for sales yet.</p>
                    <div class="actions"><button class="btn btn-primary" (click)="nextLead(true)">Next lead →</button></div>
                  }
                  @case ('blocked') {
                    <h2>{{ w.opportunity.doNotContact ? 'Do not contact' : 'Closed' }}</h2>
                    <p class="hint">{{ w.opportunity.doNotContactReason || w.opportunity.lostReason || 'Nothing more to do here.' }}</p>
                    <div class="actions"><button class="btn btn-primary" (click)="nextLead(true)">Next lead →</button></div>
                  }
                  @case ('done') {
                    <h2>This business is a client</h2>
                    <p class="hint">@if (w.opportunity.clientManager) { {{ w.opportunity.clientManager.name }} is onboarding them. } @else { It’s with the client team. }</p>
                    <div class="actions"><button class="btn btn-primary" (click)="nextLead(true)">Next lead →</button></div>
                  }
                  @case ('waiting') {
                    <p class="eyebrow">Closing</p>
                    <h2>Waiting for approval</h2>
                    <p class="hint">You submitted this sale. An admin approves it, then it goes to onboarding.</p>
                    <div class="actions"><button class="btn btn-primary" (click)="nextLead(true)">Next lead →</button></div>
                  }
                  @case ('submit') {
                    <p class="eyebrow">Closing</p>
                    <h2>{{ w.opportunity.paymentConfirmedAt ? 'Payment received — submit the sale' : 'Submit the sale' }}</h2>
                    @if (w.opportunity.closingStatus === 'returned') { <div class="alert alert-warning">Sent back: {{ w.opportunity.closingReviewNote }}</div> }
                    <textarea class="form-control" rows="3" [(ngModel)]="closingNote" [placeholder]="w.opportunity.paymentConfirmedAt ? 'Anything the admin should know (optional)' : 'No payment yet — explain the arrangement, e.g. paying by check Friday'"></textarea>
                    <div class="actions"><button class="btn btn-primary btn-lg" (click)="submitSale()" [disabled]="busy()">Submit for approval</button></div>
                  }
                  @case ('payment') {
                    @let r = openRequest();
                    <p class="eyebrow">Payment</p>
                    @if (r) {
                      <h2>{{ r.sentAt ? 'Waiting for their payment' : 'Send them the payment link' }}</h2>
                      <div class="facts-box">
                        <div><span>Offer</span><strong>{{ r.offerTitle }}</strong></div>
                        <div><span>Amount</span><strong>{{ r.initialAmountCents | money: r.currency }}@if (r.recurringAmountCents) { then {{ r.recurringAmountCents | money: r.currency }}/{{ r.recurringInterval }} }</strong></div>
                        <div><span>Link</span><strong>{{ r.sentAt ? 'Sent ' + (r.sentAt | date: 'MMM d') : 'Not sent yet' }}</strong></div>
                      </div>
                      <p class="hint">A sent link doesn’t mean it’s paid — only a payment Stripe confirms counts.</p>
                      <div class="actions">
                        <a class="btn btn-outline" [routerLink]="['/app/leads', w.opportunity.id]" [queryParams]="{ tab: 'offers' }">Open payment link</a>
                        <button class="btn btn-primary" (click)="startContact()">Follow up with them</button>
                      </div>
                    } @else {
                      <h2>They agreed? Create the payment link</h2>
                      @if (w.opportunity.proposal; as p) {
                        <div class="facts-box">
                          <div><span>Service</span><strong>{{ p.service }}</strong></div>
                          <div><span>Price</span><strong>@if (p.setupCents) { {{ p.setupCents | money }} setup }@if (p.setupCents && p.recurringCents) { + }@if (p.recurringCents) { {{ p.recurringCents | money }}/{{ p.interval }} }</strong></div>
                          <div><span>Sent</span><strong>{{ p.sentAt | date: 'MMM d' }}</strong></div>
                        </div>
                      }
                      <div class="actions">
                        <button class="btn btn-ghost" (click)="startContact()">Still deciding — follow up</button>
                        <a class="btn btn-primary" [routerLink]="['/app/leads', w.opportunity.id]" [queryParams]="{ tab: 'offers' }">Create payment link</a>
                      </div>
                    }
                  }
                  @case ('meeting') {
                    @let m = w.opportunity.meeting!;
                    <p class="eyebrow">Meeting</p>
                    <h2>{{ m.methodLabel }} · {{ m.at | date: 'EEE MMM d, h:mm a' }}</h2>
                    @if (meetingStep() === 'ask') {
                      <p class="hint">How did it go?</p>
                      <div class="choices">
                        <button class="choice good" (click)="meetingStep.set('held')"><lz-icon name="check" [size]="16" /> It happened</button>
                        <button class="choice" (click)="meetingStep.set('move')"><lz-icon name="calendar" [size]="16" /> Move it</button>
                        <button class="choice" (click)="meetingDone('no_show')"><lz-icon name="x" [size]="16" /> They didn’t show</button>
                        <button class="choice" (click)="startContact()"><lz-icon name="more" [size]="16" /> Something else</button>
                      </div>
                    } @else if (meetingStep() === 'held') {
                      <label class="form-label" for="w-agreed">What did you agree?</label>
                      <textarea id="w-agreed" class="form-control" rows="3" [(ngModel)]="meetingOutcome" placeholder="e.g. 5-page site with booking; send pricing by Friday"></textarea>
                      <div class="actions"><button class="btn btn-ghost" (click)="meetingStep.set('ask')">← Back</button>
                        <button class="btn btn-primary" (click)="meetingDone('held')" [disabled]="busy() || !meetingOutcome.trim()">Save & prepare pricing</button></div>
                    } @else {
                      <div class="row2"><input class="form-control" type="datetime-local" [(ngModel)]="meetingAt" aria-label="New time" />
                        <select class="form-select" [(ngModel)]="meetingMethod" aria-label="How"><option value="phone">Phone</option><option value="video">Video</option><option value="in_person">In person</option></select></div>
                      <div class="actions"><button class="btn btn-ghost" (click)="meetingStep.set('ask')">← Back</button>
                        <button class="btn btn-primary" (click)="meetingDone('rescheduled')" [disabled]="busy()">Save new time</button></div>
                    }
                  }
                  @case ('pricing') {
                    <p class="eyebrow">Pricing</p>
                    <h2>Send them a price</h2>
                    <div class="row2">
                      <div><label class="form-label" for="w-svc">What are you offering?</label>
                        <input id="w-svc" class="form-control" [(ngModel)]="price.service" list="w-kit" placeholder="e.g. New website" />
                        <datalist id="w-kit">@for (sv of w.salesKit.services; track sv.name) { <option [value]="sv.name"></option> }</datalist></div>
                      <div class="row2">
                        <div><label class="form-label" for="w-setup">Setup $</label><input id="w-setup" class="form-control" type="number" min="0" [(ngModel)]="price.setup" /></div>
                        <div><label class="form-label" for="w-mo">Monthly $</label><input id="w-mo" class="form-control" type="number" min="0" [(ngModel)]="price.monthly" /></div>
                      </div>
                    </div>
                    <label class="form-label" for="w-msg">Message</label>
                    <textarea id="w-msg" class="form-control" rows="5" [(ngModel)]="price.message" [placeholder]="pricingMessage()"></textarea>
                    <p class="hint">Follow up</p>
                    <div class="chips">@for (d of followUps; track d.label) { <button type="button" class="chip" [class.on]="price.followUpAt === d.value" (click)="price.followUpAt = d.value">{{ d.label }}</button> }</div>
                    <div class="actions">
                      <button class="btn btn-ghost" (click)="savePricing('draft')" [disabled]="busy()">Save for later</button>
                      <button class="btn btn-outline" (click)="savePricing('other')" [disabled]="busy() || !priceReady()">I sent it another way</button>
                      @if (email()) { <button class="btn btn-primary" (click)="emailPricing()" [disabled]="busy() || !priceReady()">Review & email it</button> }
                    </div>
                  }
                  @default {
                    <div class="substeps">
                      @for (sub of contactSteps; track sub.key; let i = $index) {
                        <span [class.on]="sub.key === contactStep()" [class.past]="contactIndex() > i">{{ i + 1 }}. {{ sub.label }}</span>
                      }
                    </div>
                    @switch (contactStep()) {
                      @case ('reach') {
                        <p class="eyebrow">{{ reachEyebrow() }}</p>
                        <h2>{{ w.recommendation.label }}</h2>
                        @if (w.recommendation.detail) { <p class="hint">{{ w.recommendation.detail }}</p> }
                        @if (w.recommendation.why.length) { <ul class="why">@for (line of w.recommendation.why; track line) { <li>{{ line }}</li> }</ul> }
                        @if (!email() && !phone()) {
                          <div class="alert alert-warning">No email or phone on file.</div>
                          <div class="actions">
                            @if (w.permissions.returnToQualifier) { <button class="btn btn-outline" (click)="pick('wrong_contact'); returnToQualifier = true">Send back to the qualifier</button> }
                            <a class="btn btn-primary" [routerLink]="['/app/leads', w.opportunity.id]">Find contact details</a>
                          </div>
                        } @else {
                          <div class="reach">
                            @if (email()) {
                              <button class="reach-btn primary" (click)="writeEmail()"><lz-icon name="mail" [size]="20" /><span><strong>Write email</strong><small>{{ email() }}</small></span></button>
                            }
                            @if (phone()) {
                              <a class="reach-btn" [class.primary]="!email()" [href]="'tel:' + phone()" (click)="called()"><lz-icon name="phone" [size]="20" /><span><strong>Call</strong><small>{{ phone() }}</small></span></a>
                            }
                          </div>
                          <button class="link center" (click)="channel = 'other'; contactStep.set('outcome')">I already reached them another way →</button>
                        }
                      }
                      @case ('outcome') {
                        <p class="eyebrow">{{ channel === 'call' ? 'After your call' : 'What happened' }}</p>
                        <h2>What happened?</h2>
                        <div class="choices">
                          @for (o of outcomes; track o.key) {
                            <button class="choice" [class.good]="o.tone === 'good'" [class.bad]="o.tone === 'bad'" (click)="pick(o.key)">{{ o.label }}</button>
                          }
                        </div>
                        <div class="actions"><button class="btn btn-ghost" (click)="contactStep.set('reach')">← Back</button></div>
                      }
                      @case ('next') {
                        <p class="eyebrow">{{ outcomeLabel() }}</p>
                        @switch (outcome()) {
                          @case ('interested') {
                            <h2>Great — what’s next?</h2>
                            <div class="choices three">
                              <button class="choice" [class.on]="interestedNext === 'meeting'" (click)="interestedNext = 'meeting'"><lz-icon name="calendar" [size]="16" /> Book a meeting</button>
                              <button class="choice" [class.on]="interestedNext === 'pricing'" (click)="interestedNext = 'pricing'"><lz-icon name="card" [size]="16" /> Send pricing</button>
                              <button class="choice" [class.on]="interestedNext === 'follow_up'" (click)="interestedNext = 'follow_up'"><lz-icon name="clock" [size]="16" /> Follow up later</button>
                            </div>
                            @if (interestedNext === 'meeting') {
                              <div class="row2"><input class="form-control" type="datetime-local" [(ngModel)]="meetingAt" aria-label="Meeting time" />
                                <select class="form-select" [(ngModel)]="meetingMethod" aria-label="How"><option value="phone">Phone</option><option value="video">Video</option><option value="in_person">In person</option></select></div>
                              <p class="hint">Saved in Leadzaro only — send a calendar invite yourself if they want one.</p>
                            }
                            @if (interestedNext === 'follow_up') { <div class="chips">@for (d of followUps; track d.label) { <button type="button" class="chip" [class.on]="nextAt === d.value" (click)="nextAt = d.value">{{ d.label }}</button> }</div> }
                            <input class="form-control" [(ngModel)]="need" placeholder="What do they need? (optional)" aria-label="What they need" />
                          }
                          @case ('not_now') {
                            <h2>When should we check back?</h2>
                            <div class="chips">@for (d of revisits; track d.label) { <button type="button" class="chip" [class.on]="nextAt === d.value" (click)="nextAt = d.value">{{ d.label }}</button> }</div>
                          }
                          @case ('not_interested') {
                            <h2>Why not?</h2>
                            <div class="chips">@for (r of w.pipeline.closeReasons.slice(0, 7); track r.key) { <button type="button" class="chip" [class.on]="reason === r.key" (click)="reason = r.key">{{ r.label }}</button> }</div>
                          }
                          @case ('do_not_contact') {
                            <h2>Stop contacting this business?</h2>
                            <p class="hint">All outreach stops and it leaves every queue.</p>
                          }
                          @case ('wrong_contact') {
                            <h2>Wrong contact details</h2>
                            @if (w.permissions.returnToQualifier) {
                              <label class="check"><input type="checkbox" [(ngModel)]="returnToQualifier" /> Send it back to {{ w.qualificationBrief?.qualifiedBy?.name || 'the qualifier' }} to fix</label>
                            }
                            @if (!returnToQualifier) { <p class="hint">Try again</p><div class="chips">@for (d of followUps; track d.label) { <button type="button" class="chip" [class.on]="nextAt === d.value" (click)="nextAt = d.value">{{ d.label }}</button> }</div> }
                          }
                          @default {
                            <h2>When will you try again?</h2>
                            <div class="chips">@for (d of followUps; track d.label) { <button type="button" class="chip" [class.on]="nextAt === d.value" (click)="nextAt = d.value">{{ d.label }}</button> }</div>
                          }
                        }
                        <input class="form-control" [(ngModel)]="note" [placeholder]="outcome() === 'wrong_contact' && returnToQualifier ? 'What’s wrong? (needed)' : 'Note (optional)'" aria-label="Note" />
                        @if (owner()) { <div class="alert alert-warning">{{ owner() }} owns this lead. <button class="link" (click)="confirmOwner = true; save()">Save anyway</button></div> }
                        <div class="actions">
                          <button class="btn btn-ghost" (click)="contactStep.set('outcome')">← Back</button>
                          <span class="spacer"></span>
                          <button class="btn btn-primary btn-lg" (click)="save()" [disabled]="busy() || !canSave()">{{ busy() ? 'Saving…' : saveLabel() }}</button>
                        </div>
                      }
                    }
                  }
                }
              }
              @if (error()) { <div class="alert alert-error" role="alert">{{ error() }}</div> }
            </section>
            <p class="note"><lz-icon name="check" [size]="12" /> Opening your email or phone doesn’t count as contact — Leadzaro only records what you log or send.</p>
          </div>

          <aside class="aside">
            <section class="card snap">
              <div class="snap-head">
                <span class="avatar">{{ w.business.name.charAt(0).toUpperCase() }}</span>
                <div class="snap-name"><strong>{{ w.business.name }}</strong><span>{{ w.business.category || 'Business' }}@if (w.business.city) { · {{ w.business.city }} }</span></div>
              </div>
              <ul class="snap-facts">
                @if (contactName()) { <li><lz-icon name="user" [size]="14" /> {{ contactName() }}</li> }
                <li><lz-icon name="mail" [size]="14" />@if (email()) { {{ email() }} } @else { <span class="muted">No email</span> }</li>
                <li><lz-icon name="phone" [size]="14" />@if (phone()) { {{ phone() }} } @else { <span class="muted">No phone</span> }</li>
                <li><lz-icon name="globe" [size]="14" />@if (w.business.website) { <a [href]="w.business.website" target="_blank" rel="noopener">{{ host(w.business.website) }}</a> } @else { <span class="tag-warn">No website</span> }</li>
              </ul>
              <div class="snap-links">
                @if (w.business.googleMapsUrl) { <a [href]="w.business.googleMapsUrl" target="_blank" rel="noopener">Google ↗</a> }
                @if (w.business.facebookUrl) { <a [href]="w.business.facebookUrl" target="_blank" rel="noopener">Facebook ↗</a> }
                <a [routerLink]="['/app/leads', w.opportunity.id]">Full record</a>
              </div>
            </section>

            @if (w.opportunity.outreachReason) {
              <section class="card snap">
                <h4>Why them</h4>
                <p class="why-text">{{ w.opportunity.outreachReason }}</p>
                @if (w.qualificationBrief?.qualifiedBy) { <p class="by">Qualified by {{ w.qualificationBrief?.qualifiedBy?.name }}</p> }
              </section>
            }

            <section class="card snap">
              <h4>Deal</h4>
              <dl class="deal">
                <dt>Stage</dt><dd><span [class]="'stage-chip stage-' + w.opportunity.stage">{{ w.opportunity.stageLabel }}</span></dd>
                <dt>Interest</dt><dd class="interest" [attr.data-level]="w.opportunity.interestLevel">{{ interestLabel() }}</dd>
                <dt>Reached out</dt><dd>{{ attempts() }} time{{ attempts() === 1 ? '' : 's' }}@if (replies()) { · {{ replies() }} repl{{ replies() === 1 ? 'y' : 'ies' }} }</dd>
                <dt>Last contact</dt><dd>@if (w.opportunity.lastInteractionAt) { {{ w.opportunity.lastInteractionAt | relativeDay }} } @else { Never }</dd>
                <dt>Next step</dt><dd>@if (w.opportunity.nextActionAt) { {{ nextLabel(w.opportunity.nextActionType) }} · {{ w.opportunity.nextActionAt | relativeDay }} } @else { <span class="muted">None set</span> }</dd>
              </dl>
            </section>

            <section class="card snap">
              <h4>Recent</h4>
              <ol class="recent">
                @for (a of w.activities.slice(0, 4); track a.id) {
                  <li [class.in]="a.direction === 'inbound'"><span class="when">{{ (a.occurredAt || a.createdAt) | date: 'MMM d' }}</span>
                    <span>{{ a.direction === 'inbound' ? 'They' : (a.user?.name || 'You') }} · {{ a.outcomeLabel || a.subject || a.channel }}</span></li>
                } @empty { <li class="muted">No contact yet.</li> }
              </ol>
              @if (w.activities.length > 4) { <a class="more" [routerLink]="['/app/leads', w.opportunity.id]">See all {{ w.activities.length }} →</a> }
            </section>

            @if (upNext().length) {
              <section class="card snap">
                <h4>Up next</h4>
                <ul class="up-next">@for (u of upNext(); track u.opportunityId) { <li><strong>{{ u.businessName }}</strong><span>{{ u.label }}</span></li> }</ul>
              </section>
            }
          </aside>
        </div>

        <app-dialog [open]="!!composer()" title="Email" [wide]="true" (closed)="composer.set(null)">
          @if (composer(); as c) {
            <app-composer [ws]="w" channel="email" [category]="c.category" [intro]="c.intro" [preset]="c.preset" (sent)="emailSent($event)" (closed)="composer.set(null)" />
          }
        </app-dialog>
      }
    </div>
  `,
  styles: [`
    .work { max-width: 1080px; margin: 0 auto; padding: 8px 4px 40px; }
    .back { display: inline-block; margin-bottom: 12px; font-size: .82rem; color: var(--text-muted); text-decoration: none; }
    .eyebrow { margin: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--primary); font-weight: 700; }
    .session-head { padding: 16px 20px; margin-bottom: 16px; }
    .sh-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; h1 { margin: 2px 0 0; font-family: var(--font-display); font-size: 1.25rem; } }
    .sh-actions { display: flex; gap: 8px; }
    .track { display: flex; gap: 3px; height: 8px; margin-top: 12px; }
    .seg-bar { flex: 1; border-radius: 4px; background: var(--bg-2); &[data-state='current'] { background: var(--primary); } &[data-state='done'] { background: var(--success); } &[data-state='skipped'] { background: #cbd5e1; } }
    .sh-counts { display: flex; gap: 14px; margin-top: 8px; font-size: .8rem; color: var(--text-muted);
      .c::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; } .c-done::before { background: var(--success); } }

    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; @media (max-width: 960px) { grid-template-columns: 1fr; } }
    .main { min-width: 0; }
    .stepper { list-style: none; display: flex; padding: 0; margin: 0 0 14px;
      li { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: .74rem; color: var(--text-muted); }
      li + li::before { content: ''; position: absolute; top: 14px; left: calc(-50% + 16px); right: calc(50% + 16px); height: 2px; background: var(--border); }
      li.done + li::before { background: var(--success); }
      .dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--card); border: 2px solid var(--border); font-weight: 700; font-size: .78rem; position: relative; z-index: 1; }
      li.done .dot { background: var(--success); border-color: var(--success); color: #fff; }
      li.current .dot { background: var(--primary); border-color: var(--primary); color: #fff; box-shadow: 0 0 0 4px var(--primary-50); }
      li.current .lbl { color: var(--primary-dark); font-weight: 700; } }

    .step { padding: 24px 26px; display: flex; flex-direction: column; gap: 12px; h2 { margin: 0; font-size: 1.4rem; font-family: var(--font-display); letter-spacing: -.01em; } }
    .substeps { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 2px;
      span { font-size: .72rem; padding: 3px 10px; border-radius: var(--radius-full); background: var(--bg-2); color: var(--text-muted); }
      .past { background: var(--success-bg, #dcfce7); color: var(--success); } .on { background: var(--primary); color: #fff; font-weight: 600; } }
    .hint { margin: 0; color: var(--text-muted); font-size: .88rem; }
    .why { margin: 0; padding-left: 18px; font-size: .85rem; color: var(--text-secondary); }
    .reach { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 4px; }
    .reach-btn { display: flex; gap: 12px; align-items: center; padding: 16px; border-radius: 12px; border: 1.5px solid var(--border); background: var(--card); cursor: pointer; text-decoration: none; color: var(--text-primary); text-align: left;
      span { display: flex; flex-direction: column; min-width: 0; } small { color: var(--text-muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; }
      &:hover { border-color: var(--primary-200); }
      &.primary { background: var(--primary); border-color: var(--primary); color: #fff; small { color: rgba(255,255,255,.8); } } }
    .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; align-items: center; margin-top: 4px; .spacer { flex: 1; } &.center { justify-content: center; } }
    .choices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; &.three { grid-template-columns: repeat(3, 1fr); } @media (max-width: 560px) { grid-template-columns: 1fr; &.three { grid-template-columns: 1fr; } } }
    .choice { display: flex; gap: 8px; align-items: center; justify-content: center; padding: 14px 12px; border: 1.5px solid var(--border); border-radius: 12px; background: var(--card); font-size: .92rem; font-weight: 600; cursor: pointer; color: var(--text-primary);
      &:hover { border-color: var(--primary-200); background: var(--primary-50); } &.on { border-color: var(--primary); background: var(--primary-50); }
      &.good { border-color: var(--success); } &.bad { color: var(--danger-text); } }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { border: 1.5px solid var(--border); background: var(--card); border-radius: var(--radius-full); padding: 8px 14px; font-size: .85rem; cursor: pointer; &.on { border-color: var(--primary); background: var(--primary-50); color: var(--primary-dark); font-weight: 600; } }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; @media (max-width: 520px) { grid-template-columns: 1fr; } }
    .facts-box { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px 14px; background: var(--bg); border-radius: 12px;
      div { display: flex; flex-direction: column; gap: 2px; } span { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); } strong { font-size: .88rem; } }
    .check { display: flex; gap: 8px; align-items: center; font-size: .9rem; input { accent-color: var(--primary); } }
    .link { background: none; border: 0; color: var(--primary); cursor: pointer; padding: 0; font-size: .85rem; &.center { align-self: center; } }
    .done { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 20px 0; .done-icon { color: var(--success); } }
    .note { display: flex; gap: 6px; align-items: center; margin: 10px 2px 0; font-size: .74rem; color: var(--text-muted); }

    .aside { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 16px; }
    .snap { padding: 16px 18px; h4 { margin: 0 0 10px; font-size: .75rem; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); } }
    .snap-head { display: flex; gap: 12px; align-items: center; }
    .avatar { width: 40px; height: 40px; border-radius: 12px; background: var(--brand-gradient); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 1.1rem; flex-shrink: 0; }
    .snap-name { display: flex; flex-direction: column; min-width: 0; strong { font-size: .98rem; line-height: 1.25; } span { font-size: .78rem; color: var(--text-muted); } }
    .snap-facts { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; font-size: .84rem;
      li { display: flex; gap: 8px; align-items: flex-start; word-break: break-word; lz-icon { color: var(--text-muted); margin-top: 2px; flex-shrink: 0; } } }
    .snap-links { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); font-size: .8rem; }
    .muted { color: var(--text-muted); }
    .tag-warn { background: var(--warning-bg); color: var(--warning-text, #92400e); border-radius: var(--radius-full); padding: 1px 8px; font-size: .75rem; font-weight: 600; }
    .why-text { margin: 0; font-size: .88rem; line-height: 1.45; } .by { margin: 6px 0 0; font-size: .75rem; color: var(--text-muted); }
    .deal { display: grid; grid-template-columns: 90px 1fr; gap: 7px 10px; margin: 0; font-size: .84rem; dt { color: var(--text-muted); } dd { margin: 0; } }
    .interest { font-weight: 600; &[data-level='hot'] { color: var(--danger-text); } &[data-level='warm'] { color: #b45309; } &[data-level='cold'] { color: #0369a1; } }
    .recent { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 7px; font-size: .8rem;
      li { display: flex; gap: 8px; } .when { color: var(--text-muted); min-width: 44px; } li.in span:last-child { color: var(--success); font-weight: 600; } }
    .more { display: inline-block; margin-top: 8px; font-size: .78rem; }
    .up-next { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 9px;
      li { display: flex; flex-direction: column; } strong { font-size: .85rem; } span { font-size: .74rem; color: var(--text-muted); } }
  `],
})
export class WorkComponent implements OnInit, OnDestroy {
  private readonly sales = inject(SalesService);
  private readonly workflow = inject(WorkflowService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly queue = inject(WorkQueueService);

  readonly outcomes = OUTCOMES;
  /** The deal's path, shown as the stepper; the current task is highlighted. */
  readonly path: { key: Task; label: string }[] = [
    { key: 'contact', label: 'Contact' }, { key: 'meeting', label: 'Meeting' }, { key: 'pricing', label: 'Pricing' }, { key: 'payment', label: 'Payment' }, { key: 'submit', label: 'Close' },
  ];
  readonly contactSteps: { key: ContactStep; label: string }[] = [{ key: 'reach', label: 'Reach out' }, { key: 'outcome', label: 'What happened' }, { key: 'next', label: 'What’s next' }];
  readonly nextLabel = nextActionLabel;
  readonly followUps = dates([1, 2, 7, 14]);
  readonly revisits = dates([30, 90, 182]);
  readonly ws = signal<Workspace | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly saved = signal<string | null>(null);
  readonly inQueue = signal(false);
  readonly contactStep = signal<ContactStep>('reach');
  readonly outcome = signal<Outcome | null>(null);
  readonly meetingStep = signal<'ask' | 'held' | 'move'>('ask');
  readonly historyOpen = signal(false);
  readonly owner = signal<string | null>(null);
  readonly forceContact = signal(false);
  readonly composer = signal<{ category: string | null; intro: boolean; preset: { subject: string; body: string } | null; pricing?: Record<string, unknown> } | null>(null);
  private id = '';
  private key = actionKey();

  channel = 'call';
  nextAt = '';
  note = '';
  need = '';
  reason = '';
  interestedNext: 'meeting' | 'pricing' | 'follow_up' = 'meeting';
  meetingAt = toLocalInput(suggestDate(2));
  meetingMethod = 'phone';
  meetingOutcome = '';
  returnToQualifier = false;
  confirmOwner = false;
  closingNote = '';
  price = { service: '', setup: null as number | null, monthly: null as number | null, message: '', followUpAt: toLocalInput(suggestDate(3)) };

  readonly email = computed(() => {
    const w = this.ws();
    if (!w) return null;
    return w.contacts.find((c) => c.isPrimary && c.email && !c.doNotContact)?.email ?? w.contacts.find((c) => c.email && !c.doNotContact)?.email ?? w.business.email;
  });
  readonly phone = computed(() => {
    const w = this.ws();
    if (!w) return null;
    return w.contacts.find((c) => c.isPrimary && c.phone && !c.doNotContact)?.phone ?? w.contacts.find((c) => c.phone && !c.doNotContact)?.phone ?? w.business.phone;
  });
  readonly contactName = computed(() => {
    const c = this.ws()?.primaryContact;
    return c ? `${c.name}${c.title ? ` (${c.title})` : ''}` : null;
  });
  readonly openRequest = computed(() => this.ws()?.paymentRequests.find((r) => r.isOpen) ?? null);

  readonly pathStep = computed<Task>(() => {
    const t = this.task();
    if (t === 'waiting' || t === 'done') return 'submit';
    return this.path.some((p) => p.key === t) ? t : 'contact';
  });
  readonly pathIndex = computed(() => (this.task() === 'done' ? this.path.length : this.path.findIndex((p) => p.key === this.pathStep())));
  readonly contactIndex = computed(() => this.contactSteps.findIndex((c) => c.key === this.contactStep()));
  readonly attempts = computed(() => (this.ws()?.activities ?? []).filter((a) => a.direction === 'outbound' && !['failed', 'undelivered'].includes(a.status ?? '')).length);
  readonly replies = computed(() => (this.ws()?.activities ?? []).filter((a) => a.direction === 'inbound').length);
  readonly interestLabel = computed(() => INTEREST_LABELS[(this.ws()?.opportunity.interestLevel ?? 'unknown') as InterestLevel]);
  readonly upNext = computed(() => (this.inQueue() ? this.queue.items().slice(this.queue.index() + 1, this.queue.index() + 4) : []));
  readonly queueLabel = computed(() => {
    const reasons = this.queue.filters().reasons;
    const names: Record<string, string> = {
      reply: 'Replies', overdue: 'Overdue follow-ups', due_today: 'Due today', new_lead: 'New leads', payment: 'Payments', stalled: 'Stalled deals', no_next_step: 'Leads with no next step',
    };
    return reasons.length === 1 ? names[reasons[0]] ?? 'Your leads' : reasons.length && reasons.length < 4 ? reasons.map((r) => names[r] ?? r).join(' & ') : 'All your leads';
  });

  host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  /** The one thing this lead needs now, from what's recorded. */
  readonly task = computed<Task>(() => {
    const w = this.ws();
    if (!w) return 'contact';
    const o = w.opportunity;
    if (this.forceContact()) return 'contact';
    if (['draft', 'needs_research', 'needs_correction', 'ready'].includes(w.qualificationBrief?.status ?? '')) return 'researching';
    if (o.stage === 'won') return 'done';
    if (o.doNotContact || o.stage === 'lost') return 'blocked';
    if (o.closingStatus === 'submitted') return 'waiting';
    if (o.closingStatus === 'returned' || o.paymentConfirmedAt) return 'submit';
    if (o.replyNeededSince) return 'contact';
    if (this.openRequest() || o.proposal?.sentAt || o.stage === 'awaiting_payment') return 'payment';
    if (o.meeting && ['scheduled', 'rescheduled'].includes(o.meeting.status)) return 'meeting';
    if (o.nextActionType === 'send_offer' || (o.meeting?.status === 'held' && !o.proposal?.sentAt)) return 'pricing';
    return 'contact';
  });

  readonly reachEyebrow = computed(() => {
    const key = this.ws()?.recommendation.key;
    return ({ reply: 'They replied', overdue: 'Overdue', first_contact: 'First contact', scheduled: 'Follow up' } as Record<string, string>)[key ?? ''] ?? 'Reach out';
  });
  readonly outcomeLabel = computed(() => OUTCOMES.find((o) => o.key === this.outcome())?.label ?? '');
  readonly pricingMessage = computed(() => {
    const w = this.ws();
    const parts = [this.price.setup ? `$${this.price.setup} to set up` : '', this.price.monthly ? `$${this.price.monthly}/month after that` : ''].filter(Boolean).join(', ');
    return `Hi${this.ws()?.primaryContact ? ` ${this.ws()!.primaryContact!.name.split(' ')[0]}` : ''},\n\nThanks for your time. For ${this.price.service || 'the work we discussed'} for ${w?.business.name ?? 'your business'}, the price is ${parts || '…'}.\n\nHappy to answer any questions.`;
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.id = params.get('id')!;
      this.inQueue.set(this.route.snapshot.queryParamMap.get('queue') === '1' && this.queue.positionOf(this.id) >= 0);
      if (this.inQueue()) this.queue.focus(this.id);
      this.reset();
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.workflow.focusLead.set(null);
  }

  private reset(): void {
    this.saved.set(null);
    this.error.set('');
    this.contactStep.set('reach');
    this.outcome.set(null);
    this.meetingStep.set('ask');
    this.forceContact.set(false);
    this.owner.set(null);
    this.historyOpen.set(false);
    this.note = '';
    this.need = '';
    this.reason = '';
    this.returnToQualifier = false;
    this.confirmOwner = false;
    this.closingNote = '';
    this.key = actionKey();
  }

  load(): void {
    this.loading.set(true);
    this.sales.workspace(this.id).subscribe({
      next: (w) => { this.apply(w); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'This lead could not be loaded.'); },
    });
  }

  private apply(w: Workspace): void {
    this.ws.set(w);
    this.workflow.focusLead.set({ id: w.opportunity.id, name: w.business.name });
    const p = w.opportunity.proposal;
    this.price = {
      service: p?.service ?? w.opportunity.qualification.qualService ?? '',
      setup: p?.setupCents != null ? p.setupCents / 100 : null,
      monthly: p?.recurringCents != null ? p.recurringCents / 100 : null,
      message: p?.message ?? '',
      followUpAt: toLocalInput(suggestDate(3)),
    };
  }

  // ---- contact flow

  startContact(): void {
    this.forceContact.set(true);
    this.contactStep.set('reach');
  }

  writeEmail(): void {
    const w = this.ws()!;
    const first = !w.activities.some((a) => a.direction === 'outbound');
    this.channel = 'email';
    this.composer.set({ category: first ? 'intro' : 'follow_up', intro: first, preset: null });
  }

  /** The phone app opens; we only ask what happened — opening it isn't proof of a call. */
  called(): void {
    this.channel = 'call';
    setTimeout(() => this.contactStep.set('outcome'), 300);
  }

  pick(outcome: Outcome): void {
    this.outcome.set(outcome);
    this.error.set('');
    const defaults: Partial<Record<Outcome, number>> = { no_answer: 1, voicemail: 2, email_sent: 3, wrong_contact: 1 };
    this.nextAt = outcome === 'not_now' ? this.revisits[1].value : toLocalInput(suggestDate(defaults[outcome] ?? 2));
    this.interestedNext = 'meeting';
    if (outcome === 'email_sent' && this.channel === 'call') this.channel = 'email';
    this.contactStep.set('next');
  }

  canSave(): boolean {
    const o = this.outcome();
    if (o === 'not_interested') return Boolean(this.reason);
    if (o === 'wrong_contact' && this.returnToQualifier) return Boolean(this.note.trim());
    if (o === 'interested' && this.interestedNext === 'meeting') return Boolean(this.meetingAt);
    return true;
  }

  saveLabel(): string {
    if (this.outcome() === 'interested' && this.interestedNext === 'pricing') return 'Save & write pricing';
    return this.inQueue() ? 'Save & next lead' : 'Save';
  }

  save(): void {
    const w = this.ws()!;
    const outcome = this.outcome()!;
    const nextType = outcome === 'email_sent' ? 'email' : (['no_answer', 'voicemail', 'wrong_contact'].includes(outcome) ? 'call' : 'follow_up');
    let nextAction: Record<string, unknown> | null = this.nextAt ? { at: new Date(this.nextAt).toISOString(), type: nextType } : null;
    if (outcome === 'interested') {
      nextAction = this.interestedNext === 'pricing' ? { at: suggestDate(1).toISOString(), type: 'send_offer', note: 'Send pricing' }
        : this.interestedNext === 'follow_up' ? { at: new Date(this.nextAt).toISOString(), type: 'follow_up' } : null;
    }
    if (['not_interested', 'do_not_contact'].includes(outcome) || (outcome === 'wrong_contact' && this.returnToQualifier)) nextAction = null;
    const body = {
      channel: this.channel === 'other' ? 'other' : this.channel,
      outcome: outcome === 'interested' ? 'interested' : outcome,
      note: this.note || null,
      closeReasonCode: outcome === 'not_interested' ? this.reason : null,
      nextAction,
      interestLevel: outcome === 'interested' ? 'warm' : null,
      returnToQualification: outcome === 'wrong_contact' && this.returnToQualifier,
      returnReason: this.note || null,
      idempotencyKey: this.key,
      origin: this.channel === 'call' ? 'manual' : 'external',
      confirmOwner: this.confirmOwner,
    };
    this.busy.set(true);
    this.error.set('');
    this.owner.set(null);
    const after = (updated: Workspace) => {
      if (outcome === 'interested' && this.need.trim()) {
        this.sales.updateQualification(w.opportunity.id, { qualNeed: this.need.trim() }).subscribe({ error: () => undefined });
      }
      if (outcome === 'interested' && this.interestedNext === 'meeting') {
        this.workflow.saveMeeting(w.opportunity.id, {
          status: 'scheduled', method: this.meetingMethod, at: new Date(this.meetingAt).toISOString(), idempotencyKey: actionKey(),
        }).subscribe({
          next: (m) => this.finish(m, 'Meeting booked.'),
          error: (err) => { this.busy.set(false); this.ws.set(updated); this.error.set(err.error?.message || 'Saved, but the meeting wasn’t — try again.'); },
        });
        return;
      }
      if (outcome === 'interested' && this.interestedNext === 'pricing') {
        this.busy.set(false);
        this.apply(updated);
        this.forceContact.set(false);
        return;
      }
      const messages: Partial<Record<Outcome, string>> = {
        not_interested: 'Closed as not interested.', do_not_contact: 'Marked do not contact.', not_now: 'Parked — you’ll be reminded.',
        wrong_contact: this.returnToQualifier ? 'Sent back to the qualifier.' : 'Saved.',
      };
      this.finish(updated, messages[outcome] ?? 'Saved — follow-up scheduled.');
    };
    this.sales.logOutcome(w.opportunity.id, body).subscribe({
      next: after,
      error: (err) => {
        this.busy.set(false);
        if (err.status === 409 && err.error?.code === 'owned_by_other') { this.owner.set(err.error.owner?.name || 'Someone else'); return; }
        this.error.set(err.error?.message || 'Not saved — your choices are still here. Try again.');
      },
    });
  }

  private finish(w: Workspace, message: string): void {
    this.busy.set(false);
    this.apply(w);
    this.forceContact.set(false);
    this.contactStep.set('reach');
    this.key = actionKey();
    if (this.inQueue()) { this.nextLead(); return; }
    this.saved.set(message);
  }

  emailSent(w: Workspace | null): void {
    const pricing = this.composer()?.pricing;
    this.composer.set(null);
    if (!w) { this.contactStep.set('outcome'); return; }
    if (pricing) {
      this.workflow.saveProposal(w.opportunity.id, pricing).subscribe({
        next: (u) => this.finish(u, 'Pricing emailed — follow-up set.'),
        error: () => this.finish(w, 'Email sent. Record the pricing from the full record.'),
      });
      return;
    }
    this.finish(w, 'Email sent — follow-up set.');
  }

  // ---- later steps

  meetingDone(status: 'held' | 'rescheduled' | 'no_show'): void {
    const body: Record<string, unknown> = { status, method: status === 'rescheduled' ? this.meetingMethod : this.ws()!.opportunity.meeting?.method, idempotencyKey: actionKey() };
    if (status === 'rescheduled') body['at'] = new Date(this.meetingAt).toISOString();
    if (status === 'held') {
      body['outcome'] = this.meetingOutcome;
      body['nextAction'] = { at: suggestDate(1).toISOString(), type: 'send_offer', note: 'Send pricing' };
    }
    if (status === 'no_show') body['nextAction'] = { at: suggestDate(1).toISOString(), type: 'call', note: 'Missed meeting — reschedule' };
    this.run(this.workflow.saveMeeting(this.ws()!.opportunity.id, body), (w) => {
      this.meetingStep.set('ask');
      this.meetingOutcome = '';
      if (status === 'held') { this.apply(w); return; }
      this.finish(w, status === 'rescheduled' ? 'Meeting moved.' : 'Saved — call them to rebook.');
    });
  }

  priceReady(): boolean {
    return Boolean(this.price.service.trim() && (this.price.setup || this.price.monthly));
  }

  private pricingBody(markSent: boolean, sentVia = 'other'): Record<string, unknown> {
    const cents = (v: number | null) => (v ? Math.round(Number(v) * 100) : null);
    return {
      service: this.price.service, setupCents: cents(this.price.setup), recurringCents: cents(this.price.monthly), interval: 'month',
      message: this.price.message || this.pricingMessage(), markSent, sentVia, followUpAt: new Date(this.price.followUpAt).toISOString(),
    };
  }

  savePricing(mode: 'draft' | 'other'): void {
    this.run(this.workflow.saveProposal(this.ws()!.opportunity.id, this.pricingBody(mode === 'other')), (w) => {
      if (mode === 'draft') { this.apply(w); return; }
      this.finish(w, 'Pricing recorded — follow-up set.');
    });
  }

  emailPricing(): void {
    this.run(this.workflow.saveProposal(this.ws()!.opportunity.id, this.pricingBody(false)), (w) => {
      this.apply(w);
      this.composer.set({
        category: null,
        intro: false,
        preset: { subject: `Pricing for ${w.business.name}`, body: this.price.message || this.pricingMessage() },
        pricing: { ...this.pricingBody(true, 'email'), sentThroughLeadzaro: true },
      });
    });
  }

  submitSale(): void {
    this.run(this.workflow.submitClosing(this.ws()!.opportunity.id, this.closingNote), (w) => this.finish(w, 'Submitted for approval.'));
  }

  private run(request: Observable<Workspace>, next: (w: Workspace) => void): void {
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: (w) => { this.busy.set(false); next(w); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not saved — try again.'); },
    });
  }

  nextLead(skip = false): void {
    if (!this.inQueue()) { this.router.navigate(['/app/my-work']); return; }
    const next = this.queue.next(!skip);
    if (next) this.router.navigate(['/app/work', next.opportunityId], { queryParams: { queue: 1 } });
    else {
      this.queue.stop();
      this.router.navigate(['/app/my-work'], { queryParams: { finished: 1 } });
    }
  }
}
