import { Component, inject, signal, effect } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { ProjectService } from '../../../core/services/project.service';
import { Project, projectDisplayName } from '../../../core/models/project.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { ProjectPickerComponent } from '../../../shared/project-picker/project-picker.component';
import { LabelPipe } from '../../../shared/pipes/label.pipe';

interface ProjectTab {
  label: string;
  segment: string;
  icon: string;
}

const TABS: ProjectTab[] = [
  { label: 'Overview', segment: 'overview', icon: 'dashboard' },
  { label: 'Messaging', segment: 'messages', icon: 'message' },
  { label: 'Tasks', segment: 'tasks', icon: 'check-circle' },
  { label: 'Media', segment: 'media', icon: 'image' },
  { label: 'Meetings', segment: 'meetings', icon: 'calendar' },
  { label: 'Requests', segment: 'requests', icon: 'mail' },
  { label: 'Project Settings', segment: 'settings', icon: 'settings' },
];

@Component({
  selector: 'app-project-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent, ProjectPickerComponent, LabelPipe],
  templateUrl: './project-shell.component.html',
  styleUrl: './project-shell.component.scss',
})
export class ProjectShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);

  readonly tabs = TABS;
  readonly displayName = projectDisplayName;

  // Reactive rather than a one-time snapshot read: the business switcher
  // below navigates to a sibling projects/:projectId route, which Angular
  // reuses this same component instance for (only the param changes), so
  // ngOnInit-style one-shot loading would go stale on switch.
  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  project = signal<Project | null>(null);

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (!id) return;
      this.projectService.getById(id).subscribe((res) => this.project.set(res.data.project));
    });
  }
}
