import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SYMBOL_PATHS } from '../core/symbols';

@Component({
  selector: 'px-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true" focusable="false">
    <path [attr.d]="path()" fill="currentColor" fill-rule="evenodd" />
  </svg>`,
  styles: [':host{display:inline-flex;line-height:0}'],
})
export class IconComponent {
  name = input.required<string>();
  size = input<number | string>(24);
  path = computed(() => SYMBOL_PATHS[this.name()] ?? '');
}
