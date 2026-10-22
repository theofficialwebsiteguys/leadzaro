import { Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMAIL_SOURCE_TYPES } from '../../core/models/workflow.model';

/**
 * "Where did you find this email?" (ADR 0017): a short list of choices,
 * a few words for "Other", and an optional link — so choosing "Facebook"
 * is an answer, not a malformed web address. Problems are shown by the
 * parent, which knows which field each one belongs to.
 */
@Component({
  selector: 'app-email-source',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="es">
      <select class="form-select" [class.is-invalid]="!!typeError()" [ngModel]="type()" (ngModelChange)="type.set($event); changed.emit('sourceType')"
        [attr.aria-label]="'Where did you find ' + (email() || 'this email') + '?'">
        <option value="">Where did you find it?</option>
        @for (t of types; track t.key) { <option [value]="t.key">{{ t.label }}</option> }
      </select>
      @if (type() === 'other') {
        <input class="form-control" [class.is-invalid]="!!noteError()" [ngModel]="note()" (ngModelChange)="note.set($event); changed.emit('sourceNote')" maxlength="200"
          placeholder="Where? e.g. a flyer in their window" aria-label="Where you found it" />
      }
      @if (showLink()) {
        <input class="form-control" [class.is-invalid]="!!urlError()" [ngModel]="url()" (ngModelChange)="url.set($event); changed.emit('sourceUrl')"
          placeholder="Link to the page (optional)" aria-label="Link to where you found it (optional)" />
      } @else {
        <button type="button" class="add-link" (click)="linkOpen.set(true)">+ Add the link</button>
      }
    </div>
    @for (e of [typeError(), noteError(), urlError()]; track $index) { @if (e) { <p class="field-err" role="alert">{{ e }}</p> } }
  `,
  styles: [`
    .es { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; > * { flex: 1 1 160px; min-width: 0; } }
    .add-link { flex: 0 0 auto; background: none; border: 0; color: var(--primary); font-size: .78rem; cursor: pointer; padding: 4px 2px; }
    .field-err { margin: 4px 0 0; font-size: .78rem; color: var(--danger-text); }
  `],
})
export class EmailSourceComponent {
  readonly type = model<string>('');
  readonly note = model<string>('');
  readonly url = model<string>('');
  readonly email = input<string>('');
  readonly typeError = input<string | null>(null);
  readonly noteError = input<string | null>(null);
  readonly urlError = input<string | null>(null);
  /** Which part changed, so the parent can clear that field's problem. */
  readonly changed = output<'sourceType' | 'sourceNote' | 'sourceUrl'>();
  readonly types = EMAIL_SOURCE_TYPES;
  readonly linkOpen = signal(false);
  readonly showLink = computed(() => this.linkOpen() || Boolean(this.url()) || Boolean(this.urlError()));
}
