import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { parse } from 'yaml';

// Servers in config.yml with proxyTo: forward their url path to the real server.
const { sources, targets } = parse(readFileSync(new URL('./config.yml', import.meta.url), 'utf8'));
const proxy = Object.fromEntries([...sources, ...targets].filter((s) => s.proxyTo).map((s) => {
  const upstream = new URL(s.proxyTo);
  return [s.url, {
    target: upstream.origin,
    changeOrigin: true,
    rewrite: (path) => upstream.pathname + path.slice(s.url.length),
  }];
}));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 28090, proxy },
});
