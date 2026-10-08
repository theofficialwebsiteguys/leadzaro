import { Component, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LinkEntry } from '../../../core/models/client.model';

/** Editable list of { label, url } rows — admin links, billing record links. */
@Component({
  selector: 'app-link-list-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="link-rows">
      @for (link of links(); track $index; let i = $index) {
        <div class="link-row">
          <input class="form-control" placeholder="Label (e.g. cPanel)" [ngModel]="link.label" (ngModelChange)="update(i, 'label', $event)" [attr.aria-label]="'Link ' + (i + 1) + ' label'" />
          <input class="form-control" placeholder="https://…" [ngModel]="link.url" (ngModelChange)="update(i, 'url', $event)" [attr.aria-label]="'Link ' + (i + 1) + ' address'" />
          <button type="button" class="btn btn-ghost btn-sm" (click)="remove(i)" [attr.aria-label]="'Remove link ' + (i + 1)">Remove</button>
        </div>
      }
      <button type="button" class="btn btn-ghost btn-sm add-link" (click)="add()">+ Add link</button>
    </div>
  `,
  styles: [`
    .link-rows { display: flex; flex-direction: column; gap: 8px; }
    .link-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; align-items: center; }
    .add-link { align-self: flex-start; }
    @media (max-width: 640px) { .link-row { grid-template-columns: 1fr; } }
  `],
})
export class LinkListEditorComponent {
  links = model<LinkEntry[]>([]);

  add() {
    this.links.update((rows) => [...rows, { label: '', url: '' }]);
  }

  remove(index: number) {
    this.links.update((rows) => rows.filter((_, i) => i !== index));
  }

  update(index: number, field: keyof LinkEntry, value: string) {
    this.links.update((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
}
