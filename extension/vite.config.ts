import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'McpClientExtension',
      formats: ['iife'],
      fileName: () => 'index.iife.js',
    },
    outDir: path.resolve(__dirname, '..', 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false, // Keep readable for debugging
    rollupOptions: {
      // SillyTavern provides these at runtime — do not bundle
      external: [
        /^\/scripts\/.*/,
        /^\.\.\/.*script\.js/,
      ],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '..', 'shared'),
    },
  },
});
