import { CanDeactivateFn } from '@angular/router';

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/** Asks before leaving a settings section with edits that weren't saved (ADR 0012). */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => !component?.hasUnsavedChanges?.()
  || confirm('You have unsaved changes in this section. Leave without saving?');

/** Snapshot helper: compares the current form to what was last loaded or saved. */
export class Snapshot<T> {
  private saved = '';

  set(value: T): void {
    this.saved = JSON.stringify(value);
  }

  isDirty(value: T): boolean {
    return this.saved !== '' && JSON.stringify(value) !== this.saved;
  }
}
