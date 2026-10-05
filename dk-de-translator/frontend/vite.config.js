import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { parse } from 'yaml';

// Servers in config.yml with proxyTo: forward their url path to the real server.
// With auth: basic, the proxy adds USERNAME/PASSWORD from ../.env, so they never reach the browser.
const { sources, targets } = parse(readFileSync(new URL('./config.yml', import.meta.url), 'utf8'));
const envFile = new URL('../.env', import.meta.url);
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const proxy = Object.fromEntries([...sources, ...targets].filter((s) => s.proxyTo).map((s) => {
  const upstream = new URL(s.proxyTo);
  if (s.auth === 'basic' && !(env.USERNAME && env.PASSWORD)) {
    throw new Error(`${s.id} needs USERNAME and PASSWORD in dk-de-translator/.env`);
  }
  return [s.url, {
    target: upstream.origin,
    changeOrigin: true,
    rewrite: (path) => upstream.pathname + path.slice(s.url.length),
    ...(s.auth === 'basic' && { auth: `${env.USERNAME}:${env.PASSWORD}` }),
  }];
}));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 28090, proxy },
});
