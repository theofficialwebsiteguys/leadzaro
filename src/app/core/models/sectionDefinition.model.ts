export interface SectionSettingSchemaEntry {
  type: string;
  editingLevel: 'basic' | 'professional' | 'advanced';
  requiresReview: boolean;
}

export type LibraryStatus = 'draft' | 'published' | 'deprecated';

export interface SectionDefinition {
  id: string;
  agencyOrganizationId: string | null;
  name: string;
  componentKey: string;
  category: string;
  settingsSchema: Record<string, SectionSettingSchemaEntry>;
  variants: string[];
  state: 'managed' | 'extended' | 'registered_custom' | 'detached';
  previewImageUrl: string | null;
  isSystemDefined: boolean;
  status: LibraryStatus;
}
