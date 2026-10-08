import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { map } from 'rxjs';
import { MeetingService } from '../../core/services/meeting.service';
import { Meeting } from '../../core/models/meeting.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';

interface CalendarDay {
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  meetings: Meeting[];
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

@Component({
  selector: 'app-meeting-calendar',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, EmptyStateComponent],
  templateUrl: './meeting-calendar.component.html',
  styleUrl: './meeting-calendar.component.scss',
})
export class MeetingCalendarComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly meetingService = inject(MeetingService);

  readonly weekdayLabels = WEEKDAY_LABELS;

  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  meetings = signal<Meeting[]>([]);
  actionMessage = signal('');
  scheduling = signal(false);

  private readonly today = new Date();
  viewYear = signal(this.today.getFullYear());
  viewMonth = signal(this.today.getMonth());
  selectedDateKey = signal(dateKey(this.today));

  monthLabel = computed(() => new Date(this.viewYear(), this.viewMonth(), 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  private meetingsByDay = computed(() => {
    const map = new Map<string, Meeting[]>();
    for (const meeting of this.meetings()) {
      const slot = meeting.confirmedSlot || meeting.proposedSlots[0];
      if (!slot) continue;
      const key = dateKey(new Date(slot.start));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(meeting);
    }
    return map;
  });

  calendarDays = computed<CalendarDay[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const byDay = this.meetingsByDay();

    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = dateKey(date);
      return {
        date,
        inCurrentMonth: date.getMonth() === month,
        isToday: key === dateKey(this.today),
        meetings: byDay.get(key) || [],
      };
    });
  });

  selectedDayMeetings = computed(() => this.meetingsByDay().get(this.selectedDateKey()) || []);

  newMeetingSubject = '';
  newMeetingDate = '';
  newMeetingStartTime = '';
  newMeetingEndTime = '';

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.loadMeetings(id);
    });
  }

  loadMeetings(projectId: string) {
    this.meetingService.list(projectId).subscribe((res) => this.meetings.set(res.data.meetings.filter((m) => m.status !== 'cancelled' && m.status !== 'declined')));
  }

  prevMonth() {
    const d = new Date(this.viewYear(), this.viewMonth() - 1, 1);
    this.viewYear.set(d.getFullYear());
    this.viewMonth.set(d.getMonth());
  }

  nextMonth() {
    const d = new Date(this.viewYear(), this.viewMonth() + 1, 1);
    this.viewYear.set(d.getFullYear());
    this.viewMonth.set(d.getMonth());
  }

  goToToday() {
    this.viewYear.set(this.today.getFullYear());
    this.viewMonth.set(this.today.getMonth());
    this.selectedDateKey.set(dateKey(this.today));
  }

  isSelected(day: CalendarDay): boolean {
    return dateKey(day.date) === this.selectedDateKey();
  }

  selectDay(day: CalendarDay) {
    this.selectedDateKey.set(dateKey(day.date));
    if (!day.inCurrentMonth) {
      this.viewYear.set(day.date.getFullYear());
      this.viewMonth.set(day.date.getMonth());
    }
  }

  startScheduling() {
    this.newMeetingDate = this.toDateInputValue(this.parseDateKey(this.selectedDateKey()));
    this.newMeetingStartTime = '09:00';
    this.newMeetingEndTime = '09:30';
    this.scheduling.set(true);
  }

  private parseDateKey(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m, d);
  }

  private toDateInputValue(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * "Schedule directly" rather than the underlying request→confirm
   * workflow's two separate steps: there's no external client waiting to
   * pick a slot right now, so this project's own scheduling action just
   * requests and immediately confirms the same slot as one action.
   */
  scheduleMeeting() {
    const id = this.projectId();
    if (!id || !this.newMeetingSubject.trim() || !this.newMeetingDate || !this.newMeetingStartTime || !this.newMeetingEndTime) return;

    const start = new Date(`${this.newMeetingDate}T${this.newMeetingStartTime}`).toISOString();
    const end = new Date(`${this.newMeetingDate}T${this.newMeetingEndTime}`).toISOString();

    this.meetingService.request(id, this.newMeetingSubject.trim(), [{ start, end }]).subscribe({
      next: (res) => {
        this.meetingService.confirm(id, res.data.meeting.id, { start, end }).subscribe({
          next: () => {
            this.scheduling.set(false);
            this.newMeetingSubject = '';
            this.selectedDateKey.set(dateKey(new Date(this.newMeetingDate)));
            this.loadMeetings(id);
          },
          error: (err) => this.actionMessage.set(err.error?.message || 'Failed to confirm meeting'),
        });
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to schedule meeting'),
    });
  }

  cancelMeeting(meeting: Meeting) {
    const id = this.projectId();
    if (!id) return;
    this.meetingService.cancel(id, meeting.id).subscribe(() => this.loadMeetings(id));
  }

  /**
   * Forwarding without needing live Google Calendar credentials: a
   * standard .ics file any calendar app can import, plus a mailto: link
   * pre-filled with the same details.
   */
  forwardMeeting(meeting: Meeting) {
    const slot = meeting.confirmedSlot || meeting.proposedSlots[0];
    if (!slot) return;
    const toIcsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Leadzaro//Meeting//EN',
      'BEGIN:VEVENT',
      `UID:${meeting.id}@leadzaro`,
      `DTSTART:${toIcsDate(slot.start)}`,
      `DTEND:${toIcsDate(slot.end)}`,
      `SUMMARY:${meeting.subject}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.subject.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
    link.click();
    URL.revokeObjectURL(url);

    const start = new Date(slot.start).toLocaleString();
    const end = new Date(slot.end).toLocaleString();
    const body = encodeURIComponent(`${meeting.subject}\n${start} - ${end}\n\n(Calendar file attached separately — download it from Leadzaro and attach it to this email.)`);
    window.open(`mailto:?subject=${encodeURIComponent('Meeting: ' + meeting.subject)}&body=${body}`, '_blank');
  }
}
