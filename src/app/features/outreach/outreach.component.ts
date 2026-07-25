import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OutreachActivity } from '../../core/models/lead.model';
import { OutreachService } from '../../core/services/outreach.service';

@Component({
  selector: 'app-outreach',
  standalone: true,
  imports: [RouterLink, DatePipe, TitleCasePipe],
  templateUrl: './outreach.component.html',
  styleUrl: './outreach.component.scss',
})
export class OutreachComponent implements OnInit {
  private readonly outreachService = inject(OutreachService);

  activities = signal<OutreachActivity[]>([]);
  loading = signal(true);
  total = signal(0);
  page = signal(1);
  totalPages = signal(1);
  showArchived = signal(false);

  ngOnInit() { this.load(); }

  toggleArchived() {
    this.showArchived.set(!this.showArchived());
    this.load(1);
  }

  load(p = 1) {
    this.loading.set(true);
    this.page.set(p);
    this.outreachService.getAll(undefined, p, 20, this.showArchived()).subscribe({
      next: (res) => {
        this.activities.set(res.data.items);
        this.total.set(res.data.pagination.total);
        this.totalPages.set(res.data.pagination.totalPages);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  activityIcon(type: string): string {
    const icons: Record<string, string> = { call: '📞', email: '📧', visit: '🏢', message: '💬', linkedin: '💼', other: '📝' };
    return icons[type] || '📝';
  }

  archive(id: string) {
    if (!confirm('Archive this activity log? You can restore it later.')) return;
    this.outreachService.archive(id).subscribe(() => {
      this.activities.set(this.activities().filter((a) => a.id !== id));
    });
  }

  restore(id: string) {
    this.outreachService.restore(id).subscribe(() => {
      this.activities.set(this.activities().filter((a) => a.id !== id));
    });
  }
}
