import { Component } from '@angular/core';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';

/**
 * Real in-app messaging is planned but not built yet — no data loading,
 * no service calls, just the coming-soon state. Trimmed to one file so
 * bringing real messaging back later is a one-file swap, not an
 * archaeology dig through half-finished channel/message code.
 */
@Component({
  selector: 'app-messaging',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './messaging.component.html',
})
export class MessagingComponent {}
