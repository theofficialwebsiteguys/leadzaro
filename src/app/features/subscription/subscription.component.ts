import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SlicePipe } from '@angular/common';
import { SubscriptionPlan, UserSubscription } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-subscription',
  standalone: true,
  imports: [SlicePipe],
  templateUrl: './subscription.component.html',
  styleUrl: './subscription.component.scss',
})
export class SubscriptionComponent implements OnInit {
  private readonly http = inject(HttpClient);
  auth = inject(AuthService);

  plans = signal<SubscriptionPlan[]>([]);
  currentSub = signal<UserSubscription | null>(null);
  loading = signal(true);

  ngOnInit() {
    this.http.get<{ data: { plans: SubscriptionPlan[] } }>('/api/subscriptions/plans').subscribe({
      next: (res) => { this.plans.set(res.data.plans); this.loading.set(false); },
      error: () => this.loading.set(false),
    });

    this.http.get<{ data: { subscription: UserSubscription } }>('/api/subscriptions/current').subscribe({
      next: (res) => this.currentSub.set(res.data.subscription),
      error: () => {},
    });
  }

  isCurrentPlan(plan: SubscriptionPlan): boolean {
    return this.currentSub()?.plan?.id === plan.id;
  }

  formatLimit(val: number): string {
    return val === -1 ? 'Unlimited' : String(val);
  }
}
