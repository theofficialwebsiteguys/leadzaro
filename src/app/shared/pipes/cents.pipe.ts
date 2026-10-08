import { Pipe, PipeTransform } from '@angular/core';

const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** 9900 → "$99", 4950 → "$49.50", null → "". */
@Pipe({ name: 'cents', standalone: true })
export class CentsPipe implements PipeTransform {
  transform(value: number | null | undefined, suffix = ''): string {
    if (value === null || value === undefined) return '';
    const formatted = value % 100 === 0 ? WHOLE.format(value / 100) : EXACT.format(value / 100);
    return `${formatted}${suffix}`;
  }
}
