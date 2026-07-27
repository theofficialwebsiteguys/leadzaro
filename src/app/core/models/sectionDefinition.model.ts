export interface SectionSettingSchemaEntry {
  type: string;
  editingLevel: 'basic' | 'professional' | 'advanced';
  requiresReview: boolean;
}

export type LibraryStatus = 'draft' | 'published' | 'deprecated';

// Type-level states only — 'detached' is per section INSTANCE, not per
// SectionDefinition (see WebsiteSection.state in website.model.ts and
// current-phase-plan.md § 2c).
export type ComponentTypeState = 'managed' | 'extended' | 'registered_custom';

export interface SectionDefinition {
  id: string;
  agencyOrganizationId: string | null;
  name: string;
  componentKey: string;
  category: string;
  settingsSchema: Record<string, SectionSettingSchemaEntry>;
  variants: string[];
  state: ComponentTypeState;
  previewImageUrl: string | null;
  isSystemDefined: boolean;
  status: LibraryStatus;
}
