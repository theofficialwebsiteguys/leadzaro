import { Component, input } from '@angular/core';
import { SOURCE_LABELS, ValueSource } from '../../core/models/domain.model';

/** Tiny label saying where a value came from: synced from Namecheap, entered by hand, or an estimate. */
@Component({
  selector: 'app-source-tag',
  standalone: true,
  template: `@if (source()) { <span class="source-tag" [class]="'source-tag source-' + source()" [title]="title()">{{ label() }}</span> }`,
  styles: [`
    .source-tag {
      display: inline-block;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: var(--radius-full);
      font-size: .68rem;
      font-weight: 600;
      letter-spacing: .02em;
      line-height: 1.6;
      vertical-align: middle;
      white-space: nowrap;
    }
    .source-namecheap { background: rgba(99, 102, 241, .12); color: var(--primary-dark); }
    .source-manual { background: var(--border-light); color: var(--text-secondary); }
    .source-estimate { background: rgba(245, 158, 11, .14); color: var(--warning-text); }
  `],
})
export class SourceTagComponent {
  readonly source = input<ValueSource>(null);

  label(): string {
    const source = this.source();
    return source ? SOURCE_LABELS[source] : '';
  }

  title(): string {
    switch (this.source()) {
      case 'namecheap': return 'Synced from the connected Namecheap account';
      case 'manual': return 'Entered by hand in Leadzaro';
      case 'estimate': return 'Estimated from Namecheap’s current price list — not an amount that was paid';
      default: return '';
    }
  }
}
