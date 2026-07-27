import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ProjectService } from '../../core/services/project.service';
import { TaskService } from '../../core/services/task.service';
import { MessagingService } from '../../core/services/messaging.service';
import { RequestService } from '../../core/services/request.service';
import { MeetingService } from '../../core/services/meeting.service';
import { FileUploadService } from '../../core/services/file.service';
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
import { Member } from '../../core/models/organization.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.scss',
})
export class ProjectsComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly taskService = inject(TaskService);
  private readonly messagingService = inject(MessagingService);
  private readonly requestService = inject(RequestService);
  private readonly meetingService = inject(MeetingService);
  private readonly fileService = inject(FileUploadService);
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
}
