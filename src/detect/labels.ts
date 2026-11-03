/** Display labels. No runtime dependencies, so the Figma sandbox can use it. */
import type { Kind, Subkind } from './types';

const SUBKIND_LABELS: Record<string, string> = {
  text: 'Text input',
  select: 'Select',
  checkbox: 'Checkbox',
  radio: 'Radio',
  toggle: 'Toggle',
  tabs: 'Tabs',
  nav: 'Navigation',
};
const KIND_NAMES: Record<Kind, string> = {
  button: 'Button',
  input: 'Input',
  badge: 'Badge',
  card: 'Card',
  table: 'Table',
  nav: 'Navigation',
};

export function kindLabel(kind: Kind, subkind: Subkind): string {
  return (subkind && SUBKIND_LABELS[subkind]) || KIND_NAMES[kind];
}

