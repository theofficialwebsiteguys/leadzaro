import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Lead, PaginatedResponse } from '../../core/models/lead.model';
import { LeadService } from '../../core/services/lead.service';
import { SavedLeadService } from '../../core/services/saved-lead.service';
import { IconComponent } from '../../shared/icon/icon.component';

const DEMO_STORAGE_KEY = 'lz_demo_mode';

@Component({
  selector: 'app-lead-search',
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  templateUrl: './lead-search.component.html',
  styleUrl: './lead-search.component.scss',
})
export class LeadSearchComponent {
  private readonly fb          = inject(FormBuilder);
  private readonly leadService = inject(LeadService);
  private readonly savedService = inject(SavedLeadService);

  results    = signal<(PaginatedResponse<Lead> & { source: string }) | null>(null);
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

  isGoogleSource = computed(() => this.results()?.source === 'google');
  isDemoSource   = computed(() => this.results()?.source === 'demo');

  form = this.fb.group({
    keyword:   [''],
    location:  [''],
    radius:    [10],
    minRating: [''],
    minReviews:[''],
  });

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
        res.data.items.filter((i) => i.isSaved).forEach((i) => saved.add(i.id));
        this.savedIds.set(saved);
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

  saveLead(lead: Lead) {
    if (this.saving() || this.savedIds().has(lead.id)) return;
    this.saving.set(lead.id);

    // Merge any revealed phone so it persists in the database
    const id = lead.googlePlaceId || lead.id;
    const leadToSave: Lead = this.revealedPhone().has(id)
      ? { ...lead, phone: this.revealedPhone().get(id) ?? undefined }
      : lead;

    this.savedService.save(leadToSave).subscribe({
      next: () => {
        const set = new Set(this.savedIds());
        set.add(lead.id);
        this.savedIds.set(set);
        this.saving.set(null);
      },
      error: (err) => {
        if (err.status === 409) {
          const set = new Set(this.savedIds());
          set.add(lead.id);
          this.savedIds.set(set);
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

  goPage(p: number) { this.search(p); }

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
