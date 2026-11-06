/** Display labels. No runtime dependencies. */
import type { Kind, Subkind } from './types';

const SUBKIND_LABELS: Record<string, string> = {
  text: 'Text input',
  select: 'Select',
  checkbox: 'Checkbox',
  radio: 'Radio',
  toggle: 'Toggle',
  tabs: 'Tabs',
  nav: 'Navigation',
  breadcrumb: 'Breadcrumb',
  pagination: 'Pagination',
};
const KIND_NAMES: Record<Kind, string> = {
  button: 'Button',
  link: 'Link',
  input: 'Input',
  badge: 'Badge',
  icon: 'Icon',
  avatar: 'Avatar',
  card: 'Card',
  alert: 'Alert',
  table: 'Table',
  nav: 'Navigation',
  menu: 'Menu',
  dialog: 'Dialog',
  progress: 'Progress',
};

export function kindLabel(kind: Kind, subkind: Subkind): string {
  return (subkind && SUBKIND_LABELS[subkind]) || KIND_NAMES[kind];
}


export type BucketKey = 'common' | 'couldBeOne' | 'oneOff';

/** What each bucket is called, and the one line that says what it means and what to do. */
export const BUCKETS: Record<BucketKey, { label: string; legend: string; hint: string }> = {
  common: {
    label: 'Reused',
    legend: 'reused',
    hint: 'Used 2 or more times. These are your components: document them.',
  },
  couldBeOne: {
    label: 'Near-duplicates',
    legend: 'near-duplicates',
    hint: 'Look almost the same but differ slightly. Merge each group into one component.',
  },
  oneOff: {
    label: 'One-off',
    legend: 'one-off',
    hint: 'Used once. Swap it for the closest match, or keep it if it’s meant to be unique.',
  },
};
