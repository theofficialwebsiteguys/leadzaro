export interface SectionSettingSchemaEntry {
  type: string;
  editingLevel: 'basic' | 'professional' | 'advanced';
  requiresReview: boolean;
  // Only meaningful once the owning section INSTANCE is detached (see
  // WebsiteSection.state in website.model.ts) — a detached instance's
  // content is never builder-editable at all, and its settings only for
  // keys the component opts into with this flag (current-phase-plan.md § 2d).
  builderEditable?: boolean;
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
