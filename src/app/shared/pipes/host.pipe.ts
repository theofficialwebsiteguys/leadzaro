import { Pipe, PipeTransform } from '@angular/core';

/** "https://www.havenfitclub.com/about" → "havenfitclub.com" */
@Pipe({ name: 'host', standalone: true })
export class HostPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return value;
    }
  }
}

export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  return (words.slice(0, 2).map((word) => word[0]).join('') || '?').toUpperCase();
}
