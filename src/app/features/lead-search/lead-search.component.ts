import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Lead, LeadSearchResult, PlaceDetails, SearchCategory, SearchOptions, SearchPreset, SearchTerritory } from '../../core/models/lead.model';
import { LeadService } from '../../core/services/lead.service';
import { SalesService } from '../../core/services/sales.service';
import { SettingsService } from '../../core/services/settings.service';
import { ContactResearch, DISCOVERY_LABELS, DISCOVERY_TONES, DiscoveryStatus, PossibleDuplicate, facebookSearchUrl } from '../../core/models/sales.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { GoogleSearchComponent } from '../../shared/google-search/google-search.component';
import { DialogComponent } from '../../shared/dialog/dialog.component';
import { LeadMapComponent, MapPoint } from './lead-map.component';
import { LeadSearchStateService, RowDiscovery, SearchSelection } from './lead-search-state.service';

const DEMO_STORAGE_KEY = 'lz_demo_mode';
const LAST_SEARCH_KEY = 'lz.leadSearch.last';

function emptySelection(): SearchSelection {
  return {
    categories: [], subcategories: [], keywords: '', locationType: 'territory', territory: '', location: '', wholeArea: false, radius: 10, minRating: '', minReviews: '',
  };
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/**
 * Find businesses (ADR 0014): choose business types and an area, press
 * “Find businesses”, review the results, save the promising ones and find
 * their email. Nothing is searched, saved or sent automatically.
 */
@Component({
  selector: 'app-lead-search',
  standalone: true,
  imports: [GoogleSearchComponent, FormsModule, IconComponent, DialogComponent, RouterLink, LeadMapComponent],
  templateUrl: './lead-search.component.html',
  styleUrl: './lead-search.component.scss',
})
export class LeadSearchComponent implements OnInit, OnDestroy {
  private readonly leadService = inject(LeadService);
  private readonly sales = inject(SalesService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly state = inject(LeadSearchStateService);

  readonly options = signal<SearchOptions | null>(null);
  readonly optionsError = signal('');
  readonly sel = signal<SearchSelection>(emptySelection());
  readonly showMoreOptions = signal(false);
  readonly lastSearch = signal<SearchSelection | null>(null);

  readonly results = signal<LeadSearchResult | null>(null);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly searchError = signal('');
  readonly showExisting = signal(false);
  readonly noWebsiteOnly = signal(false);
  readonly selected = signal<Set<string>>(new Set());

  /** Search result id → the lead it became (or already was). */
  readonly opportunityFor = signal<Record<string, string>>({});
  readonly discoveries = signal<Record<string, RowDiscovery>>({});
  readonly savedContact = signal<Record<string, ContactResearch | null>>({});
  readonly needsReview = signal<Record<string, PossibleDuplicate[]>>({});
  readonly review = signal<{ lead: Lead; duplicates: PossibleDuplicate[] } | null>(null);
  readonly saving = signal<Set<string>>(new Set());
  readonly saveErrors = signal<Record<string, string>>({});
  readonly bulkBusy = signal<'save' | 'email' | null>(null);
  readonly bulkNotice = signal('');

  readonly expandedId = signal<string | null>(null);
  readonly details = signal<Record<string, PlaceDetails | 'loading' | 'error'>>({});
  readonly showMap = signal(false);
  readonly demoMode = signal(readStorage(DEMO_STORAGE_KEY) === 'true');
  readonly revealingPhone = signal<Set<string>>(new Set());
  readonly revealedPhone = signal<Map<string, string | null>>(new Map());
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollRounds = 0;
  private restoreScroll = 0;

  readonly discoveryLabels = DISCOVERY_LABELS;
  readonly discoveryTones = DISCOVERY_TONES;
  readonly facebookSearchUrl = facebookSearchUrl;

  readonly territory = computed<SearchTerritory | null>(() => this.options()?.territories.find((t) => t.key === this.sel().territory) ?? null);
  readonly chosenCategories = computed<SearchCategory[]>(() => (this.options()?.categories ?? []).filter((c) => this.sel().categories.includes(c.key)));

  /** The Google searches this selection will run — same rules as the server. */
  readonly plannedQueries = computed(() => {
    const s = this.sel();
    const out: string[] = [];
    const add = (q: string) => { if (q && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q); };
    for (const c of this.options()?.categories ?? []) {
      const subs = c.subcategories.filter((x) => s.subcategories.includes(x.key));
      if (s.categories.includes(c.key)) (subs.length ? subs.map((x) => x.query) : c.queries).forEach(add);
      else subs.forEach((x) => add(x.query));
    }
    s.keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 5).forEach(add);
    return out;
  });
  readonly plannedAreas = computed(() => {
    const s = this.sel();
    if (s.locationType === 'territory') return this.territory()?.areas ?? [];
    return s.location.trim() ? [s.location.trim()] : [];
  });
  readonly plannedCount = computed(() => this.plannedQueries().length * this.plannedAreas().length);
  readonly canSearch = computed(() => this.plannedQueries().length > 0 && this.plannedAreas().length > 0 && !this.loading());

  readonly items = computed(() => this.results()?.items ?? []);
  readonly existingCount = computed(() => this.items().filter((l) => this.isExisting(l)).length);
  readonly visible = computed(() => this.items().filter((l) => (this.showExisting() || !this.isExisting(l)) && (!this.noWebsiteOnly() || !l.website)));
  readonly selectable = computed(() => this.visible().filter((l) => !this.opportunityFor()[l.id]));
  readonly allSelected = computed(() => this.selectable().length > 0 && this.selectable().every((l) => this.selected().has(l.id)));
  readonly selectedCount = computed(() => this.selectable().filter((l) => this.selected().has(l.id)).length);

  readonly mapPoints = computed<MapPoint[]>(() => this.visible()
    .map((lead, i) => ({ lead, n: i + 1 }))
    .filter(({ lead }) => typeof lead.latitude === 'number' && typeof lead.longitude === 'number')
    .map(({ lead, n }) => ({
      id: lead.id, n, name: lead.name, lat: lead.latitude as number, lng: lead.longitude as number,
      tone: this.opportunityFor()[lead.id] ? 'added' : lead.possibleMatch ? 'match' : !lead.website ? 'noweb' : 'default',
    })));

  ngOnInit(): void {
    this.leadService.searchOptions().subscribe({
      next: (res) => {
        this.options.set(res.data);
        if (!this.state.snapshot) this.applyStartingSelection(res.data);
      },
      error: () => this.optionsError.set('Couldn’t load the search options. Reload the page to try again.'),
    });
    try {
      const raw = readStorage(LAST_SEARCH_KEY);
      if (raw) this.lastSearch.set({ ...emptySelection(), ...JSON.parse(raw) });
    } catch { /* ignore a corrupt saved search */ }

    const snap = this.state.snapshot;
    if (snap) {
      this.sel.set(snap.selection);
      this.results.set(snap.results);
      this.searched.set(snap.searched);
      this.opportunityFor.set(snap.opportunityFor);
      this.discoveries.set(snap.discoveries);
      this.savedContact.set(snap.savedContact);
      this.needsReview.set(snap.needsReview);
      this.showExisting.set(snap.showExisting);
      this.noWebsiteOnly.set(snap.noWebsiteOnly);
      this.selected.set(new Set(snap.selected));
      this.restoreScroll = snap.scrollTop;
      setTimeout(() => { const el = this.scroller(); if (el) el.scrollTop = this.restoreScroll; }, 0);
      this.pollSaved();
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.state.snapshot = {
      selection: this.sel(),
      results: this.results(),
      searched: this.searched(),
      opportunityFor: this.opportunityFor(),
      discoveries: Object.fromEntries(Object.entries(this.discoveries()).filter(([, v]) => v !== 'checking')),
      savedContact: this.savedContact(),
      needsReview: this.needsReview(),
      showExisting: this.showExisting(),
      noWebsiteOnly: this.noWebsiteOnly(),
      selected: [...this.selected()],
      scrollTop: this.scroller()?.scrollTop ?? 0,
    };
  }

  private scroller(): HTMLElement | null {
    return document.querySelector('.content') as HTMLElement | null;
  }

  /** Last search if there is one, else the first territory plus personal defaults from Settings. */
  private applyStartingSelection(options: SearchOptions): void {
    const last = this.lastSearch();
    if (last) {
      this.sel.set(last);
      return;
    }
    const start = { ...emptySelection(), territory: options.territories[0]?.key ?? '' };
    this.sel.set(start);
    this.settings.me().subscribe({
      next: (me) => {
        const e = me.effective;
        if (this.searched()) return;
        this.patch({
          keywords: this.sel().keywords || e.searchKeywords || '',
          location: this.sel().location || e.searchLocation || '',
          radius: e.searchRadius || 10,
        });
        if (e.searchKeywords) this.showMoreOptions.set(true);
      },
      error: () => undefined,
    });
  }

  patch(changes: Partial<SearchSelection>): void {
    this.sel.set({ ...this.sel(), ...changes });
  }

  toggleCategory(key: string): void {
    const s = this.sel();
    const on = s.categories.includes(key);
    const category = this.options()?.categories.find((c) => c.key === key);
    this.patch({
      categories: on ? s.categories.filter((k) => k !== key) : [...s.categories, key],
      // Dropping a category drops its subcategories too.
      subcategories: on && category ? s.subcategories.filter((k) => !category.subcategories.some((x) => x.key === k)) : s.subcategories,
    });
  }

  hasSubPicked(c: SearchCategory): boolean {
    return c.subcategories.some((x) => this.sel().subcategories.includes(x.key));
  }

  toggleSub(key: string): void {
    const s = this.sel();
    this.patch({ subcategories: s.subcategories.includes(key) ? s.subcategories.filter((k) => k !== key) : [...s.subcategories, key] });
  }

  presetSummary(p: SearchPreset): string {
    const o = this.options();
    if (!o) return '';
    const subs = o.categories.flatMap((c) => c.subcategories).filter((x) => p.subcategories.includes(x.key)).map((x) => x.label);
    const cats = o.categories.filter((c) => p.categories.includes(c.key) && !c.subcategories.some((x) => p.subcategories.includes(x.key))).map((c) => c.label);
    const territory = o.territories.find((t) => t.key === p.territory);
    return `${[...cats, ...subs].join(', ')} · ${territory ? territory.areas.join(', ') : 'territory not found'}`;
  }

  /** A preset only fills the form — the employee reviews it and presses “Find businesses”. */
  applyPreset(p: SearchPreset): void {
    this.sel.set({
      ...emptySelection(), categories: [...p.categories], subcategories: [...p.subcategories], locationType: 'territory', territory: p.territory, radius: this.sel().radius,
    });
  }

  applyLast(): void {
    const last = this.lastSearch();
    if (last) this.sel.set({ ...last });
  }

  lastSummary(): string {
    const last = this.lastSearch();
    const o = this.options();
    if (!last || !o) return '';
    const labels = [
      ...o.categories.filter((c) => last.categories.includes(c.key)).map((c) => c.label),
      ...o.categories.flatMap((c) => c.subcategories).filter((x) => last.subcategories.includes(x.key)).map((x) => x.label),
      ...last.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    ];
    const where = last.locationType === 'territory' ? (o.territories.find((t) => t.key === last.territory)?.name ?? 'a territory') : `${last.location}${last.wholeArea ? '' : ` (${last.radius} mi)`}`;
    return `${labels.join(', ') || 'No types'} · ${where}`;
  }

  toggleDemo(): void {
    const next = !this.demoMode();
    this.demoMode.set(next);
    writeStorage(DEMO_STORAGE_KEY, String(next));
  }

  find(): void {
    if (!this.canSearch()) return;
    const s = this.sel();
    writeStorage(LAST_SEARCH_KEY, JSON.stringify(s));
    this.lastSearch.set({ ...s });
    this.loading.set(true);
    this.searched.set(true);
    this.searchError.set('');
    this.expandedId.set(null);
    this.selected.set(new Set());
    this.bulkNotice.set('');
    const area = s.locationType === 'territory' || s.wholeArea;
    this.leadService.guidedSearch({
      categories: s.categories,
      subcategories: s.subcategories,
      keywords: s.keywords,
      mode: area ? 'area' : 'radius',
      location: s.location.trim(),
      areas: s.locationType === 'territory' ? (this.territory()?.areas ?? []) : [],
      radius: Number(s.radius) || 10,
      minRating: s.minRating ? Number(s.minRating) : null,
      minReviews: s.minReviews ? Number(s.minReviews) : null,
      demo: this.demoMode(),
    }).subscribe({
      next: (res) => {
        this.results.set(res.data);
        const opportunities: Record<string, string> = {};
        const discoveries: Record<string, RowDiscovery> = {};
        for (const item of res.data.items) {
          if (item.pipeline && !item.pipeline.archived) opportunities[item.id] = item.pipeline.opportunityId;
          if (item.discovery) discoveries[item.id] = item.discovery;
        }
        this.opportunityFor.set(opportunities);
        this.discoveries.set(discoveries);
        this.savedContact.set({});
        this.needsReview.set({});
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.results.set(null);
        this.searchError.set(err.error?.message || 'The search didn’t work. Try again in a moment.');
      },
    });
  }

  isExisting(lead: Lead): boolean {
    return Boolean(lead.pipeline && (!lead.pipeline.archived || lead.pipeline.isClient));
  }

  // ---------------------------------------------------------------- selection

  toggleSelect(lead: Lead): void {
    const next = new Set(this.selected());
    if (next.has(lead.id)) next.delete(lead.id); else next.add(lead.id);
    this.selected.set(next);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.selectable().map((l) => l.id)));
  }

  // ---------------------------------------------------------------- saving

  /** Adds a result to Leads (ADR 0011). Possible duplicates are reviewed, never merged silently. */
  saveLead(lead: Lead, options: { confirmNew?: boolean; existingOrganizationId?: string } = {}, fromBulk = false): Promise<'saved' | 'review' | 'failed'> {
    return new Promise((resolve) => {
      if (this.saving().has(lead.id) || this.opportunityFor()[lead.id]) { resolve('saved'); return; }
      this.setSaving(lead.id, true);
      const id = lead.googlePlaceId || lead.id;
      const leadToSave: Lead = this.revealedPhone().has(id) ? { ...lead, phone: this.revealedPhone().get(id) ?? undefined } : lead;
      const { isSaved, pipeline, possibleMatch, matchedQueries, searchArea, discovery, ...leadData } = leadToSave;
      this.sales.createLead({ leadData: { ...leadData, source: lead.source === 'demo' ? 'demo' : 'google' }, ...options }).subscribe({
        next: (res) => {
          this.markSaved(lead, res.opportunityId);
          this.savedContact.set({ ...this.savedContact(), [lead.id]: res.discovery ?? null });
          this.review.set(null);
          this.setSaving(lead.id, false);
          this.pollSaved();
          resolve('saved');
        },
        error: (err) => {
          this.setSaving(lead.id, false);
          if (err.status === 409 && err.error?.existingOpportunityId) {
            this.markSaved(lead, err.error.existingOpportunityId);
            resolve('saved');
          } else if (err.status === 409 && err.error?.possibleDuplicates) {
            this.needsReview.set({ ...this.needsReview(), [lead.id]: err.error.possibleDuplicates });
            if (!fromBulk) this.review.set({ lead, duplicates: err.error.possibleDuplicates });
            resolve('review');
          } else {
            this.saveErrors.set({ ...this.saveErrors(), [lead.id]: err.error?.message || 'Couldn’t save — try again' });
            resolve('failed');
          }
        },
      });
    });
  }

  private setSaving(id: string, on: boolean): void {
    const next = new Set(this.saving());
    if (on) next.add(id); else next.delete(id);
    this.saving.set(next);
  }

  private markSaved(lead: Lead, opportunityId: string): void {
    this.opportunityFor.set({ ...this.opportunityFor(), [lead.id]: opportunityId });
    const next = new Set(this.selected());
    next.delete(lead.id);
    this.selected.set(next);
    const reviews = { ...this.needsReview() };
    delete reviews[lead.id];
    this.needsReview.set(reviews);
  }

  /** Saves the selected results one at a time; possible duplicates wait for review. */
  async saveSelected(): Promise<void> {
    const leads = this.selectable().filter((l) => this.selected().has(l.id));
    if (!leads.length || this.bulkBusy()) return;
    this.bulkBusy.set('save');
    this.bulkNotice.set('');
    const counts = { saved: 0, review: 0, failed: 0 };
    for (const lead of leads) counts[await this.saveLead(lead, {}, true)] += 1;
    this.bulkBusy.set(null);
    const parts = [`Saved ${counts.saved}`];
    if (counts.review) parts.push(`${counts.review} may already be in Leadzaro — review them in the list`);
    if (counts.failed) parts.push(`${counts.failed} couldn’t be saved`);
    this.bulkNotice.set(`${parts.join(' · ')}. Email checks run in the background for saved leads.`);
  }

  openReview(lead: Lead): void {
    const duplicates = this.needsReview()[lead.id];
    if (duplicates) this.review.set({ lead, duplicates });
  }

  openLead(lead: Lead): void {
    const id = this.opportunityFor()[lead.id];
    if (id) this.router.navigate(['/app/leads', id]);
  }

  // ---------------------------------------------------------------- email discovery

  /** The email state for a row: the saved lead's record, else a check run from this screen. */
  contactFor(lead: Lead): { status: DiscoveryStatus; email: string | null; sourceUrl: string | null; summary: string | null; facebookUrl: string | null } | null {
    const saved = this.savedContact()[lead.id] ?? lead.pipeline?.contact ?? null;
    if (saved && (this.opportunityFor()[lead.id] || lead.pipeline)) {
      return { status: saved.status, email: saved.email, sourceUrl: saved.emailSourceUrl, summary: saved.summary, facebookUrl: saved.facebookUrl || saved.facebookSuggestion?.url || null };
    }
    const d = this.discoveries()[lead.id];
    if (d === 'checking') return { status: 'checking', email: null, sourceUrl: null, summary: null, facebookUrl: null };
    if (d && d !== 'error') return { status: d.status, email: d.email, sourceUrl: d.emailSourceUrl, summary: d.summary, facebookUrl: d.facebook?.url ?? null };
    return null;
  }

  isSocial(lead: Lead): boolean {
    return /facebook\.com|instagram\.com/i.test(lead.website || '');
  }

  discoveryFailed(lead: Lead): boolean {
    return this.discoveries()[lead.id] === 'error';
  }

  findEmail(lead: Lead, force = false): Promise<void> {
    return new Promise((resolve) => {
      if (this.discoveries()[lead.id] === 'checking') { resolve(); return; }
      this.discoveries.set({ ...this.discoveries(), [lead.id]: 'checking' });
      this.leadService.discoverEmail(lead, force).subscribe({
        next: (res) => { this.discoveries.set({ ...this.discoveries(), [lead.id]: res.data.discovery }); resolve(); },
        error: () => { this.discoveries.set({ ...this.discoveries(), [lead.id]: 'error' }); resolve(); },
      });
    });
  }

  /** Runs email checks for the selected unsaved results that have a website, three at a time. */
  async findEmailsForSelected(): Promise<void> {
    const leads = this.selectable().filter((l) => this.selected().has(l.id) && l.website && !this.contactFor(l));
    if (!leads.length || this.bulkBusy()) return;
    this.bulkBusy.set('email');
    const queue = [...leads];
    const worker = async () => { while (queue.length) await this.findEmail(queue.shift()!); };
    await Promise.all([worker(), worker(), worker()]);
    this.bulkBusy.set(null);
  }

  /** Follows background checks on just-saved leads until they finish (bounded). */
  private pollSaved(): void {
    if (this.pollTimer) return;
    this.pollRounds = 0;
    const tick = () => {
      this.pollTimer = null;
      const waiting = Object.entries(this.savedContact()).filter(([, c]) => c?.status === 'checking').map(([rowId]) => rowId);
      if (!waiting.length || this.pollRounds > 40) return;
      this.pollRounds += 1;
      const ids = waiting.map((rowId) => this.opportunityFor()[rowId]).filter(Boolean);
      this.sales.contactStatus(ids).subscribe({
        next: (status) => {
          const next = { ...this.savedContact() };
          for (const rowId of waiting) {
            const oppId = this.opportunityFor()[rowId];
            if (status[oppId]) next[rowId] = status[oppId];
          }
          this.savedContact.set(next);
          this.pollTimer = setTimeout(tick, 4000);
        },
        error: () => { this.pollTimer = setTimeout(tick, 8000); },
      });
    };
    this.pollTimer = setTimeout(tick, 3000);
  }

  /** One factual observation for the row — never a judgement about their website's quality. */
  observation(lead: Lead): string | null {
    const c = this.contactFor(lead);
    const d = this.discoveries()[lead.id];
    const site = d && d !== 'checking' && d !== 'error' ? d.website : null;
    if (!lead.website) return 'No website listed on their Google profile';
    if (/facebook\.com|instagram\.com/i.test(lead.website)) return 'Google listing links to a social profile, not a website';
    if (site?.standalone && site.reachable === false) return `Website didn’t load when checked (${site.error})`;
    if (site?.standalone && site.reachable && site.secure === false) return 'Website loaded without https when checked';
    if (c?.status === 'none_found') return 'No public email on their website';
    return null;
  }

  // ---------------------------------------------------------------- phone & details (secondary)

  revealPhone(lead: Lead): void {
    const id = lead.googlePlaceId || lead.id;
    if (this.revealingPhone().has(id) || this.revealedPhone().has(id)) return;
    this.revealingPhone.update((s) => new Set([...s, id]));
    this.leadService.getContactDetails(id).subscribe({
      next: (res) => {
        this.revealedPhone.update((m) => new Map([...m, [id, res.data.details.phone]]));
        this.revealingPhone.update((s) => { const n = new Set(s); n.delete(id); return n; });
      },
      error: () => {
        this.revealedPhone.update((m) => new Map([...m, [id, null]]));
        this.revealingPhone.update((s) => { const n = new Set(s); n.delete(id); return n; });
      },
    });
  }

  resolvedPhone(lead: Lead): string | null {
    if (lead.source !== 'google') return lead.phone ?? null;
    return this.revealedPhone().get(lead.googlePlaceId || lead.id) ?? null;
  }

  toggleDetails(lead: Lead): void {
    if (this.expandedId() === lead.id) { this.expandedId.set(null); return; }
    this.expandedId.set(lead.id);
    const id = lead.googlePlaceId || lead.id;
    if (lead.source !== 'google' || this.details()[id]) return;
    this.details.set({ ...this.details(), [id]: 'loading' });
    this.leadService.getFullDetails(id).subscribe({
      next: (res) => {
        this.details.set({ ...this.details(), [id]: res.data.details });
        if (!this.revealedPhone().has(id)) this.revealedPhone.update((m) => new Map([...m, [id, res.data.details.phone]]));
      },
      error: () => this.details.set({ ...this.details(), [id]: 'error' }),
    });
  }

  detailsFor(lead: Lead): PlaceDetails | 'loading' | 'error' | null {
    return this.details()[lead.googlePlaceId || lead.id] ?? null;
  }

  loadedDetails(lead: Lead): PlaceDetails | null {
    const d = this.detailsFor(lead);
    return d && d !== 'loading' && d !== 'error' ? d : null;
  }

  pickFromMap(id: string): void {
    const lead = this.items().find((l) => l.id === id);
    if (!lead) return;
    if (this.expandedId() !== id) this.toggleDetails(lead);
    setTimeout(() => document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  addressLine(lead: Lead): string {
    return [lead.address, lead.city, lead.state, lead.zip].filter((part) => !!part).join(', ') || 'No address listed';
  }

  place(lead: Lead): string {
    return [lead.city, lead.state].filter(Boolean).join(', ');
  }

  host(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  formatRating(rating: number | null | undefined): string {
    return rating ? rating.toFixed(1) : '—';
  }

  searchQueryLabel(): string {
    return this.plannedQueries().join(' · ');
  }
}
