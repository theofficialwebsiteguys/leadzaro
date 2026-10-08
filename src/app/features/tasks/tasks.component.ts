import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { map } from 'rxjs';
import { TaskService } from '../../core/services/task.service';
import { MembershipService } from '../../core/services/membership.service';
import { OrganizationContextService } from '../../core/services/organization-context.service';
import { Task, TASK_STATUSES, TASK_PRIORITIES, TaskPriority } from '../../core/models/task.model';
import { Member } from '../../core/models/organization.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { LabelPipe } from '../../shared/pipes/label.pipe';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [FormsModule, DatePipe, HasPermissionDirective, EmptyStateComponent, LabelPipe],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss',
})
export class TasksComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly taskService = inject(TaskService);
  private readonly membershipService = inject(MembershipService);
  readonly org = inject(OrganizationContextService);

  // Reactive rather than a one-time snapshot read: the project shell's
  // business switcher can navigate here with only the :projectId param
  // changing, which Angular handles by reusing this component instance.
  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  readonly taskStatuses = TASK_STATUSES;
  private readonly priorityCycle = TASK_PRIORITIES;

  members = signal<Member[]>([]);
  tasks = signal<Task[]>([]);
  newTaskTitle = '';
  newTaskAssigneeUserId = '';
  newTaskDueDate = '';

  constructor() {
    this.membershipService.list().subscribe((res) => {
      this.members.set(res.data.memberships.filter((m) => m.membershipType === 'employee' && m.status === 'active'));
    });

    effect(() => {
      const id = this.projectId();
      if (id) this.loadTasks(id);
    });
  }

  loadTasks(projectId: string) {
    this.taskService.list(projectId).subscribe((res) => this.tasks.set(res.data.tasks));
  }

  createTask() {
    const id = this.projectId();
    if (!id || !this.newTaskTitle.trim()) return;
    this.taskService.create(id, {
      title: this.newTaskTitle,
      assigneeUserId: this.newTaskAssigneeUserId || undefined,
      dueDate: this.newTaskDueDate || undefined,
    }).subscribe(() => {
      this.newTaskTitle = '';
      this.newTaskAssigneeUserId = '';
      this.newTaskDueDate = '';
      this.loadTasks(id);
    });
  }

  updateTaskStatus(task: Task, status: string) {
    const id = this.projectId();
    if (!id) return;
    this.taskService.update(id, task.id, { status: status as Task['status'] }).subscribe(() => this.loadTasks(id));
  }

  cyclePriority(task: Task) {
    const id = this.projectId();
    if (!id) return;
    const nextIndex = (this.priorityCycle.indexOf(task.priority) + 1) % this.priorityCycle.length;
    const priority: TaskPriority = this.priorityCycle[nextIndex];
    this.taskService.update(id, task.id, { priority }).subscribe(() => this.loadTasks(id));
  }

  archiveTask(task: Task) {
    const id = this.projectId();
    if (!id) return;
    this.taskService.archive(id, task.id).subscribe(() => this.loadTasks(id));
  }
}
