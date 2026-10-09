import { Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** A Google search for a business by name and place. */
export function googleSearchUrl(name: string, ...place: (string | null | undefined)[]): string {
  return `https://www.google.com/search?q=${encodeURIComponent([name, ...place].filter(Boolean).join(' '))}`;
}

/**
 * One-click Google search for a lead, usable anywhere its name appears —
 * including inside clickable rows and links, which it doesn't trigger.
 */
@Component({
  selector: 'lz-google-search',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button type="button" class="g-search" [class.with-label]="!!label()" (click)="open($event)" (keydown.enter)="$event.stopPropagation()"
      [title]="'Search Google for ' + query()" [attr.aria-label]="'Search Google for ' + query()">
      <lz-icon name="search" [size]="size()" />@if (label()) { <span>{{ label() }}</span> }
    </button>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .g-search {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border: none; background: transparent;
      color: var(--text-muted); border-radius: var(--radius-sm); cursor: pointer; font: inherit; font-size: .75rem; line-height: 1;
      &:hover { color: var(--primary-dark); background: var(--bg-2); }
      &:focus-visible { outline: 2px solid var(--primary-light); outline-offset: 1px; }
      &.with-label { padding: 4px 8px; border: 1px solid var(--border); }
    }
  `],
})
export class GoogleSearchComponent {
  readonly name = input.required<string>();
  readonly city = input<string | null | undefined>(null);
  readonly state = input<string | null | undefined>(null);
  readonly label = input<string>('');
  readonly size = input(13);

  readonly query = computed(() => [this.name(), this.city(), this.state()].filter(Boolean).join(' '));

  /** Opens in a new tab without following the row or link it sits in. */
  open(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    window.open(googleSearchUrl(this.name(), this.city(), this.state()), '_blank', 'noopener');
  }
}
