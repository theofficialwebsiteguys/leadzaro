import {
  Directive, ElementRef, Pipe, PipeTransform, forwardRef, inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * US phone format as you type: (555) 123-4567. A leading 1 becomes +1,
 * digits past ten become an extension (x123), and numbers starting with
 * + and another country code are kept as +digits.
 */
export function formatPhone(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && !digits.startsWith('1')) return `+${digits.slice(0, 15)}`;
  if (digits.startsWith('0')) return digits.slice(0, 15);

  const hasCountry = digits.startsWith('1');
  const national = hasCountry ? digits.slice(1) : digits;
  const prefix = hasCountry ? '+1 ' : '';
  if (!national) return hasCountry ? '+1' : '';

  const main = national.slice(0, 10);
  const ext = national.slice(10, 15);
  let out;
  if (main.length <= 3) out = `(${main}`;
  else if (main.length <= 6) out = `(${main.slice(0, 3)}) ${main.slice(3)}`;
  else out = `(${main.slice(0, 3)}) ${main.slice(3, 6)}-${main.slice(6)}`;
  return prefix + out + (ext ? ` x${ext}` : '');
}

/** ZIP or ZIP+4 (12345-6789). Postal codes with letters (e.g. Canadian) are just uppercased. */
export function formatPostalCode(input: unknown): string {
  const raw = String(input ?? '');
  if (/[a-z]/i.test(raw)) return raw.toUpperCase().replace(/\s+/g, ' ').trimStart().slice(0, 10);
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

const isDigit = (ch: string | undefined) => !!ch && ch >= '0' && ch <= '9';

/**
 * Shared behaviour for inputs that format while typing: works with
 * ngModel and reactive forms (it replaces the default value accessor),
 * keeps the cursor next to the digit you were editing, and lets Backspace
 * and Delete step over the brackets, spaces and dashes it adds.
 */
@Directive({
  host: {
    '(input)': 'onInput()',
    '(blur)': 'onTouched()',
    '(keydown)': 'onKeydown($event)',
  },
})
abstract class FormattedInput implements ControlValueAccessor {
  protected readonly el: HTMLInputElement = inject(ElementRef<HTMLInputElement>).nativeElement;
  private onChange: (value: string) => void = () => undefined;
  onTouched: () => void = () => undefined;

  protected abstract format(value: unknown): string;

  /** Characters the person actually typed (as opposed to added formatting). */
  protected isSignificant(ch: string | undefined): boolean {
    return isDigit(ch);
  }

  private countSignificant(text: string): number {
    let n = 0;
    for (const ch of text) if (this.isSignificant(ch)) n += 1;
    return n;
  }

  writeValue(value: unknown): void {
    this.el.value = this.format(value);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.el.disabled = disabled;
  }

  onInput(): void {
    this.apply(this.el.value, this.el.selectionStart ?? this.el.value.length);
  }

  onKeydown(event: KeyboardEvent): void {
    const { selectionStart: start, selectionEnd: end, value } = this.el;
    if (start === null || start !== end) return;
    if (event.key === 'Backspace' && start > 0 && !this.isSignificant(value[start - 1])) {
      let i = start - 1;
      while (i >= 0 && !this.isSignificant(value[i])) i -= 1;
      if (i < 0) return;
      event.preventDefault();
      this.apply(value.slice(0, i) + value.slice(i + 1), i);
    } else if (event.key === 'Delete' && start < value.length && !this.isSignificant(value[start])) {
      let j = start;
      while (j < value.length && !this.isSignificant(value[j])) j += 1;
      if (j >= value.length) return;
      event.preventDefault();
      this.apply(value.slice(0, j) + value.slice(j + 1), start);
    }
  }

  private apply(raw: string, caret: number): void {
    const digitsBefore = this.countSignificant(raw.slice(0, caret));
    const formatted = this.format(raw);
    this.el.value = formatted;
    if (document.activeElement === this.el) {
      let pos = 0;
      let seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (this.isSignificant(formatted[pos])) seen += 1;
        pos += 1;
      }
      // Typing at the end keeps the cursor at the end, after any separator just added.
      if (seen === digitsBefore && digitsBefore === this.countSignificant(formatted)) pos = formatted.length;
      this.el.setSelectionRange(pos, pos);
    }
    this.onChange(formatted);
  }
}

/** `<input lzPhone>` — formats phone numbers as you type. */
@Directive({
  selector: 'input[lzPhone]',
  standalone: true,
  host: { inputmode: 'tel', autocomplete: 'tel' },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PhoneInputDirective), multi: true }],
})
export class PhoneInputDirective extends FormattedInput {
  protected format(value: unknown): string {
    return formatPhone(value);
  }
}

/** `<input lzZip>` — formats US ZIP / ZIP+4 as you type. */
@Directive({
  selector: 'input[lzZip]',
  standalone: true,
  host: { autocomplete: 'postal-code', maxlength: '10' },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ZipInputDirective), multi: true }],
})
export class ZipInputDirective extends FormattedInput {
  protected format(value: unknown): string {
    return formatPostalCode(value);
  }

  protected override isSignificant(ch: string | undefined): boolean {
    return !!ch && /[0-9A-Za-z]/.test(ch);
  }
}

/** Displays a stored phone number in the same format: {{ phone | phone }}. */
@Pipe({ name: 'phone', standalone: true })
export class PhonePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? formatPhone(value) : '';
  }
}
