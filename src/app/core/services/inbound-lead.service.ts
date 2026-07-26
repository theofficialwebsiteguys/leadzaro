import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { InboundLeadSubmission } from '../models/inbound.model';

@Injectable({ providedIn: 'root' })
export class InboundLeadService {
  private http = inject(HttpClient);

  /** Reads utm_* params from the current URL and the document referrer. */
  captureAttribution(): Pick<InboundLeadSubmission, 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmTerm' | 'utmContent' | 'referrer'> {
    const params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get('utm_source') || undefined,
      utmMedium: params.get('utm_medium') || undefined,
      utmCampaign: params.get('utm_campaign') || undefined,
      utmTerm: params.get('utm_term') || undefined,
      utmContent: params.get('utm_content') || undefined,
      referrer: document.referrer || undefined,
    };
  }

  submit(payload: InboundLeadSubmission): Observable<{ data: { submitted: boolean } }> {
    return this.http.post<{ data: { submitted: boolean } }>('/api/v1/public/inbound-leads', payload);
  }
}
