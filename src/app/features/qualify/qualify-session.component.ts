import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LeadService } from '../../core/services/lead.service';
import { WorkflowService } from '../../core/services/workflow.service';
import { Lead, SearchOptions, SearchPreset } from '../../core/models/lead.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { QualifyFlowComponent, QualifyOutcome, QualifyResult, QualifyStart } from './qualify-flow.component';

const SESSION_KEY = 'lz.qualifySession';

interface Session {
  label: string;
  items: Lead[];
  index: number;
  results: Record<string, QualifyOutcome | 'skipped'>;
  /** Obvious chains left out of the queue (ADR 0017), with why — shown on request. */
  excluded?: Lead[];
}

function read(): Session | null {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

/**
 * A qualifying session (ADR 0016): choose what kind of business and where,
 * then work through the results one business at a time — worth it or not,
 * links, contact, reason, decide — and move straight on to the next. No
 * list to manage; nothing becomes a lead until it's qualified. Obvious
 * chains are left out (ADR 0017), and can be shown and brought back.
 */
@Component({
  selector: 'app-qualify-session',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, QualifyFlowComponent],
  template: `
    <div class="qs">
      @let s = session();
      <nav class="crumbs" aria-label="Breadcrumb"><a routerLink="/app/my-work">My Work</a><span aria-hidden="true">›</span><span>Qualifying</span></nav>
      @if (!s) {
        <header class="head">
          <h1>Qualify businesses</h1>
          <p>Pick what and where. You’ll go through the businesses one at a time — worth it or not, links, contact, reason, decide.</p>
        </header>

        @if (options(); as o) {
          @if (o.presets.length) {
            <p class="label">Quick start</p>
            <div class="presets">
              @for (p of o.presets; track p.key) {
                <button type="button" class="preset" (click)="usePreset(p)" [disabled]="loading()"><lz-icon name="play" [size]="14" /><span>{{ p.name }}</span></button>
              }
            </div>
            <p class="label">Or choose</p>
          }
          <section class="card setup">
            <h2><span class="num">1</span> What kind of business?</h2>
            <div class="chips">
              @for (c of o.categories; track c.key) { <button type="button" class="chip" [class.on]="categories().includes(c.key)" (click)="toggleCategory(c.key)">{{ c.label }}</button> }
            </div>
            <h2><span class="num">2</span> Where?</h2>
            <div class="where">
              @if (o.territories.length) {
                <select class="form-select" [(ngModel)]="territory" aria-label="Territory">
                  <option value="">A town or ZIP…</option>
                  @for (t of o.territories; track t.key) { <option [value]="t.key">{{ t.name }}</option> }
                </select>
              }
              @if (!territory) { <input class="form-control" [(ngModel)]="place" placeholder="Town, ZIP or county" aria-label="Town, ZIP or county" /> }
            </div>
            @if (error()) { <div class="alert alert-error">{{ error() }}</div> }
            <button class="btn btn-primary btn-xl" (click)="startSearch()" [disabled]="loading() || !categories().length || (!territory && !place.trim())">
              @if (loading()) { Finding businesses… } @else { <lz-icon name="play" [size]="16" /> Start qualifying }
            </button>
          </section>
          <p class="alt">Found one yourself? <a routerLink="/app/qualify/new">Add it by hand</a></p>
        } @else {
          <div class="loading-state"><div class="spinner"></div></div>
        }
      } @else if (finished()) {
        <section class="card summary">
          <lz-icon name="check-circle" [size]="34" />
          <h1>Session done</h1>
          <p>{{ s.label }} · {{ counts().total }} businesses</p>
          <ul>
            <li><strong>{{ counts().qualified }}</strong> qualified and assigned</li>
            <li><strong>{{ counts().needs_info }}</strong> need more info</li>
            <li><strong>{{ counts().not_relevant }}</strong> not relevant</li>
            <li><strong>{{ counts().skipped }}</strong> skipped</li>
          </ul>
          @if (s.excluded?.length) { <p class="excluded-note">{{ s.excluded!.length }} obvious chain{{ s.excluded!.length === 1 ? ' was' : 's were' }} left out of this search.</p> }
          <div class="row"><a routerLink="/app/my-work" class="btn btn-ghost">Back to My Work</a><button class="btn btn-primary btn-lg" (click)="endSession()">Start another search</button></div>
        </section>
      } @else {
        @let lead = current()!;
        <header class="session-head card">
          <div class="sh-top">
            <div class="sh-title"><p class="eyebrow">Qualifying</p><h1>{{ s.label }}</h1></div>
            <div class="sh-actions">
              <button class="btn btn-ghost btn-sm" (click)="skip()">Skip this one</button>
              <button class="btn btn-outline btn-sm" (click)="endSession()">End session</button>
            </div>
          </div>
          <div class="sh-progress">
            <div class="track" [attr.aria-label]="'Business ' + (s.index + 1) + ' of ' + s.items.length">
              @for (item of s.items; track item.id; let i = $index) {
                <span class="seg-bar" [attr.data-state]="i === s.index ? 'current' : (s.results[item.id] || '')"></span>
              }
            </div>
            <div class="sh-counts">
              <span class="pos">Business <strong>{{ s.index + 1 }}</strong> of {{ s.items.length }}</span>
              <span class="c c-q">{{ counts().qualified }} qualified</span>
              <span class="c c-n">{{ counts().needs_info }} need info</span>
              <span class="c c-x">{{ counts().not_relevant }} not relevant</span>
              @if (s.excluded?.length) { <button type="button" class="excl-toggle" (click)="showExcluded.set(!showExcluded())" [attr.aria-expanded]="showExcluded()">{{ s.excluded!.length }} chain{{ s.excluded!.length === 1 ? '' : 's' }} hidden · {{ showExcluded() ? 'Hide' : 'Show excluded' }}</button> }
            </div>
          </div>
          @if (showExcluded() && s.excluded?.length) {
            <div class="excluded" role="region" aria-label="Excluded chains">
              <p class="hint">Left out because they look like chains. Bring one back if it’s actually a local business worth researching.</p>
              <ul>
                @for (x of s.excluded!; track x.id) {
                  <li>
                    <span class="ex-main"><strong>{{ x.name }}</strong><span class="hint">{{ x.chain?.reasons?.[0] }}@if (x.city) { · {{ x.city }} }</span></span>
                    <span class="ex-actions">
                      <button class="btn btn-ghost btn-sm" (click)="restore(x, false)">Research it</button>
                      <button class="btn btn-outline btn-sm" (click)="restore(x, true)" [disabled]="allowing()" title="Always show this location in searches">Always allow</button>
                    </span>
                  </li>
                }
              </ul>
            </div>
          }
        </header>
        @if (flash()) { <div class="alert alert-success flash" role="status">{{ flash() }}</div> }
        @for (x of [lead]; track x.id) {
          <app-qualify-flow [start]="startFor(x)" [session]="true" (completed)="decided($event)" (skip)="skip()">
            @if (upNext().length) {
              <section class="card up-next">
                <h4>Up next</h4>
                <ul>
                  @for (u of upNext(); track u.id) {
                    <li><strong>{{ u.name }}</strong><span>{{ u.category || 'Business' }} · {{ u.website ? 'has a website' : 'no website listed' }}@if (u.rating) { · {{ u.rating }}★ }</span></li>
                  }
                </ul>
              </section>
            }
          </app-qualify-flow>
        }
      }
    </div>
  `,
  styles: [`
    .qs { max-width: 1080px; margin: 0 auto; padding: 8px 4px 40px; }
    .eyebrow { margin: 0; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--primary); font-weight: 700; }
    .label { margin: 0 0 8px; font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); font-weight: 700; }
    .num { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--primary-50); color: var(--primary-dark); font-size: .75rem; margin-right: 6px; }
    .session-head { padding: 16px 20px; margin-bottom: 14px; }
    .sh-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;
      h1 { margin: 2px 0 0; font-family: var(--font-display); font-size: 1.25rem; } }
    .sh-actions { display: flex; gap: 8px; }
    .sh-progress { margin-top: 12px; }
    .track { display: flex; gap: 3px; height: 8px; }
    .seg-bar { flex: 1; border-radius: 4px; background: var(--bg-2);
      &[data-state='current'] { background: var(--primary); } &[data-state='qualified'] { background: var(--success); }
      &[data-state='needs_info'] { background: var(--warning); } &[data-state='not_relevant'] { background: #94a3b8; } &[data-state='skipped'] { background: #cbd5e1; } }
    .sh-counts { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; font-size: .8rem; color: var(--text-muted);
      .pos { margin-right: auto; color: var(--text-secondary); }
      .c::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
      .c-q::before { background: var(--success); } .c-n::before { background: var(--warning); } .c-x::before { background: #94a3b8; } }
    .up-next { padding: 16px 18px; h4 { margin: 0 0 10px; font-size: .75rem; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); }
      ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
      li { display: flex; flex-direction: column; gap: 1px; strong { font-size: .85rem; } span { font-size: .75rem; color: var(--text-muted); } } }
    .head { margin-bottom: 18px; max-width: 700px; h1 { font-family: var(--font-display); font-size: 1.7rem; margin: 0; } p { margin: 4px 0 0; color: var(--text-muted); } }
    .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 18px; max-width: 700px; }
    .preset { display: flex; align-items: center; gap: 10px; text-align: left; border: 1px solid var(--border); background: var(--card); border-radius: 12px; padding: 14px 16px; cursor: pointer; font-size: .9rem; font-weight: 600; color: var(--text-primary);
      lz-icon { color: var(--primary); } &:hover { border-color: var(--primary-200); box-shadow: 0 2px 10px rgba(99, 102, 241, .08); } }
    .setup { padding: 24px; display: flex; flex-direction: column; gap: 12px; max-width: 700px; h2 { margin: 6px 0 0; font-size: 1rem; display: flex; align-items: center; } }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { border: 1.5px solid var(--border); background: var(--card); border-radius: var(--radius-full); padding: 8px 14px; font-size: .88rem; cursor: pointer; &.on { border-color: var(--primary); background: var(--primary-50); color: var(--primary-dark); font-weight: 600; } }
    .where { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; @media (max-width: 560px) { grid-template-columns: 1fr; } }
    .btn-xl { padding: 14px 24px; font-size: 1.05rem; border-radius: 12px; align-self: flex-start; display: inline-flex; gap: 8px; align-items: center; margin-top: 6px; }
    .alt { font-size: .85rem; color: var(--text-muted); margin: 14px 4px; }
    .flash { margin-bottom: 10px; }
    .crumbs { display: flex; gap: 6px; align-items: center; font-size: .8rem; color: var(--text-muted); margin: 0 0 10px; a { color: var(--text-muted); text-decoration: none; &:hover { color: var(--primary); } } }
    .excl-toggle { background: none; border: 0; color: var(--primary); font-size: .8rem; cursor: pointer; padding: 0; }
    .excluded { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px;
      ul { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 8px; }
      li { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
      .ex-main { display: flex; flex-direction: column; min-width: 0; } .ex-actions { display: flex; gap: 6px; } }
    .hint { font-size: .78rem; color: var(--text-muted); margin: 0; }
    .excluded-note { font-size: .82rem; }
    .summary { max-width: 560px; margin: 0 auto; padding: 30px; text-align: center; color: var(--success); display: flex; flex-direction: column; align-items: center; gap: 8px;
      h1 { color: var(--text-primary); margin: 0; } p { color: var(--text-muted); margin: 0; } ul { list-style: none; padding: 0; color: var(--text-primary); text-align: left; }
      .row { display: flex; gap: 8px; } }
  `],
})
export class QualifySessionComponent implements OnInit {
  private readonly leads = inject(LeadService);
  private readonly workflow = inject(WorkflowService);
  private readonly flow = viewChild(QualifyFlowComponent);
  readonly showExcluded = signal(false);
  readonly allowing = signal(false);

  readonly options = signal<SearchOptions | null>(null);
  readonly categories = signal<string[]>([]);
  readonly session = signal<Session | null>(read());
  readonly loading = signal(false);
  readonly error = signal('');
  readonly flash = signal('');
  territory = '';
  place = '';

  readonly current = computed(() => {
    const s = this.session();
    return s ? s.items[s.index] ?? null : null;
  });
  readonly finished = computed(() => {
    const s = this.session();
    return Boolean(s && s.index >= s.items.length);
  });
  /** A peek at the next few businesses in the session. */
  readonly upNext = computed(() => {
    const s = this.session();
    return s ? s.items.slice(s.index + 1, s.index + 4) : [];
  });
  readonly counts = computed(() => {
    const r = Object.values(this.session()?.results ?? {});
    const n = (k: string) => r.filter((x) => x === k).length;
    return {
      total: this.session()?.items.length ?? 0, qualified: n('qualified'), needs_info: n('needs_info'), not_relevant: n('not_relevant'), skipped: n('skipped'),
    };
  });

  ngOnInit(): void {
    this.leads.searchOptions().subscribe({
      next: (res) => {
        this.options.set(res.data);
        this.territory = res.data.territories[0]?.key ?? '';
      },
      error: () => this.error.set('Couldn’t load the search options. Reload the page.'),
    });
  }

  toggleCategory(key: string): void {
    const list = this.categories();
    this.categories.set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  usePreset(p: SearchPreset): void {
    this.categories.set([...p.categories]);
    this.territory = p.territory;
    this.startSearch(p.subcategories, p.name);
  }

  startSearch(subcategories: string[] = [], presetName?: string): void {
    const o = this.options();
    if (!o) return;
    const territory = o.territories.find((t) => t.key === this.territory);
    const labels = this.categories().map((k) => o.categories.find((c) => c.key === k)?.label ?? k);
    const label = presetName ?? `${labels.join(', ')} · ${territory?.name ?? this.place.trim()}`;
    this.loading.set(true);
    this.error.set('');
    let demo = false;
    try { demo = localStorage.getItem('lz_demo_mode') === 'true'; } catch { /* default off */ }
    this.leads.guidedSearch({
      categories: this.categories(),
      subcategories,
      keywords: '',
      mode: territory ? 'area' : 'radius',
      location: territory ? '' : this.place.trim(),
      areas: territory?.areas ?? [],
      radius: 10,
      demo,
    }).subscribe({
      next: (res) => {
        this.loading.set(false);
        // Only businesses nobody has dealt with yet: not in Leadzaro, not being researched by a teammate.
        const open = res.data.items.filter((l) => !l.pipeline && !(l.researching && !l.researching.mine));
        // Obvious chains are set aside (with why), not deleted — they can be brought back.
        const excluded = open.filter((l) => l.chain?.status === 'excluded');
        const items = open.filter((l) => l.chain?.status !== 'excluded');
        if (!items.length) {
          this.error.set(excluded.length
            ? `Every new business in that search looks like a chain (${excluded.length} left out). Try another area or type.`
            : 'Every business in that search is already in Leadzaro or being researched. Try another area or type.');
          return;
        }
        this.save({ label, items, index: 0, results: {}, excluded });
      },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'The search didn’t work. Try again in a moment.'); },
    });
  }

  startFor(lead: Lead): QualifyStart {
    return {
      googlePlaceId: lead.googlePlaceId || lead.id,
      name: lead.name,
      address: lead.address ?? null,
      city: lead.city ?? null,
      state: lead.state ?? null,
      zip: lead.zip ?? null,
      phone: lead.phone ?? null,
      website: lead.website ?? null,
      googleMapsUrl: lead.googleMapsUrl ?? null,
      category: lead.category ?? null,
      rating: lead.rating ?? null,
      reviewCount: lead.reviewCount ?? null,
      latitude: lead.latitude ?? null,
      longitude: lead.longitude ?? null,
      source: lead.source ?? 'google',
      facebookUrl: lead.discovery?.facebook?.url ?? null,
      chain: lead.chain ?? null,
    };
  }

  /** Brings an excluded result back as the next business; "always" also saves an exception for everyone. */
  restore(lead: Lead, always: boolean): void {
    const s = this.session();
    if (!s) return;
    const add = () => {
      const items = [...s.items];
      items.splice(Math.min(s.index + 1, items.length), 0, always && lead.chain ? { ...lead, chain: { ...lead.chain, status: 'allowed' } } : lead);
      this.save({ ...s, items, excluded: (s.excluded ?? []).filter((x) => x.id !== lead.id) });
      this.flash.set(`${lead.name} is up next.`);
      setTimeout(() => this.flash.set(''), 3000);
    };
    if (!always) { add(); return; }
    this.allowing.set(true);
    this.workflow.allowPlace(lead.googlePlaceId || lead.id, lead.name).subscribe({
      next: () => { this.allowing.set(false); add(); },
      error: (err) => { this.allowing.set(false); this.error.set(err.error?.message || 'The exception wasn’t saved — try again.'); },
    });
  }

  decided(result: QualifyResult): void {
    this.advance(result.outcome);
    this.flash.set(`✓ ${result.summary}`);
    setTimeout(() => this.flash.set(''), 3500);
  }

  skip(): void {
    this.flow()?.release();
    this.advance('skipped');
  }

  private advance(outcome: QualifyOutcome | 'skipped'): void {
    const s = this.session();
    const lead = this.current();
    if (!s || !lead) return;
    this.save({ ...s, index: s.index + 1, results: { ...s.results, [lead.id]: outcome } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  endSession(): void {
    this.save(null);
  }

  private save(s: Session | null): void {
    this.session.set(s);
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* the session still works on this page */ }
  }
}
