import {
  Component, Input, OnChanges, signal,
} from '@angular/core';
import { WebsitePage, WebsiteSchema, WebsiteSection } from '../../../core/models/website.model';
import { SectionDefinition } from '../../../core/models/sectionDefinition.model';

/**
 * The major gate's "renderer" half (current-phase-plan.md § 5 slice 2):
 * a preview must render correctly from a given schema alone, with no
 * hidden state. This is deliberately a generic structural preview, not
 * a pixel-perfect application of the website's own DesignSystem tokens
 * or real Angular component output — that level of fidelity is Phase
 * 6's concern (real code generation). What this proves is that the
 * schema itself carries everything needed to reconstruct a page: which
 * pages exist, which sections are on each, and each section's own
 * content — nothing the renderer needs is missing from the schema.
 */
@Component({
  selector: 'app-website-preview',
  standalone: true,
  templateUrl: './website-preview.component.html',
  styleUrl: './website-preview.component.scss',
})
export class WebsitePreviewComponent implements OnChanges {
  @Input({ required: true }) schema!: WebsiteSchema;
  @Input({ required: true }) sectionDefinitions: SectionDefinition[] = [];

  selectedRoute = signal<string | null>(null);

  ngOnChanges() {
    const pages = this.schema?.pages || [];
    if (!pages.some((p) => p.route === this.selectedRoute())) {
      this.selectedRoute.set(pages[0]?.route ?? null);
    }
  }

  get pages(): WebsitePage[] {
    return this.schema?.pages || [];
  }

  get selectedPage(): WebsitePage | null {
    return this.pages.find((p) => p.route === this.selectedRoute()) ?? null;
  }

  selectPage(route: string) {
    this.selectedRoute.set(route);
  }

  definitionFor(section: WebsiteSection): SectionDefinition | null {
    return this.sectionDefinitions.find((d) => d.componentKey === section.componentKey) ?? null;
  }

  contentValues(section: WebsiteSection): Array<{ key: string; value: unknown }> {
    const content = section.content || {};
    return Object.keys(content).map((key) => ({ key, value: content[key] }));
  }
}
