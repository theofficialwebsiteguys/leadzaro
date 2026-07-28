import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { ProjectService } from '../../core/services/project.service';
import { TaskService } from '../../core/services/task.service';
import { MessagingService } from '../../core/services/messaging.service';
import { RequestService } from '../../core/services/request.service';
import { MeetingService } from '../../core/services/meeting.service';
import { FileUploadService } from '../../core/services/file.service';
import { CancellationService } from '../../core/services/cancellation.service';
import { WebsiteService } from '../../core/services/website.service';
import { SeoService } from '../../core/services/seo.service';
import { SectionDefinitionService } from '../../core/services/sectionDefinition.service';
import { DesignSystemTemplateService } from '../../core/services/designSystemTemplate.service';
import { WebsitePreviewComponent } from './website-preview/website-preview.component';
import { MembershipService } from '../../core/services/membership.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import {
  Project, ProjectAssignment, ProjectFinancials, ProjectDashboard, PROJECT_STAGES, PROJECT_ROLE_SLOTS,
} from '../../core/models/project.model';
import { Task, TASK_STATUSES, TASK_PRIORITIES } from '../../core/models/task.model';
import { ProjectChannel, Message } from '../../core/models/message.model';
import { ClientRequest, REQUEST_CATEGORIES } from '../../core/models/clientRequest.model';
import { Meeting } from '../../core/models/meeting.model';
import { ProjectFile, FILE_SCOPES } from '../../core/models/file.model';
import { CancellationRequest } from '../../core/models/cancellationRequest.model';
import {
  Website, WebsiteVersion, WebsiteEditorAssignment, WebsiteComment, WebsitePresenceEntry, WebsiteRepository, WebsiteDeployment, WebsiteDevelopmentHandoff,
  WebsiteDomain, WebsitePublicFormSubmission, WebsiteAnalyticsSummaryRow, WebsiteExportBundle,
} from '../../core/models/website.model';
import { SectionDefinition } from '../../core/models/sectionDefinition.model';
import { DesignSystemTemplate } from '../../core/models/designSystemTemplate.model';
import { Member } from '../../core/models/organization.model';
import {
  SeoPageListEntry, WebsiteRedirect, WebsiteSeoAudit, SeoTaskCycle, SeoDashboard, WebsitePageSeoSettings,
} from '../../core/models/seo.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, DatePipe, JsonPipe, HasPermissionDirective, WebsitePreviewComponent],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss',
})
export class ProjectsComponent implements OnInit, OnDestroy {
  private readonly projectService = inject(ProjectService);
  private readonly taskService = inject(TaskService);
  private readonly messagingService = inject(MessagingService);
  private readonly requestService = inject(RequestService);
  private readonly meetingService = inject(MeetingService);
  private readonly fileService = inject(FileUploadService);
  private readonly cancellationService = inject(CancellationService);
  private readonly websiteService = inject(WebsiteService);
  private readonly seoService = inject(SeoService);
  private readonly sectionDefinitionService = inject(SectionDefinitionService);
  private readonly designSystemTemplateService = inject(DesignSystemTemplateService);
  private readonly membershipService = inject(MembershipService);
  readonly org = inject(OrganizationContextService);

  readonly stages = PROJECT_STAGES;
  readonly roleSlots = PROJECT_ROLE_SLOTS;
  readonly taskStatuses = TASK_STATUSES;
  readonly taskPriorities = TASK_PRIORITIES;
  readonly requestCategories = REQUEST_CATEGORIES;
  readonly fileScopes = FILE_SCOPES;

  tasks = signal<Task[]>([]);
  taskView = signal<'list' | 'board'>('list');
  tasksByStatus = computed(() => {
    const groups: Record<string, Task[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of this.tasks()) groups[t.status]?.push(t);
    return groups;
  });
  newTaskTitle = '';
  newTaskAssigneeUserId = '';
  newTaskIsClientVisible = false;

  channels = signal<ProjectChannel[]>([]);
  selectedChannelId = signal<string | null>(null);
  messages = signal<Message[]>([]);
  newMessageBody = '';

  clientRequests = signal<ClientRequest[]>([]);
  newRequestCategory = '';
  newRequestDescription = '';

  meetings = signal<Meeting[]>([]);
  newMeetingSubject = '';
  newMeetingSlotStart = '';
  newMeetingSlotEnd = '';

  files = signal<ProjectFile[]>([]);
  newFileScope: string = 'project';
  newFileIsPrivate = true;
  selectedFile: File | null = null;

  cancellationRequests = signal<CancellationRequest[]>([]);
  pendingCancellationRequest = computed(() => this.cancellationRequests().find((c) => c.status === 'requested') ?? null);
  newCancellationReason = '';

  website = signal<Website | null>(null);
  websiteLoaded = signal(false);
  websiteVersions = signal<WebsiteVersion[]>([]);
  newWebsiteName = '';
  newWebsiteStartingMode = 'blank';
  newWebsiteDesignSystemTemplateId = '';
  newWebsiteGuidedComponentKeys = new Set<string>();
  designSystemTemplates = signal<DesignSystemTemplate[]>([]);
  draftSchemaText = '';
  draftSchemaError = '';
  newCheckpointLabel = '';
  showPreview = signal(false);
  sectionDefinitions = signal<SectionDefinition[]>([]);
  websiteEditors = signal<WebsiteEditorAssignment[]>([]);
  newEditorUserId = '';
  newEditorLevel = 'basic';
  private autosaveIntervalId: ReturnType<typeof setInterval> | null = null;
  lastAutosavedAt = signal<Date | null>(null);
  compareFromVersionId = '';
  compareToVersionId = '';
  compareResult = signal<{ structuralChange: boolean; changes: Array<{ key: string; editingLevel: string; requiresReview: boolean }> } | null>(null);
  testFormPageId = 'page_home';
  testFormSectionId = '';
  testFormValuesText = '{}';
  testFormResult = signal<string | null>(null);
  websiteComments = signal<WebsiteComment[]>([]);
  newCommentAnchorKey = '';
  newCommentBody = '';
  newCommentIsInternal = false;
  websitePresence = signal<WebsitePresenceEntry[]>([]);
  private presenceIntervalId: ReturnType<typeof setInterval> | null = null;
  websiteRepository = signal<WebsiteRepository | null>(null);
  provisioningRepository = signal(false);
  websiteDeployments = signal<WebsiteDeployment[]>([]);
  websiteDevelopmentHandoffs = signal<WebsiteDevelopmentHandoff[]>([]);
  newHandoffNotes = '';
  mergeBackBranchName = '';
  mergeBackTitle = '';

  // Phase 7 — Production Website Operations
  websiteDomain = signal<WebsiteDomain | null>(null);
  newDomainName = '';
  newDomainYears = 1;
  domainAvailability = signal<{ domain: string; available: boolean } | null>(null);
  newDocumentRootPath = '';
  productionDeployments = signal<WebsiteDeployment[]>([]);
  currentLiveDeployment = signal<WebsiteDeployment | null>(null);
  deployingToProduction = signal(false);
  publicFormSubmissions = signal<WebsitePublicFormSubmission[]>([]);
  analyticsSummary = signal<WebsiteAnalyticsSummaryRow[]>([]);
  newGoogleAnalyticsMeasurementId = '';
  exportedBundle = signal<WebsiteExportBundle | null>(null);
  exportingWebsite = signal(false);

  // Phase 8 — Premium SEO and Advanced Services
  seoDashboard = signal<SeoDashboard | null>(null);
  seoPages = signal<SeoPageListEntry[]>([]);
  seoPageEdits: Record<string, { metaTitle: string; metaDescription: string; robotsDirective: WebsitePageSeoSettings['robotsDirective'] }> = {};
  seoRedirects = signal<WebsiteRedirect[]>([]);
  newRedirectFromPath = '';
  newRedirectToPath = '';
  seoAudits = signal<WebsiteSeoAudit[]>([]);
  runningSeoAudit = signal(false);
  seoTaskCycles = signal<SeoTaskCycle[]>([]);
  newSearchConsolePropertyUrl = '';
  seoEntitlementReason = '';

  projects = signal<Project[]>([]);
  loading = signal(true);
  selectedId = signal<string | null>(null);
  selected = signal<Project | null>(null);
  dashboard = signal<ProjectDashboard | null>(null);

  members = signal<Member[]>([]);

  assignments = signal<ProjectAssignment[]>([]);
  newAssignmentUserId = '';
  newAssignmentRoleSlot = '';

  financials = signal<ProjectFinancials | null>(null);
  financialsLoaded = signal(false);
  estimatedCostDollars = '';
  actualCostDollars = '';
  marginNotes = '';

  stageTarget = '';
  stageConfirmed = false;
  stageOverrideReason = '';
  stageChecklist = signal<string[] | null>(null);
  stageError = signal('');

  healthTarget = '';

  actionMessage = signal('');

  ngOnInit() {
    this.load();
    this.membershipService.list().subscribe((res) => {
      this.members.set(res.data.memberships.filter((m) => m.membershipType === 'employee' && m.status === 'active'));
    });
    if (this.org.hasPermission('builder.edit')) {
      this.sectionDefinitionService.list().subscribe((res) => this.sectionDefinitions.set(res.data.sectionDefinitions));
      // Empty for a client membership (current-phase-plan.md § 2a — a
      // library template is employee-only, never a client-visible
      // browsing list) — the 'template' starting mode option below is
      // hidden accordingly rather than shown and then rejected.
      this.designSystemTemplateService.list().subscribe((res) => this.designSystemTemplates.set(res.data.designSystemTemplates));
      // A lightweight recovery safety net (current-phase-plan.md § 2c) —
      // silently snapshots the current draft every 30s while a website
      // is loaded; the server prunes old autosave rows automatically.
      this.autosaveIntervalId = setInterval(() => {
        const id = this.selectedId();
        if (!id || !this.website()) return;
        this.websiteService.createAutosave(id).subscribe(() => this.lastAutosavedAt.set(new Date()));
      }, 30000);
      // A presence heartbeat (current-phase-plan.md § 2i) — lets
      // everyone else viewing this website's Recent Activity see who
      // else is currently here. Short-TTL: a stale row (tab closed,
      // heartbeat stopped) simply drops out of the list on its own.
      this.presenceIntervalId = setInterval(() => {
        const id = this.selectedId();
        if (!id || !this.website()) return;
        this.websiteService.heartbeatPresence(id).subscribe(() => this.loadWebsitePresence(id));
      }, 20000);
    }
  }

  ngOnDestroy() {
    if (this.autosaveIntervalId) clearInterval(this.autosaveIntervalId);
    if (this.presenceIntervalId) clearInterval(this.presenceIntervalId);
  }

  load() {
    this.loading.set(true);
    this.projectService.list().subscribe((res) => {
      this.projects.set(res.data.projects);
      this.loading.set(false);
      if (res.data.projects.length > 0 && !this.selectedId()) {
        this.select(res.data.projects[0].id);
      }
    });
  }

  select(id: string) {
    this.selectedId.set(id);
    this.stageChecklist.set(null);
    this.stageError.set('');
    this.financialsLoaded.set(false);
    this.dashboard.set(null);
    this.website.set(null);
    this.websiteLoaded.set(false);
    this.websiteVersions.set([]);
    this.websiteEditors.set([]);
    this.compareResult.set(null);
    this.testFormResult.set(null);
    this.websiteComments.set([]);
    this.websitePresence.set([]);
    this.websiteRepository.set(null);
    this.websiteDeployments.set([]);
    this.websiteDevelopmentHandoffs.set([]);
    this.websiteDomain.set(null);
    this.domainAvailability.set(null);
    this.productionDeployments.set([]);
    this.currentLiveDeployment.set(null);
    this.publicFormSubmissions.set([]);
    this.analyticsSummary.set([]);
    this.exportedBundle.set(null);
    this.seoDashboard.set(null);
    this.seoPages.set([]);
    this.seoPageEdits = {};
    this.seoRedirects.set([]);
    this.seoAudits.set([]);
    this.seoTaskCycles.set([]);
    this.projectService.getById(id).subscribe((res) => {
      this.selected.set(res.data.project);
      this.stageTarget = res.data.project.stage;
      this.healthTarget = res.data.project.healthStatus;
    });
    this.projectService.getDashboard(id).subscribe((res) => this.dashboard.set(res.data.dashboard));
    this.projectService.listAssignments(id).subscribe((res) => this.assignments.set(res.data.assignments));
    this.loadTasks(id);
    this.loadChannels(id);
    this.loadRequests(id);
    this.loadMeetings(id);
    this.loadFiles(id);
    this.loadCancellationRequests(id);
    this.loadWebsite(id);
    if (this.org.hasPermission('projects.manage')) {
      this.projectService.getFinancials(id).subscribe((res) => {
        this.financials.set(res.data.financials);
        this.financialsLoaded.set(true);
        if (res.data.financials) {
          this.estimatedCostDollars = res.data.financials.estimatedCostCents != null ? (res.data.financials.estimatedCostCents / 100).toFixed(2) : '';
          this.actualCostDollars = res.data.financials.actualCostCents != null ? (res.data.financials.actualCostCents / 100).toFixed(2) : '';
          this.marginNotes = res.data.financials.marginNotes || '';
        }
      });
    }
  }

  submitStageChange() {
    const id = this.selectedId();
    if (!id) return;
    this.stageError.set('');
    this.projectService.changeStage(id, this.stageTarget, { confirmed: this.stageConfirmed, overrideReason: this.stageOverrideReason || undefined }).subscribe({
      next: (res) => {
        this.selected.set(res.data.project);
        this.stageChecklist.set(null);
        this.stageConfirmed = false;
        this.stageOverrideReason = '';
        this.actionMessage.set('Stage updated');
        this.load();
      },
      error: (err) => {
        if (err.status === 422 && err.error?.details?.checklist) {
          this.stageChecklist.set(err.error.details.checklist);
        } else {
          this.stageError.set(err.error?.message || 'Failed to update stage');
        }
      },
    });
  }

  submitHealthChange() {
    const id = this.selectedId();
    if (!id) return;
    this.projectService.updateHealthStatus(id, this.healthTarget).subscribe((res) => {
      this.selected.set(res.data.project);
      this.actionMessage.set('Health status updated');
    });
  }

  addAssignment() {
    const id = this.selectedId();
    if (!id || !this.newAssignmentUserId || !this.newAssignmentRoleSlot) return;
    this.projectService.addAssignment(id, this.newAssignmentUserId, this.newAssignmentRoleSlot).subscribe(() => {
      this.newAssignmentUserId = '';
      this.newAssignmentRoleSlot = '';
      this.projectService.listAssignments(id).subscribe((res) => this.assignments.set(res.data.assignments));
    });
  }

  removeAssignment(assignmentId: string) {
    const id = this.selectedId();
    if (!id) return;
    this.projectService.removeAssignment(id, assignmentId).subscribe(() => {
      this.assignments.update((list) => list.filter((a) => a.id !== assignmentId));
    });
  }

  loadTasks(projectId: string) {
    this.taskService.list(projectId).subscribe((res) => this.tasks.set(res.data.tasks));
  }

  createTask() {
    const id = this.selectedId();
    if (!id || !this.newTaskTitle.trim()) return;
    this.taskService.create(id, {
      title: this.newTaskTitle,
      assigneeUserId: this.newTaskAssigneeUserId || undefined,
      isClientVisible: this.newTaskIsClientVisible,
    }).subscribe(() => {
      this.newTaskTitle = '';
      this.newTaskAssigneeUserId = '';
      this.newTaskIsClientVisible = false;
      this.loadTasks(id);
    });
  }

  updateTaskStatus(task: Task, status: string) {
    const id = this.selectedId();
    if (!id) return;
    this.taskService.update(id, task.id, { status: status as Task['status'] }).subscribe(() => this.loadTasks(id));
  }

  archiveTask(task: Task) {
    const id = this.selectedId();
    if (!id) return;
    this.taskService.archive(id, task.id).subscribe(() => this.loadTasks(id));
  }

  loadChannels(projectId: string) {
    this.messagingService.listChannels(projectId).subscribe((res) => {
      this.channels.set(res.data.channels);
      if (res.data.channels.length > 0) {
        const current = this.selectedChannelId();
        const stillExists = current && res.data.channels.some((c) => c.id === current);
        this.selectChannel(stillExists ? current! : res.data.channels[0].id);
      }
    });
  }

  selectChannel(channelId: string) {
    this.selectedChannelId.set(channelId);
    const id = this.selectedId();
    if (!id) return;
    this.messagingService.listMessages(id, channelId).subscribe((res) => this.messages.set(res.data.messages));
  }

  postMessage() {
    const projectId = this.selectedId();
    const channelId = this.selectedChannelId();
    if (!projectId || !channelId || !this.newMessageBody.trim()) return;
    this.messagingService.postMessage(projectId, channelId, this.newMessageBody).subscribe(() => {
      this.newMessageBody = '';
      this.messagingService.listMessages(projectId, channelId).subscribe((res) => this.messages.set(res.data.messages));
    });
  }

  convertMessageToTask(messageId: string) {
    const projectId = this.selectedId();
    const channelId = this.selectedChannelId();
    if (!projectId || !channelId) return;
    this.messagingService.convertToTask(projectId, channelId, messageId).subscribe(() => {
      this.loadTasks(projectId);
      this.actionMessage.set('Message converted to a task');
    });
  }

  loadRequests(projectId: string) {
    this.requestService.list(projectId).subscribe((res) => this.clientRequests.set(res.data.requests));
  }

  submitRequest() {
    const id = this.selectedId();
    if (!id || !this.newRequestCategory || !this.newRequestDescription.trim()) return;
    this.requestService.create(id, this.newRequestCategory, this.newRequestDescription).subscribe(() => {
      this.newRequestCategory = '';
      this.newRequestDescription = '';
      this.loadRequests(id);
    });
  }

  updateRequestStatus(req: ClientRequest, status: string) {
    const id = this.selectedId();
    if (!id) return;
    this.requestService.updateStatus(id, req.id, status).subscribe(() => this.loadRequests(id));
  }

  loadMeetings(projectId: string) {
    this.meetingService.list(projectId).subscribe((res) => this.meetings.set(res.data.meetings));
  }

  requestMeeting() {
    const id = this.selectedId();
    if (!id || !this.newMeetingSubject.trim() || !this.newMeetingSlotStart || !this.newMeetingSlotEnd) return;
    this.meetingService.request(id, this.newMeetingSubject, [{ start: this.newMeetingSlotStart, end: this.newMeetingSlotEnd }]).subscribe(() => {
      this.newMeetingSubject = '';
      this.newMeetingSlotStart = '';
      this.newMeetingSlotEnd = '';
      this.loadMeetings(id);
    });
  }

  confirmMeeting(meeting: Meeting) {
    const id = this.selectedId();
    if (!id || meeting.proposedSlots.length === 0) return;
    this.meetingService.confirm(id, meeting.id, meeting.proposedSlots[0]).subscribe(() => this.loadMeetings(id));
  }

  declineMeeting(meeting: Meeting) {
    const id = this.selectedId();
    if (!id) return;
    this.meetingService.decline(id, meeting.id).subscribe(() => this.loadMeetings(id));
  }

  cancelMeeting(meeting: Meeting) {
    const id = this.selectedId();
    if (!id) return;
    this.meetingService.cancel(id, meeting.id).subscribe(() => this.loadMeetings(id));
  }

  loadFiles(projectId: string) {
    this.fileService.list(projectId).subscribe((res) => this.files.set(res.data.files));
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  websiteAssets = computed(() => this.files().filter((f) => f.scope === 'website_asset' && f.relatedId === this.website()?.id));
  newWebsiteAssetFile: File | null = null;

  onWebsiteAssetSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.newWebsiteAssetFile = input.files?.[0] ?? null;
  }

  uploadWebsiteAsset() {
    const id = this.selectedId();
    const site = this.website();
    if (!id || !site || !this.newWebsiteAssetFile) return;
    this.fileService.upload(id, this.newWebsiteAssetFile, 'website_asset', false, site.id).subscribe(() => {
      this.newWebsiteAssetFile = null;
      this.loadFiles(id);
      this.actionMessage.set('Asset uploaded');
    });
  }

  openWebsiteAsset(file: ProjectFile, variant?: string) {
    const id = this.selectedId();
    if (!id) return;
    this.fileService.getSignedUrl(id, file.id, variant).subscribe((res) => window.open(res.data.url, '_blank'));
  }

  uploadFile() {
    const id = this.selectedId();
    if (!id || !this.selectedFile) return;
    this.fileService.upload(id, this.selectedFile, this.newFileScope, this.newFileIsPrivate).subscribe(() => {
      this.selectedFile = null;
      this.loadFiles(id);
      this.actionMessage.set('File uploaded');
    });
  }

  openFile(file: ProjectFile) {
    const id = this.selectedId();
    if (!id) return;
    this.fileService.getSignedUrl(id, file.id).subscribe((res) => window.open(res.data.url, '_blank'));
  }

  deleteFile(file: ProjectFile) {
    const id = this.selectedId();
    if (!id) return;
    this.fileService.delete(id, file.id).subscribe(() => this.loadFiles(id));
  }

  loadCancellationRequests(projectId: string) {
    this.cancellationService.list(projectId).subscribe((res) => this.cancellationRequests.set(res.data.cancellationRequests));
  }

  requestCancellation() {
    const id = this.selectedId();
    if (!id) return;
    this.cancellationService.create(id, this.newCancellationReason).subscribe(() => {
      this.newCancellationReason = '';
      this.loadCancellationRequests(id);
      this.actionMessage.set('Cancellation requested');
    });
  }

  confirmCancellation(cancellationRequest: CancellationRequest) {
    const id = this.selectedId();
    if (!id) return;
    this.cancellationService.confirm(id, cancellationRequest.id).subscribe(() => {
      this.loadCancellationRequests(id);
      this.actionMessage.set('Cancellation confirmed');
    });
  }

  withdrawCancellation(cancellationRequest: CancellationRequest) {
    const id = this.selectedId();
    if (!id) return;
    this.cancellationService.withdraw(id, cancellationRequest.id).subscribe(() => {
      this.loadCancellationRequests(id);
      this.actionMessage.set('Cancellation withdrawn');
    });
  }

  saveFinancials() {
    const id = this.selectedId();
    if (!id) return;
    const estimatedCostCents = this.estimatedCostDollars ? Math.round(Number.parseFloat(this.estimatedCostDollars) * 100) : undefined;
    const actualCostCents = this.actualCostDollars ? Math.round(Number.parseFloat(this.actualCostDollars) * 100) : undefined;
    this.projectService.updateFinancials(id, { estimatedCostCents, actualCostCents, marginNotes: this.marginNotes }).subscribe((res) => {
      this.financials.set(res.data.financials);
      this.actionMessage.set('Financials updated');
    });
  }

  loadWebsite(projectId: string) {
    this.websiteService.get(projectId).subscribe({
      next: (res) => {
        this.website.set(res.data.website);
        this.draftSchemaText = JSON.stringify(res.data.website.draftSchema, null, 2);
        this.websiteLoaded.set(true);
        this.loadWebsiteVersions(projectId);
        this.loadWebsiteComments(projectId);
        this.loadWebsitePresence(projectId);
        if (this.org.hasPermission('builder.develop')) {
          this.loadWebsiteRepository(projectId);
          this.loadWebsiteDeployments(projectId);
          this.loadWebsiteDevelopmentHandoffs(projectId);
        }
        if (this.org.hasPermission('builder.edit')) {
          this.websiteService.heartbeatPresence(projectId).subscribe(() => this.loadWebsitePresence(projectId));
        }
        if (this.org.hasPermission('builder.manage')) {
          this.loadWebsiteEditors(projectId);
          this.loadWebsiteDomain(projectId);
          this.loadProductionDeployments(projectId);
          this.loadCurrentLiveDeployment(projectId);
          this.loadPublicFormSubmissions(projectId);
          this.loadAnalyticsSummary(projectId);
        }
        if (this.org.hasPermission('projects.view')) {
          this.loadSeoDashboard(projectId);
        }
      },
      error: () => {
        this.website.set(null);
        this.websiteLoaded.set(true);
      },
    });
  }

  loadWebsiteVersions(projectId: string) {
    this.websiteService.listVersions(projectId).subscribe((res) => this.websiteVersions.set(res.data.versions));
  }

  toggleGuidedComponentKey(componentKey: string) {
    if (this.newWebsiteGuidedComponentKeys.has(componentKey)) this.newWebsiteGuidedComponentKeys.delete(componentKey);
    else this.newWebsiteGuidedComponentKeys.add(componentKey);
  }

  createWebsite() {
    const id = this.selectedId();
    if (!id || !this.newWebsiteName.trim()) return;

    const options: { designSystemTemplateId?: string; sectionComponentKeys?: string[] } = {};
    if (this.newWebsiteStartingMode === 'template') {
      if (!this.newWebsiteDesignSystemTemplateId) {
        this.actionMessage.set('Choose a design system template first');
        return;
      }
      options.designSystemTemplateId = this.newWebsiteDesignSystemTemplateId;
    }
    if (this.newWebsiteStartingMode === 'guided') {
      if (this.newWebsiteGuidedComponentKeys.size === 0) {
        this.actionMessage.set('Choose at least one section first');
        return;
      }
      options.sectionComponentKeys = Array.from(this.newWebsiteGuidedComponentKeys);
    }

    this.websiteService.create(id, this.newWebsiteName, this.newWebsiteStartingMode, options).subscribe({
      next: () => {
        this.newWebsiteName = '';
        this.newWebsiteStartingMode = 'blank';
        this.newWebsiteDesignSystemTemplateId = '';
        this.newWebsiteGuidedComponentKeys.clear();
        this.loadWebsite(id);
        this.actionMessage.set('Website created');
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to create website'),
    });
  }

  saveDraftSchema() {
    const id = this.selectedId();
    if (!id) return;
    this.draftSchemaError = '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.draftSchemaText);
    } catch {
      this.draftSchemaError = 'Invalid JSON';
      return;
    }
    this.websiteService.saveDraft(id, parsed).subscribe({
      next: (res) => {
        this.website.set(res.data.website);
        this.actionMessage.set('Draft saved');
      },
      error: (err) => {
        this.draftSchemaError = err.error?.message || 'Failed to save draft';
      },
    });
  }

  createCheckpoint() {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.createCheckpoint(id, this.newCheckpointLabel).subscribe(() => {
      this.newCheckpointLabel = '';
      this.loadWebsiteVersions(id);
      this.actionMessage.set('Checkpoint created');
    });
  }

  restoreVersion(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.restoreVersion(id, version.id).subscribe({
      next: (res) => {
        this.website.set(res.data.website);
        this.draftSchemaText = JSON.stringify(res.data.website.draftSchema, null, 2);
        this.loadWebsiteVersions(id);
        this.actionMessage.set(res.message || 'Version restored');
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to restore version');
      },
    });
  }

  publishVersion(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.publishVersion(id, version.id).subscribe({
      next: () => {
        this.loadWebsiteVersions(id);
        this.actionMessage.set('Version published');
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to publish version');
      },
    });
  }

  compareVersions() {
    const id = this.selectedId();
    if (!id || !this.compareFromVersionId || !this.compareToVersionId) return;
    this.compareResult.set(null);
    this.websiteService.compareVersions(id, this.compareFromVersionId, this.compareToVersionId).subscribe({
      next: (res) => this.compareResult.set(res.data.comparison),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to compare versions'),
    });
  }

  submitTestForm() {
    const id = this.selectedId();
    if (!id || !this.testFormSectionId.trim()) return;
    this.testFormResult.set(null);
    let values: unknown;
    try {
      values = JSON.parse(this.testFormValuesText);
    } catch {
      this.testFormResult.set('Invalid JSON in values');
      return;
    }
    this.websiteService.submitTestForm(id, this.testFormPageId, this.testFormSectionId, values).subscribe({
      next: (res) => this.testFormResult.set(`Created client request (category: ${res.data.clientRequest.category})`),
      error: (err) => this.testFormResult.set(err.error?.message || 'Test submission failed'),
    });
  }

  loadWebsiteComments(projectId: string) {
    this.websiteService.listComments(projectId).subscribe((res) => this.websiteComments.set(res.data.comments));
  }

  addWebsiteComment() {
    const id = this.selectedId();
    if (!id || !this.newCommentAnchorKey.trim() || !this.newCommentBody.trim()) return;
    this.websiteService.createComment(id, this.newCommentAnchorKey, this.newCommentBody, this.newCommentIsInternal).subscribe(() => {
      this.newCommentAnchorKey = '';
      this.newCommentBody = '';
      this.newCommentIsInternal = false;
      this.loadWebsiteComments(id);
    });
  }

  resolveWebsiteComment(comment: WebsiteComment) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.resolveComment(id, comment.id).subscribe(() => this.loadWebsiteComments(id));
  }

  loadWebsitePresence(projectId: string) {
    this.websiteService.listPresence(projectId).subscribe((res) => this.websitePresence.set(res.data.presence));
  }

  loadWebsiteRepository(projectId: string) {
    this.websiteService.getRepository(projectId).subscribe((res) => this.websiteRepository.set(res.data.repository));
  }

  generateWebsite(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.generateWebsite(id, version.id).subscribe({
      next: (res) => this.actionMessage.set(`Generated ${res.data.fileCount} file(s) to branch "${res.data.branch}"`),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to generate'),
    });
  }

  loadWebsiteDeployments(projectId: string) {
    this.websiteService.listDeployments(projectId).subscribe((res) => this.websiteDeployments.set(res.data.deployments));
  }

  loadWebsiteDevelopmentHandoffs(projectId: string) {
    this.websiteService.listDevelopmentHandoffs(projectId).subscribe((res) => this.websiteDevelopmentHandoffs.set(res.data.handoffs));
  }

  promoteToDevelopment(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.promoteToDevelopment(id, version.id, this.newHandoffNotes).subscribe({
      next: () => {
        this.newHandoffNotes = '';
        this.actionMessage.set('Promoted to development — a preview was deployed, a technical handoff task was created, and the assigned developers were notified.');
        this.loadWebsiteDevelopmentHandoffs(id);
        this.loadWebsiteDeployments(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to promote to development'),
    });
  }

  mergeBack() {
    const id = this.selectedId();
    if (!id || !this.mergeBackBranchName.trim()) return;
    this.websiteService.mergeBack(id, this.mergeBackBranchName, this.mergeBackTitle).subscribe({
      next: (res) => {
        this.actionMessage.set(`Merged "${res.data.branchName}" back into "${res.data.baseBranch}"`);
        this.mergeBackBranchName = '';
        this.mergeBackTitle = '';
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to merge back'),
    });
  }

  deployPreview(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.deployPreview(id, version.id).subscribe({
      next: (res) => {
        this.actionMessage.set(`Preview deployed: ${res.data.deployment.previewUrl}`);
        this.loadWebsiteDeployments(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to deploy preview'),
    });
  }

  // --- Phase 7: domain management ---

  loadWebsiteDomain(projectId: string) {
    this.websiteService.getDomain(projectId).subscribe((res) => this.websiteDomain.set(res.data.domain));
  }

  checkDomainAvailability() {
    const id = this.selectedId();
    if (!id || !this.newDomainName.trim()) return;
    this.websiteService.checkDomainAvailability(id, this.newDomainName).subscribe((res) => this.domainAvailability.set(res.data));
  }

  registerDomain() {
    const id = this.selectedId();
    if (!id || !this.newDomainName.trim()) return;
    this.websiteService.registerDomain(id, this.newDomainName, this.newDomainYears).subscribe({
      next: (res) => {
        this.websiteDomain.set(res.data.domain);
        this.domainAvailability.set(null);
        this.actionMessage.set(`Domain ${res.data.domain.domain} registered`);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to register domain'),
    });
  }

  mapDocumentRoot() {
    const id = this.selectedId();
    if (!id || !this.newDocumentRootPath.trim()) return;
    this.websiteService.mapDocumentRoot(id, this.newDocumentRootPath).subscribe({
      next: (res) => {
        this.websiteDomain.set(res.data.domain);
        this.actionMessage.set('Document root mapped');
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to map document root'),
    });
  }

  checkDomainRenewal() {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.checkDomainRenewal(id).subscribe({
      next: (res) => this.actionMessage.set(res.data.noticeSent ? 'Renewal notice sent' : `No notice sent (${res.data.reason})`),
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to check renewal'),
    });
  }

  initiateDomainTransfer() {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.initiateDomainTransfer(id).subscribe({
      next: (res) => {
        this.websiteDomain.set(res.data.domain);
        this.actionMessage.set('Domain transfer initiated');
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to initiate transfer'),
    });
  }

  // --- Phase 7: production deployment + the major gate's rollback ---

  loadProductionDeployments(projectId: string) {
    this.websiteService.listProductionDeployments(projectId).subscribe((res) => this.productionDeployments.set(res.data.deployments));
  }

  loadCurrentLiveDeployment(projectId: string) {
    this.websiteService.getCurrentLiveDeployment(projectId).subscribe((res) => this.currentLiveDeployment.set(res.data.deployment));
  }

  deployToProduction(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.deployingToProduction.set(true);
    this.websiteService.deployToProduction(id, version.id).subscribe({
      next: (res) => {
        this.actionMessage.set(res.message);
        this.deployingToProduction.set(false);
        this.loadProductionDeployments(id);
        this.loadCurrentLiveDeployment(id);
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to deploy to production');
        this.deployingToProduction.set(false);
      },
    });
  }

  // --- Phase 7: public form submission triage ---

  loadPublicFormSubmissions(projectId: string) {
    this.websiteService.listPublicFormSubmissions(projectId, 'pending_review').subscribe((res) => this.publicFormSubmissions.set(res.data.submissions));
  }

  convertPublicFormSubmission(submission: WebsitePublicFormSubmission) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.convertPublicFormSubmission(id, submission.id).subscribe({
      next: () => {
        this.actionMessage.set('Submission converted to a client request');
        this.loadPublicFormSubmissions(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to convert submission'),
    });
  }

  updatePublicFormSubmissionStatus(submission: WebsitePublicFormSubmission, status: 'discarded' | 'spam') {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.updatePublicFormSubmissionStatus(id, submission.id, status).subscribe({
      next: () => {
        this.actionMessage.set(`Submission marked ${status}`);
        this.loadPublicFormSubmissions(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to update submission'),
    });
  }

  // --- Phase 7: hybrid analytics + guided Google Analytics connection ---

  loadAnalyticsSummary(projectId: string) {
    this.websiteService.getAnalyticsSummary(projectId).subscribe((res) => this.analyticsSummary.set(res.data.summary));
  }

  setGoogleAnalyticsMeasurementId() {
    const id = this.selectedId();
    if (!id || !this.newGoogleAnalyticsMeasurementId.trim()) return;
    this.websiteService.setGoogleAnalyticsMeasurementId(id, this.newGoogleAnalyticsMeasurementId).subscribe({
      next: (res) => {
        this.website.set(res.data.website);
        this.newGoogleAnalyticsMeasurementId = '';
        this.actionMessage.set('Google Analytics connection updated');
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to connect Google Analytics'),
    });
  }

  // --- Phase 7: employee-controlled full website export ---

  exportWebsite(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.exportingWebsite.set(true);
    this.websiteService.exportWebsite(id, version.id).subscribe({
      next: (res) => {
        this.exportedBundle.set(res.data.export);
        this.exportingWebsite.set(false);
        this.actionMessage.set(`Exported ${res.data.export.files.length} file(s)`);
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to export website');
        this.exportingWebsite.set(false);
      },
    });
  }

  downloadExportedBundle() {
    const bundle = this.exportedBundle();
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${bundle.website.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-export-v${bundle.version.versionNumber}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- Phase 8: Premium SEO and Advanced Services ---

  loadSeoDashboard(projectId: string) {
    this.seoService.getDashboard(projectId).subscribe((res) => {
      this.seoDashboard.set(res.data.dashboard);
      if (res.data.dashboard.entitled && this.org.hasPermission('builder.manage')) {
        this.loadSeoPages(projectId);
        this.loadSeoRedirects(projectId);
        this.loadSeoAudits(projectId);
        this.loadSeoTaskCycles(projectId);
      }
    });
  }

  grantSeoEntitlement() {
    const project = this.selected();
    const id = this.selectedId();
    if (!id || !project || !this.seoEntitlementReason.trim()) return;
    this.seoService.grantEntitlement(project.organizationId, this.seoEntitlementReason).subscribe({
      next: () => {
        this.seoEntitlementReason = '';
        this.actionMessage.set('SEO entitlement granted');
        this.loadSeoDashboard(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to grant SEO entitlement'),
    });
  }

  loadSeoPages(projectId: string) {
    this.seoService.listPageSettings(projectId).subscribe((res) => {
      this.seoPages.set(res.data.pages);
      for (const page of res.data.pages) {
        this.seoPageEdits[page.pageId] = {
          metaTitle: page.seoSettings?.metaTitle || '',
          metaDescription: page.seoSettings?.metaDescription || '',
          robotsDirective: page.seoSettings?.robotsDirective || 'index,follow',
        };
      }
    });
  }

  saveSeoPageSettings(pageId: string) {
    const id = this.selectedId();
    const edit = this.seoPageEdits[pageId];
    if (!id || !edit) return;
    this.seoService.upsertPageSettings(id, pageId, edit).subscribe({
      next: () => {
        this.actionMessage.set('Page SEO settings saved');
        this.loadSeoPages(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to save page SEO settings'),
    });
  }

  loadSeoRedirects(projectId: string) {
    this.seoService.listRedirects(projectId).subscribe((res) => this.seoRedirects.set(res.data.redirects));
  }

  createSeoRedirect() {
    const id = this.selectedId();
    if (!id || !this.newRedirectFromPath.trim() || !this.newRedirectToPath.trim()) return;
    this.seoService.createRedirect(id, this.newRedirectFromPath, this.newRedirectToPath).subscribe({
      next: () => {
        this.newRedirectFromPath = '';
        this.newRedirectToPath = '';
        this.actionMessage.set('Redirect created');
        this.loadSeoRedirects(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to create redirect'),
    });
  }

  deleteSeoRedirect(redirect: WebsiteRedirect) {
    const id = this.selectedId();
    if (!id) return;
    this.seoService.deleteRedirect(id, redirect.id).subscribe(() => this.loadSeoRedirects(id));
  }

  loadSeoAudits(projectId: string) {
    this.seoService.listAudits(projectId).subscribe((res) => this.seoAudits.set(res.data.audits));
  }

  countSeoFindings(audit: WebsiteSeoAudit, severity: 'error' | 'warning'): number {
    return (audit.findings || []).filter((f) => f.severity === severity).length;
  }

  runSeoAudit(version: WebsiteVersion) {
    const id = this.selectedId();
    if (!id) return;
    this.runningSeoAudit.set(true);
    this.seoService.runAudit(id, version.id).subscribe({
      next: (res) => {
        this.actionMessage.set(res.message);
        this.runningSeoAudit.set(false);
        this.loadSeoAudits(id);
        this.loadSeoDashboard(id);
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to run SEO audit');
        this.runningSeoAudit.set(false);
      },
    });
  }

  loadSeoTaskCycles(projectId: string) {
    this.seoService.listTaskCycles(projectId).subscribe((res) => this.seoTaskCycles.set(res.data.cycles));
  }

  generateSeoTaskCycle() {
    const id = this.selectedId();
    if (!id) return;
    this.seoService.generateTaskCycle(id).subscribe({
      next: (res) => {
        this.actionMessage.set(res.message);
        this.loadSeoTaskCycles(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to generate SEO task cycle'),
    });
  }

  connectSearchConsole() {
    const id = this.selectedId();
    if (!id || !this.newSearchConsolePropertyUrl.trim()) return;
    this.seoService.setSearchConsoleProperty(id, this.newSearchConsolePropertyUrl).subscribe({
      next: () => {
        this.newSearchConsolePropertyUrl = '';
        this.actionMessage.set('Google Search Console connection updated');
        this.loadSeoDashboard(id);
      },
      error: (err) => this.actionMessage.set(err.error?.message || 'Failed to connect Search Console'),
    });
  }

  provisionWebsiteRepository() {
    const id = this.selectedId();
    if (!id) return;
    this.provisioningRepository.set(true);
    this.websiteService.provisionRepository(id).subscribe({
      next: (res) => {
        this.websiteRepository.set(res.data.repository);
        this.provisioningRepository.set(false);
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to provision repository');
        this.provisioningRepository.set(false);
      },
    });
  }

  loadWebsiteEditors(projectId: string) {
    this.websiteService.listEditors(projectId).subscribe((res) => this.websiteEditors.set(res.data.assignments));
  }

  addWebsiteEditor() {
    const id = this.selectedId();
    if (!id || !this.newEditorUserId.trim()) return;
    this.websiteService.addEditor(id, this.newEditorUserId, this.newEditorLevel).subscribe({
      next: () => {
        this.newEditorUserId = '';
        this.loadWebsiteEditors(id);
        this.actionMessage.set('Editor assignment saved');
      },
      error: (err) => {
        this.actionMessage.set(err.error?.message || 'Failed to save editor assignment');
      },
    });
  }

  removeWebsiteEditor(assignment: WebsiteEditorAssignment) {
    const id = this.selectedId();
    if (!id) return;
    this.websiteService.removeEditor(id, assignment.id).subscribe(() => {
      this.loadWebsiteEditors(id);
      this.actionMessage.set('Editor assignment removed');
    });
  }
}
