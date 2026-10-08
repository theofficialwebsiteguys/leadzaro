import { Pipe, PipeTransform } from '@angular/core';
import { NEXT_ACTION_LABELS, NextActionType } from '../../../core/models/sales.model';

/** Money from cents in the record's own currency. */
export function money(cents: number | null | undefined, currency = 'usd'): string {
  if (cents === null || cents === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** "today", "in 3 days", "2 days ago" — relative to now, by calendar day. */
export function relativeDay(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(new Date())) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return days < 14 ? `in ${days} days` : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return -days < 14 ? `${-days} days ago` : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  const today = new Date();
  return date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export function nextActionLabel(type: string | null | undefined): string {
  return type ? NEXT_ACTION_LABELS[type as NextActionType] ?? 'Follow up' : 'Follow up';
}

export function termsLabel(r: { initialAmountCents: number; recurringAmountCents: number | null; recurringInterval: string | null; currency: string }): string {
  const today = `${money(r.initialAmountCents, r.currency)} today`;
  return r.recurringAmountCents ? `${today}, then ${money(r.recurringAmountCents, r.currency)}/${r.recurringInterval}` : today;
}

/** Local date+time string for <input type="datetime-local">. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Next business day at a sensible hour, `days` ahead. */
export function suggestDate(days: number, hour = 10): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date;
}

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(cents: number | null | undefined, currency = 'usd'): string {
    return money(cents, currency);
  }
}

@Pipe({ name: 'relativeDay', standalone: true })
export class RelativeDayPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    return relativeDay(value);
  }
}

/** Where a business detail came from, in plain words. */
export function sourceLabel(source: string | undefined): string {
  switch (source) {
    case 'google_places': return 'from Google listing';
    case 'manual': return 'entered by hand';
    case 'verified': return 'verified';
    case 'inbound_form': return 'from their enquiry';
    case 'demo': return 'demo data';
    default: return '';
  }
}
