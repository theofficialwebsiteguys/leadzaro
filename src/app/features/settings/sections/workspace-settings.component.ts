import { PhoneInputDirective, ZipInputDirective } from '../../../shared/forms/formatted-inputs';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings.service';
import { WorkspaceSettings } from '../../../core/models/settings.model';
import { HasUnsavedChanges, Snapshot } from '../unsaved-changes.guard';

const COMMON_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

function allZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const list = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...COMMON_ZONES, ...list])];
}

interface WorkspaceForm {
  company: { name: string; phone: string; email: string; website: string; addressLine1: string; city: string; state: string; postalCode: string };
  defaults: { timezone: string; defaultSearchLocation: string; defaultSearchKeywords: string; defaultFollowUpDays: number | null };
}

/**
 * Workspace (ADR 0012): the company's own details and the defaults shared
 * by everyone. Only administrators (workspace.manage) can change them —
 * enforced on the server; everyone else sees them read-only.
 */
@Component({
  selector: 'app-workspace-settings',
  standalone: true,
  imports: [FormsModule, PhoneInputDirective, ZipInputDirective],
  template: `
    <section class="set-section">
      <div class="set-intro"><h2>Workspace</h2><p>Company information and defaults that apply to everyone.</p></div>

      @if (loadError()) { <div class="alert alert-error">{{ loadError() }} <button class="btn btn-ghost btn-sm" (click)="load()">Try again</button></div> }
      @else if (!data()) { <div class="loading-state"><div class="spinner"></div></div> }
      @else {
        @if (!data()!.canEdit) { <div class="alert alert-info">Only an administrator can change workspace settings. They’re shown here for reference.</div> }
        <form class="set-card" (ngSubmit)="save()">
          <div class="set-card-head">
            <div><h3>Company profile</h3><p>The business itself — not any one person. The company name fills <code>{{ companyPlaceholder }}</code> in templates.</p></div>
            <span class="scope-tag workspace">Whole workspace</span>
          </div>
          <fieldset class="set-card-body set-grid" [disabled]="!data()!.canEdit">
            <div class="form-group span2"><label class="form-label" for="w-name">Company name</label><input id="w-name" class="form-control" name="name" [(ngModel)]="form.company.name" required maxlength="255" /></div>
            <div class="form-group"><label class="form-label" for="w-email">Company contact email</label><input id="w-email" type="email" class="form-control" name="email" [(ngModel)]="form.company.email" placeholder="hello@yourcompany.com" />
              <span class="form-hint">The public address for the business — not anyone’s login.</span></div>
            <div class="form-group"><label class="form-label" for="w-phone">Company phone</label><input id="w-phone" class="form-control" name="phone" [(ngModel)]="form.company.phone" lzPhone placeholder="(555) 123-4567" /></div>
            <div class="form-group span2"><label class="form-label" for="w-web">Company website</label><input id="w-web" class="form-control" name="website" [(ngModel)]="form.company.website" placeholder="yourcompany.com" /></div>
            <div class="form-group span2"><label class="form-label" for="w-addr">Street address</label><input id="w-addr" class="form-control" name="addressLine1" [(ngModel)]="form.company.addressLine1" /></div>
            <div class="form-group"><label class="form-label" for="w-city">City</label><input id="w-city" class="form-control" name="city" [(ngModel)]="form.company.city" /></div>
            <div class="form-group row2">
              <div><label class="form-label" for="w-state">State</label><input id="w-state" class="form-control" name="state" [(ngModel)]="form.company.state" /></div>
              <div><label class="form-label" for="w-zip">ZIP</label><input id="w-zip" class="form-control" name="postalCode" [(ngModel)]="form.company.postalCode" lzZip /></div>
            </div>
          </fieldset>

          <div class="set-card-head sub-head"><div><h3>Shared defaults</h3><p>Used whenever a person hasn’t set their own preference.</p></div></div>
          <fieldset class="set-card-body set-grid" [disabled]="!data()!.canEdit">
            <div class="form-group"><label class="form-label" for="w-tz">Timezone</label>
              <select id="w-tz" class="form-select" name="timezone" [(ngModel)]="form.defaults.timezone">
                <option value="">Each person’s own device time</option>
                @for (z of zones; track z) { <option [value]="z">{{ z.replace('_', ' ') }}</option> }
              </select>
              <span class="form-hint">Decides when “today”, “overdue” and report days start for everyone.</span></div>
            <div class="form-group"><label class="form-label" for="w-fu">Default follow-up (days)</label>
              <input id="w-fu" type="number" min="1" max="30" class="form-control" name="followUp" [(ngModel)]="form.defaults.defaultFollowUpDays" />
              <span class="form-hint">Suggested gap before the next follow-up after outreach.</span></div>
            <div class="form-group"><label class="form-label" for="w-loc">Default search location</label>
              <input id="w-loc" class="form-control" name="loc" [(ngModel)]="form.defaults.defaultSearchLocation" placeholder="e.g. Miami, FL" />
              <span class="form-hint">Pre-fills Find Leads for anyone without their own location.</span></div>
            <div class="form-group"><label class="form-label" for="w-kw">Default search keywords</label>
              <input id="w-kw" class="form-control" name="kw" [(ngModel)]="form.defaults.defaultSearchKeywords" placeholder="e.g. plumbers" /></div>
          </fieldset>

          @if (data()!.canEdit) {
            <div class="set-actions">
              @if (dirty()) { <span class="dirty">Unsaved changes</span> } @else if (message()) { <span class="saved" role="status">{{ message() }}</span> }
              @if (error()) { <span class="form-error" role="alert">{{ error() }}</span> }
              <button type="button" class="btn btn-ghost btn-sm" (click)="reset()" [disabled]="!dirty()">Discard</button>
              <button type="submit" class="btn btn-primary btn-sm" [disabled]="!dirty() || saving()">{{ saving() ? 'Saving…' : 'Save workspace' }}</button>
            </div>
          }
        </form>
      }
    </section>
  `,
  styles: [`
    fieldset { border: none; margin: 0; min-width: 0; }
    .sub-head { border-top: 1px solid var(--border-light); padding-top: 16px; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; div { display: flex; flex-direction: column; gap: 6px; } }
    code { font-size: .75rem; background: var(--bg-2); padding: 1px 5px; border-radius: 4px; }
  `],
})
export class WorkspaceSettingsComponent implements OnInit, HasUnsavedChanges {
  private readonly settings = inject(SettingsService);

  readonly zones = allZones();
  readonly companyPlaceholder = '{{my_company}}';
  readonly data = signal<WorkspaceSettings | null>(null);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  form: WorkspaceForm = this.blank();
  private readonly snapshot = new Snapshot<WorkspaceForm>();

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set('');
    this.settings.workspace().subscribe({
      next: (d) => this.apply(d),
      error: (err) => this.loadError.set(err.error?.message || 'Workspace settings couldn’t be loaded.'),
    });
  }

  private blank(): WorkspaceForm {
    return {
      company: {
        name: '', phone: '', email: '', website: '', addressLine1: '', city: '', state: '', postalCode: '',
      },
      defaults: {
        timezone: '', defaultSearchLocation: '', defaultSearchKeywords: '', defaultFollowUpDays: 2,
      },
    };
  }

  private apply(d: WorkspaceSettings): void {
    this.data.set(d);
    const c = d.company;
    this.form = {
      company: {
        name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '', addressLine1: c.addressLine1 ?? '', city: c.city ?? '', state: c.state ?? '', postalCode: c.postalCode ?? '',
      },
      defaults: {
        timezone: d.defaults.timezone ?? '', defaultSearchLocation: d.defaults.defaultSearchLocation ?? '', defaultSearchKeywords: d.defaults.defaultSearchKeywords ?? '', defaultFollowUpDays: d.defaults.defaultFollowUpDays ?? 2,
      },
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
    if (!this.form.company.name.trim()) { this.error.set('Company name is required.'); return; }
    const d = this.data();
    if (d && this.form.defaults.timezone !== (d.defaults.timezone ?? '')
      && !confirm('Changing the timezone changes when “today” and “overdue” start for everyone. Continue?')) return;
    this.saving.set(true);
    this.error.set('');
    this.settings.updateWorkspace(this.form).subscribe({
      next: (res) => { this.saving.set(false); this.apply(res); this.message.set('Workspace saved.'); },
      error: (err) => { this.saving.set(false); this.error.set(err.error?.message || 'Not saved — your changes are still here.'); },
    });
  }
}
