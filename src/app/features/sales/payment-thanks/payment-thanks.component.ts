import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * Where Stripe Checkout returns the customer (public, no login). It never
 * claims a payment succeeded — Leadzaro only records payments from
 * Stripe's verified webhook.
 */
@Component({
  selector: 'app-payment-thanks',
  standalone: true,
  template: `
    <main class="thanks">
      <div class="box">
        @if (cancelled) {
          <h1>Payment not completed</h1>
          <p>No payment was taken. If you meant to pay, use the link you were sent again, or reply to your contact at The Website Guys.</p>
        } @else {
          <h1>Thank you</h1>
          <p>Your payment is being confirmed by our payment provider. You’ll receive a receipt by email, and we’ll be in touch about next steps.</p>
        }
        <p class="brand">The Website Guys</p>
      </div>
    </main>
  `,
  styles: [`
    .thanks { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #0A0F1E; }
    .box { max-width: 460px; background: #fff; border-radius: 16px; padding: 36px 32px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,.3); }
    h1 { font-family: var(--font-display); margin: 0 0 10px; font-size: 1.6rem; }
    p { color: #475569; line-height: 1.6; margin: 0; }
    .brand { margin-top: 22px; font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: #6366F1; font-weight: 700; }
  `],
})
export class PaymentThanksComponent {
  readonly cancelled = inject(ActivatedRoute).snapshot.queryParamMap.get('cancelled') === '1';
}
