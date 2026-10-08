import { BILLING_FREQUENCY_SUFFIX, BillingFrequency } from '../../core/models/client.model';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today until a YYYY-MM-DD date (negative when past). */
export function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(year, month - 1, day).getTime();
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / DAY_MS);
}

export type RenewalTone = 'ok' | 'soon' | 'overdue';

export function renewalTone(isoDate: string | null): RenewalTone | null {
  const days = daysUntil(isoDate);
  if (days === null) return null;
  if (days < 0) return 'overdue';
  if (days <= 30) return 'soon';
  return 'ok';
}

export function renewalHint(isoDate: string | null): string {
  const days = daysUntil(isoDate);
  if (days === null) return '';
  if (days < 0) return `overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function frequencySuffix(frequency: BillingFrequency | null): string {
  return frequency ? BILLING_FREQUENCY_SUFFIX[frequency] : '';
}

/** Recurring price normalized to a monthly figure, for margin math. */
export function monthlyEquivalentCents(cents: number | null, frequency: BillingFrequency | null): number | null {
  if (cents === null || !frequency || frequency === 'one_time') return null;
  if (frequency === 'quarterly') return Math.round(cents / 3);
  if (frequency === 'annually') return Math.round(cents / 12);
  return cents;
}

export function dollarsToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(String(value).replaceAll(/[$,\s]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : Number.NaN;
}

export function centsToDollars(cents: number | null): string {
  if (cents === null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
