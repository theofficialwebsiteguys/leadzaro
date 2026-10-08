import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../core/services/project.service';
import { Project } from '../../core/models/project.model';

@Component({
  selector: 'app-project-picker',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './project-picker.component.html',
  styleUrl: './project-picker.component.scss',
})
export class ProjectPickerComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);

  basePath = input.required<string>();
  // Compact mode renders a jump-to dropdown (the in-project business
  // switcher) instead of the full card grid used by the standalone
  // Projects list page.
  compact = input(false);
  currentProjectId = input<string | null>(null);

  projects = signal<Project[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.projectService.list().subscribe((res) => {
      this.projects.set(res.data.projects);
      this.loading.set(false);
    });
  }

  switchTo(projectId: string) {
    if (!projectId || projectId === this.currentProjectId()) return;
    this.router.navigate([this.basePath(), projectId]);
  }
}
