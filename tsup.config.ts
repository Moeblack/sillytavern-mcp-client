import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server-plugin/src/index.ts'],
  outDir: 'plugin',
  dts: true,
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: false, // plugin/ contains package.json that must persist
  // Bundle the MCP SDK into the output so we don't need subpath export resolution
  // Only externalize node built-ins and express (provided by SillyTavern)
  noExternal: [
    '@modelcontextprotocol/sdk',
    'zod',
  ],
  external: [
    'express',
    'child_process',
    'node:child_process',
    'fs',
    'node:fs',
    'path',
    'node:path',
    'url',
    'node:url',
    'module',
    'node:module',
  ],
  banner: {
    js: '// SillyTavern MCP Client Plugin - Built from TypeScript source',
  },
});
