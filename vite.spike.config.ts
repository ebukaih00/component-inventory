import { defineConfig } from 'vite';

// Bundles the detection library + DOM collector into one script to paste into DevTools.
export default defineConfig({
  build: {
    outDir: 'dist-spike',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/spike/index.ts',
      name: 'ComponentInventorySpike',
      formats: ['iife'],
      fileName: () => 'inventory-spike.js',
    },
  },
});
