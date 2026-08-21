import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const pluginRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: pluginRoot,
  build: {
    outDir: 'dist/ui-build',
    emptyOutDir: true,
    rollupOptions: { input: resolve(pluginRoot, 'src/ui/index.html') },
  },
  define: {
    'import.meta.env.VITE_BACKEND_BASE_URL': JSON.stringify(
      process.env.BACKEND_BASE_URL ?? 'http://localhost:8787',
    ),
  },
});
