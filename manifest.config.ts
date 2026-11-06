import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// The e2e build pre-grants host access so Playwright never sees a permission prompt. It uses
// <all_urls> because captureVisibleTab needs activeTab (a toolbar click) or <all_urls>, and a test
// cannot click the toolbar. Production builds never ship it.
const e2e = process.env.CI_E2E === '1';

export default defineManifest({
  manifest_version: 3,
  name: 'Component Inventory',
  version: pkg.version,
  description: 'Find every version of every component in your product, and see which ones should be the same.',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_title: 'Component Inventory' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  // No <all_urls>: activeTab for one-off scans, optional host permission per product domain for record mode.
  permissions: ['activeTab', 'scripting', 'sidePanel'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  ...(e2e ? { host_permissions: ['<all_urls>'] } : {}),
  commands: {
    'scan-page': { suggested_key: { default: 'Alt+Shift+S' }, description: 'Scan this page' },
    'toggle-collect': { suggested_key: { default: 'Alt+Shift+C' }, description: 'Start or stop collecting components' },
  },
  minimum_chrome_version: '116',
});
