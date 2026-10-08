import { Pipe, PipeTransform } from '@angular/core';

/**
 * Renders a raw snake_case status/enum value (e.g. 'on_track',
 * 'in_progress', 'past_due') as a readable label ('On Track', 'In
 * Progress', 'Past Due') — CSS text-transform:capitalize alone only
 * capitalizes the first letter and leaves the underscore, producing
 * "On_track" rather than "On Track".
 */
@Pipe({ name: 'label', standalone: true })
export class LabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    return value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
