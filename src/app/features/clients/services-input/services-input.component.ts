import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * A short list of services ("Website build", "Care plan") edited as chips
 * (ADR 0013). Enter or comma adds one; suggestions come from the Sales kit
 * so the same service is always named the same way.
 */
@Component({
  selector: 'app-services-input',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="chips" [class.focus]="focused">
      @for (service of services(); track service) {
        <span class="chip">{{ service }}
          <button type="button" (click)="remove(service)" [attr.aria-label]="'Remove ' + service">×</button>
        </span>
      }
      <input [id]="inputId()" [(ngModel)]="draft" [ngModelOptions]="{ standalone: true }" (keydown)="onKey($event)" (blur)="focused = false; add()" (focus)="focused = true"
        [placeholder]="services().length ? 'Add another…' : placeholder()" maxlength="120" autocomplete="off" />
    </div>
    @if (openSuggestions().length) {
      <div class="suggest">
        <span class="text-xs text-muted">From your Sales kit:</span>
        @for (s of openSuggestions(); track s) { <button type="button" class="suggest-chip" (click)="pick(s)">+ {{ s }}</button> }
      </div>
    }
  `,
  styles: [`
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 40px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card);
      &.focus { border-color: var(--primary); }
      input { flex: 1; min-width: 140px; border: none; outline: none; background: transparent; font-size: .875rem; padding: 4px; color: var(--text-primary); } }
    .chip { display: inline-flex; align-items: center; gap: 4px; background: var(--primary-50); color: var(--primary-dark); border-radius: var(--radius-full); padding: 3px 4px 3px 10px; font-size: .8rem; font-weight: 500;
      button { border: none; background: none; color: inherit; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 4px; border-radius: 50%; &:hover { background: rgba(0,0,0,.06); } } }
    .suggest { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
    .suggest-chip { border: 1px dashed var(--border); background: none; border-radius: var(--radius-full); padding: 2px 10px; font-size: .75rem; color: var(--text-secondary); cursor: pointer; &:hover { border-color: var(--primary); color: var(--primary-dark); } }
  `],
})
export class ServicesInputComponent {
  readonly services = model<string[]>([]);
  readonly suggestions = input<string[]>([]);
  readonly inputId = input('services-input');
  readonly placeholder = input('Type a service and press Enter');

  draft = '';
  focused = false;

  readonly openSuggestions = computed(() => {
    const chosen = new Set(this.services().map((s) => s.toLowerCase()));
    return this.suggestions().filter((s) => !chosen.has(s.toLowerCase())).slice(0, 8);
  });

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.add();
    } else if (event.key === 'Backspace' && !this.draft && this.services().length) {
      this.services.set(this.services().slice(0, -1));
    }
  }

  add(): void {
    const value = this.draft.trim().replace(/,$/, '').trim();
    this.draft = '';
    if (value) this.pick(value);
  }

  pick(value: string): void {
    const exists = this.services().some((s) => s.toLowerCase() === value.toLowerCase());
    if (!exists && this.services().length < 20) this.services.set([...this.services(), value.slice(0, 120)]);
  }

  remove(value: string): void {
    this.services.set(this.services().filter((s) => s !== value));
  }
}
