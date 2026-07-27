import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ProjectService } from '../../core/services/project.service';
import { TaskService } from '../../core/services/task.service';
import { MessagingService } from '../../core/services/messaging.service';
import { RequestService } from '../../core/services/request.service';
import { MeetingService } from '../../core/services/meeting.service';
import { FileUploadService } from '../../core/services/file.service';
import { CancellationService } from '../../core/services/cancellation.service';
import { WebsiteService } from '../../core/services/website.service';
import { SectionDefinitionService } from '../../core/services/sectionDefinition.service';
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
  Website, WebsiteVersion, WebsiteEditorAssignment, WebsiteComment, WebsitePresenceEntry,
} from '../../core/models/website.model';
import { SectionDefinition } from '../../core/models/sectionDefinition.model';
import { Member } from '../../core/models/organization.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, WebsitePreviewComponent],
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
  private readonly sectionDefinitionService = inject(SectionDefinitionService);
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
        if (this.org.hasPermission('builder.edit')) {
          this.websiteService.heartbeatPresence(projectId).subscribe(() => this.loadWebsitePresence(projectId));
        }
        if (this.org.hasPermission('builder.manage')) {
          this.loadWebsiteEditors(projectId);
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

  createWebsite() {
    const id = this.selectedId();
    if (!id || !this.newWebsiteName.trim()) return;
    this.websiteService.create(id, this.newWebsiteName, 'blank').subscribe(() => {
      this.newWebsiteName = '';
      this.loadWebsite(id);
      this.actionMessage.set('Website created');
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
        this.actionMessage.set('Version restored');
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
