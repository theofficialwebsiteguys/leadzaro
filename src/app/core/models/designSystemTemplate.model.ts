import { LibraryStatus } from './sectionDefinition.model';

export interface DesignSystemTemplate {
  id: string;
  agencyOrganizationId: string | null;
  name: string;
  tokens: Record<string, unknown>;
  isLibraryTemplate: boolean;
  status: LibraryStatus;
}
