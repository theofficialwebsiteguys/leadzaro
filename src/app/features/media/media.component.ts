import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { map } from 'rxjs';
import { FileUploadService } from '../../core/services/file.service';
import { ProjectFile, FILE_SCOPES } from '../../core/models/file.model';
import { HasPermissionDirective } from '../../core/directives/has-permission.directive';

@Component({
  selector: 'app-media',
  standalone: true,
  imports: [FormsModule, HasPermissionDirective],
  templateUrl: './media.component.html',
  styleUrl: './media.component.scss',
})
export class MediaComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly fileService = inject(FileUploadService);

  // Reactive rather than a one-time snapshot read: the project shell's
  // business switcher can navigate here with only the :projectId param
  // changing, which Angular handles by reusing this component instance.
  readonly projectId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('projectId')!)),
    { initialValue: this.route.snapshot.paramMap.get('projectId')! },
  );

  readonly fileScopes = FILE_SCOPES;

  files = signal<ProjectFile[]>([]);
  newFileScope: string = 'project';
  newFileIsPrivate = true;
  selectedFile: File | null = null;

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.loadFiles(id);
    });
  }

  loadFiles(projectId: string) {
    this.fileService.list(projectId).subscribe((res) => this.files.set(res.data.files));
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  uploadFile() {
    const id = this.projectId();
    if (!id || !this.selectedFile) return;
    this.fileService.upload(id, this.selectedFile, this.newFileScope, this.newFileIsPrivate).subscribe(() => {
      this.selectedFile = null;
      this.loadFiles(id);
    });
  }

  openFile(file: ProjectFile) {
    const id = this.projectId();
    if (!id) return;
    this.fileService.getSignedUrl(id, file.id).subscribe((res) => window.open(res.data.url, '_blank'));
  }

  deleteFile(file: ProjectFile) {
    const id = this.projectId();
    if (!id) return;
    this.fileService.delete(id, file.id).subscribe(() => this.loadFiles(id));
  }
}
