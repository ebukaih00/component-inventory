import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

/**
 * CRXJS lists the injected content script as web-accessible on every http(s) site. The extension
 * injects it with chrome.scripting, which does not need that, and the entry would let any page
 * detect the extension — so remove it.
 */
function dropWebAccessibleContentScript(): Plugin {
  return {
    name: 'drop-web-accessible-content-script',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_opts, bundle) {
        const asset = bundle['manifest.json'];
        if (!asset || asset.type !== 'asset') return;
        const m = JSON.parse(String(asset.source));
        m.web_accessible_resources = (m.web_accessible_resources ?? [])
          .map((w: { resources: string[] }) => ({ ...w, resources: w.resources.filter((r) => !r.startsWith('src/content/')) }))
          .filter((w: { resources: string[] }) => w.resources.length > 0);
        if (m.web_accessible_resources.length === 0) delete m.web_accessible_resources;
        asset.source = JSON.stringify(m, null, 2);
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [preact(), crx({ manifest }), ...(command === 'build' ? [dropWebAccessibleContentScript()] : [])],
  build: { target: 'chrome116', sourcemap: false },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
}));
