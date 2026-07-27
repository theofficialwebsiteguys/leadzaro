export interface TimeSlot {
  start: string;
  end: string;
}

export interface Meeting {
  id: string;
  projectId: string;
  subject: string;
  status: 'requested' | 'confirmed' | 'declined' | 'cancelled';
  proposedSlots: TimeSlot[];
  confirmedSlot: TimeSlot | null;
  confirmedAt: string | null;
  googleCalendarEventId: string | null;
}
