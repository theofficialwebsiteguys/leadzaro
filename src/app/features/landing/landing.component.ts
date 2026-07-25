import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  pillars = [
    { icon: 'target',    label: 'Qualify',  desc: 'Find the right prospects with smart filters across location, category, and website status.' },
    { icon: 'funnel',    label: 'Nurture',  desc: 'Automate follow-ups with built-in CRM statuses, notes, and next-action reminders.' },
    { icon: 'outreach',  label: 'Outreach', desc: 'Log every call, email, and visit. Keep a full activity timeline on every lead you work.' },
    { icon: 'chart-bar', label: 'Convert',  desc: 'Track pipeline health with real-time stats on contacted leads, follow-ups, and closed deals.' },
  ];

  features = [
    { icon: 'search',       title: 'Smart Lead Discovery',  desc: 'Search Google Maps by keyword and location. Filter by website status, rating, and category to find exactly who needs your service.' },
    { icon: 'leads',        title: 'Built-in CRM',          desc: 'Save leads, track pipeline status, add notes, and set follow-up dates — all in one focused workspace designed for speed.' },
    { icon: 'dashboard',    title: 'Type-Based Dashboard',  desc: 'Your dashboard adapts to what you sell. Website developer? See no-website leads first. Roofer? Filter by service area automatically.' },
    { icon: 'phone',        title: 'Outreach Logging',      desc: 'Log every call, email, or visit. Know exactly where every prospect stands in your pipeline with a full activity history.' },
    { icon: 'zap',          title: 'Fast & Focused',        desc: 'Built for salespeople who move fast. No bloat, no unnecessary features — just the tools you need to find leads and close deals.' },
    { icon: 'check-circle', title: 'Secure & Private',      desc: 'Your leads are yours. JWT authentication, encrypted passwords, and zero data sharing with third parties.' },
  ];

  plans = [
    {
      name: 'Free Trial', price: '$0', period: '/14 days',
      desc: 'Start with no commitment',
      features: ['10 searches per month', '25 saved leads', 'Basic CRM', 'Email support'],
      cta: 'Start Free', highlight: false, route: '/register',
    },
    {
      name: 'Starter', price: '$29', period: '/month',
      desc: 'For solo sales reps',
      features: ['100 searches per month', '200 saved leads', 'Full CRM + notes', 'Outreach logging', 'Priority support'],
      cta: 'Get Started', highlight: false, route: '/register',
    },
    {
      name: 'Pro', price: '$79', period: '/month',
      desc: 'For serious closers',
      features: ['500 searches per month', '2,000 saved leads', 'Export to CSV', 'Advanced filters', 'Analytics dashboard'],
      cta: 'Go Pro', highlight: true, route: '/register',
    },
    {
      name: 'Agency', price: '$199', period: '/month',
      desc: 'Scale your whole team',
      features: ['Unlimited searches', 'Unlimited leads', 'Up to 5 team members', 'API access', 'Dedicated support'],
      cta: 'Contact Sales', highlight: false, route: '/register',
    },
  ];

  previewKpis = [
    { label: 'Total Leads', value: '12,842', trend: '18.6%' },
    { label: 'New Leads',   value: '1,429',  trend: '12.4%' },
    { label: 'Reply Rate',  value: '24.7%',  trend: '6.3%'  },
    { label: 'Meetings',    value: '386',    trend: '14.2%' },
  ];
}
