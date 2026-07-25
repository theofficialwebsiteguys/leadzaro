import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { SavedLead, LeadNote, OutreachActivity, LEAD_STATUSES, LEAD_PRIORITIES, LeadStatus, LeadPriority, OutreachType } from '../../core/models/lead.model';
import { SavedLeadService } from '../../core/services/saved-lead.service';
import { OutreachService } from '../../core/services/outreach.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-lead-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, TitleCasePipe, IconComponent],
  templateUrl: './lead-detail.component.html',
  styleUrl: './lead-detail.component.scss',
})
export class LeadDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly savedLeadService = inject(SavedLeadService);
  private readonly outreachService = inject(OutreachService);

  readonly statuses = LEAD_STATUSES;
  readonly priorities = LEAD_PRIORITIES;
  readonly activityTypes = ['call', 'email', 'visit', 'message', 'linkedin', 'other'];

  savedLead = signal<SavedLead | null>(null);
  notes = signal<LeadNote[]>([]);
  activities = signal<OutreachActivity[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal('');

  newNote = '';
  newActivityType = 'call';
  newActivityNote = '';
  followUpDate = '';
  selectedStatus = '';
  selectedPriority = '';

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const fragment = this.route.snapshot.fragment;
    this.savedLeadService.getById(id).subscribe({
      next: (res) => {
        this.savedLead.set(res.data.savedLead);
        this.notes.set(res.data.notes);
        this.activities.set(res.data.activities);
        this.selectedStatus = res.data.savedLead.status;
        this.selectedPriority = res.data.savedLead.priority;
        this.followUpDate = res.data.savedLead.nextFollowUpAt
          ? res.data.savedLead.nextFollowUpAt.split('T')[0]
          : '';
        this.loading.set(false);
        if (fragment === 'log') {
          setTimeout(() => document.getElementById('log')?.scrollIntoView({ behavior: 'smooth' }), 300);
        }
      },
      error: (err) => { this.error.set(err.error?.message || 'Failed to load lead'); this.loading.set(false); },
    });
  }

  saveChanges() {
    const sl = this.savedLead();
    if (!sl) return;
    this.saving.set(true);

    this.savedLeadService.update(sl.id, {
      status: this.selectedStatus as LeadStatus,
      priority: this.selectedPriority as LeadPriority,
      nextFollowUpAt: this.followUpDate || undefined,
    }).subscribe({
      next: (res) => { this.savedLead.set(res.data.savedLead); this.saving.set(false); },
      error: () => this.saving.set(false),
    });
  }

  addNote() {
    const sl = this.savedLead();
    if (!sl || !this.newNote.trim()) return;

    this.savedLeadService.addNote(sl.id, this.newNote).subscribe({
      next: (res) => {
        this.notes.set([res.data.note, ...this.notes()]);
        this.newNote = '';
      },
    });
  }

  logActivity() {
    const sl = this.savedLead();
    if (!sl) return;

    this.outreachService.add(sl.leadId, this.newActivityType as OutreachType, this.newActivityNote).subscribe({
      next: (res) => {
        this.activities.set([res.data.activity, ...this.activities()]);
        this.newActivityNote = '';

        if (this.selectedStatus === 'Saved' || this.selectedStatus === 'New') {
          this.selectedStatus = 'Contacted';
          this.saveChanges();
        }
      },
    });
  }

  activityIcon(type: string): string {
    const icons: Record<string, string> = { call: 'phone', email: 'mail', visit: 'target', message: 'outreach', linkedin: 'users', other: 'check' };
    return icons[type] ?? 'check';
  }

  statusBadgeClass(status: string): string {
    return 'badge badge-' + status.toLowerCase().replaceAll(' ', '-');
  }
}
