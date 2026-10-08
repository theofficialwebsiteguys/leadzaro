import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Lead, LeadSearchResult, PlaceDetails } from '../../core/models/lead.model';
import { LeadService } from '../../core/services/lead.service';
import { SalesService } from '../../core/services/sales.service';
import { SettingsService } from '../../core/services/settings.service';
import { PossibleDuplicate } from '../../core/models/sales.model';
import { IconComponent } from '../../shared/icon/icon.component';
import { DialogComponent } from '../../shared/dialog/dialog.component';
import { Router, RouterLink } from '@angular/router';
import { LeadMapComponent, MapPoint } from './lead-map.component';

const DEMO_STORAGE_KEY = 'lz_demo_mode';

@Component({
  selector: 'app-lead-search',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent, DialogComponent, RouterLink, LeadMapComponent],
  templateUrl: './lead-search.component.html',
  styleUrl: './lead-search.component.scss',
})
export class LeadSearchComponent implements OnInit {
  private readonly fb          = inject(FormBuilder);
  private readonly leadService = inject(LeadService);
  private readonly sales = inject(SalesService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);

  /** Search result id → the lead it became (or already was). */
  readonly opportunityFor = signal<Record<string, string>>({});
  readonly review = signal<{ lead: Lead; duplicates: PossibleDuplicate[] } | null>(null);

  results    = signal<LeadSearchResult | null>(null);
  /** Which result row is open, and what's been loaded for it (ADR 0013). */
  readonly expandedId = signal<string | null>(null);
  readonly details = signal<Record<string, PlaceDetails | 'loading' | 'error'>>({});
  readonly showMap = signal(true);
  lastQuery = '';
  loading    = signal(false);
  saving     = signal<string | null>(null);
  savedIds   = signal<Set<string>>(new Set());
  saveErrors = signal<Record<string, string>>({});
  searched   = signal(false);

  demoMode    = signal(localStorage.getItem(DEMO_STORAGE_KEY) === 'true');
  copiedPhone = signal<string | null>(null);

  // Phone reveal state (Google source only — demo data includes phone inline)
  revealingPhone = signal<Set<string>>(new Set());
  revealedPhone  = signal<Map<string, string | null>>(new Map());

  totalLabel = computed(() => {
    const r = this.results();
    if (!r) return '';
    const n = r.pagination.total;
    return `${n} result${n === 1 ? '' : 's'}`;
  });

  noWebsiteCount = computed(() => this.results()?.items.filter(i => !i.website).length ?? 0);

  /** Numbered map markers, coloured by what the result is to us. */
  readonly mapPoints = computed<MapPoint[]>(() => (this.results()?.items ?? [])
    .map((lead, i) => ({ lead, n: i + 1 }))
    .filter(({ lead }) => typeof lead.latitude === 'number' && typeof lead.longitude === 'number')
    .map(({ lead, n }) => ({
      id: lead.id,
      n,
      name: lead.name,
      lat: lead.latitude as number,
      lng: lead.longitude as number,
      tone: this.opportunityFor()[lead.id] ? 'added' : lead.possibleMatch ? 'match' : !lead.website ? 'noweb' : 'default',
    })));

  isGoogleSource = computed(() => this.results()?.source === 'google');
  isDemoSource   = computed(() => this.results()?.source === 'demo');

  form = this.fb.group({
    keyword:   [''],
    location:  [''],
    radius:    [10],
    minRating: [''],
    minReviews:[''],
  });

  /** Pre-fills the search from Settings → Sales preferences (ADR 0012); every field stays editable. */
  ngOnInit(): void {
    this.settings.me().subscribe({
      next: (me) => {
        const v = this.form.value;
        const e = me.effective;
        this.form.patchValue({
          keyword: v.keyword || e.searchKeywords || '',
          location: v.location || e.searchLocation || '',
          radius: e.searchRadius || v.radius || 10,
        });
      },
      error: () => undefined,
    });
  }

  toggleDemo() {
    const next = !this.demoMode();
    this.demoMode.set(next);
    localStorage.setItem(DEMO_STORAGE_KEY, String(next));
    // re-run search if results are showing so the source badge refreshes
    if (this.searched()) this.search(1);
  }

  search(page = 1) {
    const v = this.form.value;
    if (!v.keyword?.trim() && !v.location?.trim()) return;

    this.loading.set(true);
    this.searched.set(true);
    this.expandedId.set(null);
    this.lastQuery = [v.keyword?.trim(), v.location?.trim()].filter(Boolean).join(' near ');

    this.leadService.search({
      keyword:    v.keyword    || undefined,
      location:   v.location   || undefined,
      radius:     v.radius     || 10,
      minRating:  v.minRating  ? Number(v.minRating)  : undefined,
      minReviews: v.minReviews ? Number(v.minReviews) : undefined,
      demo:       this.demoMode(),
      page,
      limit:      20,
    }).subscribe({
      next: (res) => {
        this.results.set(res.data);
        const saved = new Set<string>();
        const opportunities: Record<string, string> = {};
        for (const item of res.data.items) {
          if (item.isSaved) saved.add(item.id);
          if (item.pipeline && !item.pipeline.archived) opportunities[item.id] = item.pipeline.opportunityId;
        }
        this.savedIds.set(saved);
        this.opportunityFor.set(opportunities);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  revealPhone(lead: Lead) {
    const id = lead.googlePlaceId || lead.id;
    if (this.revealingPhone().has(id) || this.revealedPhone().has(id)) return;

    this.revealingPhone.update(s => new Set([...s, id]));

    this.leadService.getContactDetails(id).subscribe({
      next: (res) => {
        this.revealedPhone.update(m => new Map([...m, [id, res.data.details.phone]]));
        this.revealingPhone.update(s => { const n = new Set(s); n.delete(id); return n; });
      },
      error: () => {
        this.revealedPhone.update(m => new Map([...m, [id, null]]));
        this.revealingPhone.update(s => { const n = new Set(s); n.delete(id); return n; });
      },
    });
  }

  resolvedPhone(lead: Lead): string | null {
    if (lead.source !== 'google') return lead.phone ?? null;
    const id = lead.googlePlaceId || lead.id;
    return this.revealedPhone().get(id) ?? null;
  }

  /** Adds the result to Leads (ADR 0011). Possible duplicates are reviewed, never merged silently. */
  saveLead(lead: Lead, options: { confirmNew?: boolean; existingOrganizationId?: string } = {}) {
    if (this.saving() || this.savedIds().has(lead.id)) return;
    this.saving.set(lead.id);

    // Merge any revealed phone so it persists in the database
    const id = lead.googlePlaceId || lead.id;
    const leadToSave: Lead = this.revealedPhone().has(id)
      ? { ...lead, phone: this.revealedPhone().get(id) ?? undefined }
      : lead;

    const { isSaved, pipeline, possibleMatch, ...leadData } = leadToSave;
    this.sales.createLead({ leadData: { ...leadData, source: lead.source === 'demo' ? 'demo' : 'google' }, ...options }).subscribe({
      next: (res) => {
        this.markSaved(lead, res.opportunityId);
        this.review.set(null);
        this.saving.set(null);
      },
      error: (err) => {
        if (err.status === 409 && err.error?.existingOpportunityId) {
          this.markSaved(lead, err.error.existingOpportunityId);
        } else if (err.status === 409 && err.error?.possibleDuplicates) {
          this.review.set({ lead, duplicates: err.error.possibleDuplicates });
        } else {
          const errs = { ...this.saveErrors(), [lead.id]: 'Failed to save' };
          this.saveErrors.set(errs);
          setTimeout(() => {
            const e = { ...this.saveErrors() };
            delete e[lead.id];
            this.saveErrors.set(e);
          }, 3000);
        }
        this.saving.set(null);
      },
    });
  }

  private markSaved(lead: Lead, opportunityId: string) {
    const set = new Set(this.savedIds());
    set.add(lead.id);
    this.savedIds.set(set);
    this.opportunityFor.set({ ...this.opportunityFor(), [lead.id]: opportunityId });
  }

  openLead(lead: Lead) {
    const id = this.opportunityFor()[lead.id];
    if (id) this.router.navigate(['/app/leads', id]);
  }

  goPage(p: number) { this.search(p); }

  /** Opens a result's details row, loading phone, website, hours and status once. */
  toggleDetails(lead: Lead): void {
    if (this.expandedId() === lead.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(lead.id);
    const id = lead.googlePlaceId || lead.id;
    if (lead.source !== 'google' || this.details()[id]) return;
    this.details.set({ ...this.details(), [id]: 'loading' });
    this.leadService.getFullDetails(id).subscribe({
      next: (res) => {
        this.details.set({ ...this.details(), [id]: res.data.details });
        // The phone is known now, so the row and "Add to leads" use it.
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

  /** A marker was clicked: open that row and bring it into view. */
  pickFromMap(id: string): void {
    const lead = this.results()?.items.find((l) => l.id === id);
    if (!lead) return;
    if (this.expandedId() !== id) this.toggleDetails(lead);
    setTimeout(() => document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  addressLine(lead: Lead): string {
    return [lead.address, lead.city, lead.state, lead.zip].filter((part) => !!part).join(', ') || 'No address listed';
  }

  /** Miles from the searched location, when known. */
  distance(lead: Lead): string {
    const c = this.results()?.center;
    if (!c || typeof lead.latitude !== 'number' || typeof lead.longitude !== 'number') return '';
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(lead.latitude - c.lat);
    const dLng = rad(lead.longitude - c.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(c.lat)) * Math.cos(rad(lead.latitude)) * Math.sin(dLng / 2) ** 2;
    const miles = 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  }

  /** Plain reasons this business might need us — from facts, not a score. */
  signals(lead: Lead): string[] {
    const out: string[] = [];
    const d = this.loadedDetails(lead);
    const website = d?.website ?? lead.website;
    if (!website) out.push('No website on their Google listing');
    else if (/^http:\/\//i.test(website)) out.push('Website isn’t secure (http)');
    else if (/facebook\.com|instagram\.com|business\.site|linktr\.ee/i.test(website)) out.push('Only a social page or Google site — no real website');
    if (lead.rating && lead.rating < 4) out.push(`Rated ${lead.rating.toFixed(1)} — reputation could be a talking point`);
    if ((lead.reviewCount ?? 0) < 15) out.push(`Only ${lead.reviewCount ?? 0} Google reviews`);
    if (d?.businessStatus === 'CLOSED_TEMPORARILY') out.push('Marked temporarily closed on Google');
    return out;
  }

  copyPhone(phone: string, leadId: string) {
    navigator.clipboard.writeText(phone).then(() => {
      this.copiedPhone.set(leadId);
      setTimeout(() => this.copiedPhone.set(null), 1500);
    });
  }

  ratingStars(rating: number | undefined | null): number[] {
    if (!rating) return [];
    return Array.from({ length: Math.round(rating) });
  }

  formatRating(rating: number | null | undefined): string {
    if (!rating) return '—';
    return rating.toFixed(1);
  }
}
