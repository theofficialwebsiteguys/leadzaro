import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { CrmService } from '../../core/services/crm.service';
import { PublicWebsiteAuditReport } from '../../core/models/crm.model';

@Component({
  selector: 'app-public-audit',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './public-audit.component.html',
  styleUrl: './public-audit.component.scss',
})
export class PublicAuditComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly crm = inject(CrmService);

  loading = signal(true);
  loadError = signal('');
  report = signal<PublicWebsiteAuditReport | null>(null);

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!token) {
      this.loadError.set('This report link is missing a token.');
      this.loading.set(false);
      return;
    }

    this.crm.getPublicWebsiteAudit(token).subscribe({
      next: (res) => { this.report.set(res.data); this.loading.set(false); },
      error: (err) => {
        this.loadError.set(err.error?.message || 'This report link is invalid.');
        this.loading.set(false);
      },
    });
  }

  scoreClass(score: number): string {
    if (score >= 70) return 'score-high';
    if (score >= 40) return 'score-medium';
    return 'score-low';
  }
}
