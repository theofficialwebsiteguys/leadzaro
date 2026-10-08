import { Component, HostListener, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (open()) {
      <div class="dialog-backdrop" (click)="closed.emit()" aria-hidden="true"></div>
      <div class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="title()" [class.wide]="wide()">
        <header class="dialog-header">
          <h2>{{ title() }}</h2>
          <button type="button" class="dialog-close" (click)="closed.emit()" aria-label="Close">
            <lz-icon name="x" [size]="18" />
          </button>
        </header>
        <div class="dialog-body"><ng-content /></div>
        <footer class="dialog-footer"><ng-content select="[dialog-actions]" /></footer>
      </div>
    }
  `,
  styles: [`
    .dialog-backdrop {
      position: fixed; inset: 0; z-index: 300;
      background: rgba(15, 23, 42, .45);
      backdrop-filter: blur(2px);
    }
    .dialog {
      position: fixed; z-index: 301;
      top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      display: flex; flex-direction: column;
      background: var(--card); border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      &.wide { width: min(720px, calc(100vw - 32px)); }
    }
    .dialog-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 22px 10px;
      h2 { margin: 0; font-size: 1.1rem; }
    }
    .dialog-close {
      background: none; border: none; color: var(--text-muted); cursor: pointer;
      padding: 6px; border-radius: var(--radius);
      transition: background var(--transition), color var(--transition);
      &:hover { background: var(--border-light); color: var(--text-primary); }
    }
    .dialog-body { padding: 8px 22px 16px; overflow-y: auto; }
    .dialog-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 14px 22px; border-top: 1px solid var(--border-light);
      &:empty { display: none; }
    }
  `],
})
export class DialogComponent {
  open = input(false);
  title = input.required<string>();
  wide = input(false);
  closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.closed.emit();
  }
}
