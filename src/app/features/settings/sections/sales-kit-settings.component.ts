import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings.service';
import { WorkspaceSettings } from '../../../core/models/settings.model';
import { HasUnsavedChanges, Snapshot } from '../unsaved-changes.guard';

interface KitService { name: string; description: string; price: string; billing: 'one_time' | 'monthly' | 'yearly' | '' }
interface KitForm {
  clientGoal: number | null;
  pitch: string;
  services: KitService[];
  portfolio: { label: string; url: string }[];
  objections: { objection: string; response: string }[];
}

/**
 * Sales kit and growth goal (ADR 0013): the approved services and prices,
 * portfolio links, pitch and objection answers everyone sees beside a
 * lead and can insert into messages — plus the client-count goal the
 * Dashboard tracks. Administrators edit; everyone else sees it read-only.
 */
@Component({
  selector: 'app-sales-kit-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>Sales kit &amp; goals</h2><p>What the team says and sells — shown beside every lead and insertable into emails and texts.</p></div>

      @if (loadError()) { <div class="alert alert-error">{{ loadError() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @else if (!data()) { <div class="loading-state"><div class="spinner"></div></div> }
      @else {
        @if (!data()!.canEdit) { <div class="alert alert-info">Only an administrator can change the sales kit. It’s shown here for reference.</div> }
        <form class="set-card" (ngSubmit)="save()">
          <fieldset [disabled]="!data()!.canEdit">
            <div class="set-card-head"><div><h3>Growth goal</h3><p>The number of active clients you’re working toward. The Dashboard shows progress, new clients and clients lost.</p></div></div>
            <div class="set-card-body">
              <div class="form-group goal"><label class="form-label" for="k-goal">Active client goal</label>
                <input id="k-goal" type="number" min="1" max="100000" class="form-control" name="goal" [(ngModel)]="form.clientGoal" /></div>
            </div>

            <div class="set-card-head sub-head"><div><h3>Pitch</h3><p>A short description of what you do and why it matters — the opening you want everyone to use.</p></div></div>
            <div class="set-card-body">
              <textarea class="form-control" rows="4" name="pitch" [(ngModel)]="form.pitch" maxlength="2000" aria-label="Pitch"
                placeholder="We build fast, mobile-friendly websites for local businesses — and look after them afterwards so you never have to."></textarea>
            </div>

            <div class="set-card-head sub-head"><div><h3>Services &amp; approved prices</h3><p>What you sell and the price the team may quote. Payment links still use the prices set up in Stripe.</p></div></div>
            <div class="set-card-body">
              @for (sv of form.services; track $index; let i = $index) {
                <div class="row svc">
                  <input class="form-control" [name]="'svn' + i" [(ngModel)]="sv.name" placeholder="Service name" maxlength="120" aria-label="Service name" />
                  <input class="form-control price" [name]="'svp' + i" [(ngModel)]="sv.price" placeholder="Price ($)" inputmode="decimal" aria-label="Price in dollars" />
                  <select class="form-select" [name]="'svb' + i" [(ngModel)]="sv.billing" aria-label="Billed">
                    <option value="">—</option><option value="one_time">One-time</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                  </select>
                  <button type="button" class="icon-btn" (click)="form.services.splice(i, 1)" [attr.aria-label]="'Remove ' + (sv.name || 'service')">×</button>
                  <input class="form-control span" [name]="'svd' + i" [(ngModel)]="sv.description" placeholder="What’s included (optional)" maxlength="500" aria-label="Description" />
                </div>
              } @empty { <p class="text-sm text-muted">No services yet.</p> }
              @if (form.services.length < 20) { <button type="button" class="btn btn-ghost btn-sm add" (click)="form.services.push({ name: '', description: '', price: '', billing: 'one_time' })">+ Add service</button> }
            </div>

            <div class="set-card-head sub-head"><div><h3>Portfolio links</h3><p>Examples of your work to share while talking to a lead. The first one fills <code>{{ portfolioPlaceholder }}</code> in templates.</p></div></div>
            <div class="set-card-body">
              @for (pf of form.portfolio; track $index; let i = $index) {
                <div class="row two">
                  <input class="form-control" [name]="'pfl' + i" [(ngModel)]="pf.label" placeholder="e.g. Bella’s Bakery" maxlength="120" aria-label="Label" />
                  <input class="form-control" [name]="'pfu' + i" [(ngModel)]="pf.url" placeholder="https://" maxlength="500" aria-label="Link" />
                  <button type="button" class="icon-btn" (click)="form.portfolio.splice(i, 1)" aria-label="Remove link">×</button>
                </div>
              } @empty { <p class="text-sm text-muted">No portfolio links yet.</p> }
              @if (form.portfolio.length < 20) { <button type="button" class="btn btn-ghost btn-sm add" (click)="form.portfolio.push({ label: '', url: '' })">+ Add link</button> }
            </div>

            <div class="set-card-head sub-head"><div><h3>Common objections</h3><p>Approved answers to what leads usually say.</p></div></div>
            <div class="set-card-body">
              @for (ob of form.objections; track $index; let i = $index) {
                <div class="obj">
                  <div class="row two">
                    <input class="form-control" [name]="'obq' + i" [(ngModel)]="ob.objection" placeholder="e.g. We already have a website" maxlength="200" aria-label="Objection" />
                    <span></span>
                    <button type="button" class="icon-btn" (click)="form.objections.splice(i, 1)" aria-label="Remove objection">×</button>
                  </div>
                  <textarea class="form-control" rows="2" [name]="'oba' + i" [(ngModel)]="ob.response" maxlength="1500" placeholder="How to answer it" aria-label="Answer"></textarea>
                </div>
              } @empty { <p class="text-sm text-muted">No objections yet.</p> }
              @if (form.objections.length < 20) { <button type="button" class="btn btn-ghost btn-sm add" (click)="form.objections.push({ objection: '', response: '' })">+ Add objection</button> }
            </div>
          </fieldset>

          @if (data()!.canEdit) {
            <div class="set-actions">
              @if (dirty()) { <span class="dirty">Unsaved changes</span> } @else if (message()) { <span class="saved" role="status">{{ message() }}</span> }
              @if (error()) { <span class="form-error" role="alert">{{ error() }}</span> }
              <button type="button" class="btn btn-ghost btn-sm" (click)="reset()" [disabled]="!dirty()">Discard</button>
              <button type="submit" class="btn btn-primary btn-sm" [disabled]="!dirty() || saving()">{{ saving() ? 'Saving…' : 'Save sales kit' }}</button>
            </div>
          }
        </form>
      }
    </section>
  `,
  styles: [`
    fieldset { border: none; margin: 0; padding: 0; min-width: 0; }
    .sub-head { border-top: 1px solid var(--border-light); padding-top: 16px; }
    .goal { max-width: 220px; }
    .row { display: grid; gap: 8px; align-items: center; }
    .row.svc { grid-template-columns: minmax(0, 2fr) 110px 130px 32px; .span { grid-column: 1 / -2; } padding-bottom: 10px; border-bottom: 1px dashed var(--border-light);
      @media (max-width: 640px) { grid-template-columns: 1fr 1fr; .span { grid-column: 1 / -1; } } }
    .row.two { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 32px; @media (max-width: 640px) { grid-template-columns: 1fr; } }
    .obj { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px dashed var(--border-light); .row.two { grid-template-columns: minmax(0, 1fr) 0 32px; } }
    .add { align-self: flex-start; }
    code { font-size: .75rem; background: var(--bg-2); padding: 1px 5px; border-radius: 4px; }
  `],
})
export class SalesKitSettingsComponent implements OnInit, HasUnsavedChanges {
  private readonly settings = inject(SettingsService);

  readonly portfolioPlaceholder = '{{portfolio_link}}';
  readonly data = signal<WorkspaceSettings | null>(null);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  form: KitForm = { clientGoal: 100, pitch: '', services: [], portfolio: [], objections: [] };
  private readonly snapshot = new Snapshot<KitForm>();

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set('');
    this.settings.workspace().subscribe({
      next: (d) => this.apply(d),
      error: (err) => this.loadError.set(err.error?.message || 'The sales kit couldn’t be loaded.'),
    });
  }

  private apply(d: WorkspaceSettings): void {
    this.data.set(d);
    const kit = d.salesKit;
    this.form = {
      clientGoal: d.defaults.clientGoal ?? 100,
      pitch: kit?.pitch ?? '',
      services: (kit?.services ?? []).map((sv) => ({
        name: sv.name, description: sv.description ?? '', price: sv.priceCents === null || sv.priceCents === undefined ? '' : String(sv.priceCents / 100), billing: sv.billing ?? '',
      })),
      portfolio: (kit?.portfolio ?? []).map((pf) => ({ ...pf })),
      objections: (kit?.objections ?? []).map((ob) => ({ ...ob })),
    };
    this.snapshot.set(this.form);
  }

  dirty(): boolean {
    return this.snapshot.isDirty(this.form);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  reset(): void {
    const d = this.data();
    if (d) this.apply(d);
  }

  save(): void {
    this.error.set('');
    const f = this.form;
    const services = f.services.filter((sv) => sv.name.trim() || sv.price.trim() || sv.description.trim());
    for (const sv of services) {
      if (!sv.name.trim()) { this.error.set('Every service needs a name.'); return; }
      if (sv.price.trim() && (Number.isNaN(Number(sv.price.replace(/[$,]/g, ''))) || Number(sv.price.replace(/[$,]/g, '')) < 0)) { this.error.set(`${sv.name}: the price must be a number, e.g. 1500 or 99.50`); return; }
    }
    const portfolio = f.portfolio.filter((pf) => pf.label.trim() || pf.url.trim());
    if (portfolio.some((pf) => !pf.label.trim() || !pf.url.trim())) { this.error.set('Each portfolio link needs a label and a web address.'); return; }
    const objections = f.objections.filter((ob) => ob.objection.trim() || ob.response.trim());
    if (objections.some((ob) => !ob.objection.trim() || !ob.response.trim())) { this.error.set('Each objection needs an answer.'); return; }
    if (f.clientGoal !== null && (!Number.isInteger(Number(f.clientGoal)) || Number(f.clientGoal) < 1)) { this.error.set('The client goal must be a whole number of 1 or more.'); return; }

    this.saving.set(true);
    this.settings.updateWorkspace({
      defaults: { clientGoal: f.clientGoal },
      salesKit: {
        pitch: f.pitch.trim(),
        services: services.map((sv) => ({
          name: sv.name.trim(),
          description: sv.description.trim(),
          priceCents: sv.price.trim() ? Math.round(Number(sv.price.replace(/[$,]/g, '')) * 100) : null,
          billing: sv.billing || null,
        })),
        portfolio: portfolio.map((pf) => ({ label: pf.label.trim(), url: pf.url.trim() })),
        objections: objections.map((ob) => ({ objection: ob.objection.trim(), response: ob.response.trim() })),
      },
    }).subscribe({
      next: (res) => { this.saving.set(false); this.apply(res); this.message.set('Sales kit saved.'); },
      error: (err) => { this.saving.set(false); this.error.set(err.error?.message || 'Not saved — your changes are still here.'); },
    });
  }
}
