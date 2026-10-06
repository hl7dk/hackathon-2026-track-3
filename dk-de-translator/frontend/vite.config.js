import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { parse } from 'yaml';
import walletPlugin from './server/walletPlugin.js';

// Servers in config.yml with proxyTo: forward their url path to the real server.
// With auth: basic, the proxy adds USERNAME/PASSWORD from ../.env, so they never reach the browser.
const configFile = fileURLToPath(new URL('./config.yml', import.meta.url));
const config = parse(readFileSync(configFile, 'utf8'));
const { sources, targets } = config;
const envFile = new URL('../.env', import.meta.url);
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};

const basicAuth = (s) => {
  if (s.auth !== 'basic') return null;
  if (!(env.USERNAME && env.PASSWORD)) throw new Error(`${s.id} needs USERNAME and PASSWORD in dk-de-translator/.env`);
  return `${env.USERNAME}:${env.PASSWORD}`;
};

const proxy = Object.fromEntries([...sources, ...targets].filter((s) => s.proxyTo).map((s) => {
  const upstream = new URL(s.proxyTo);
  const auth = basicAuth(s);
  return [s.url, {
    target: upstream.origin,
    changeOrigin: true,
    rewrite: (path) => upstream.pathname + path.slice(s.url.length),
    ...(auth && { auth }),
  }];
}));

// The wallet's verifier calls the sources server-side, so it needs the real url and credentials.
const walletSources = sources.map((s) => {
  const auth = basicAuth(s);
  return { id: s.id, upstream: s.proxyTo ?? s.url, headers: auth ? { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {} };
});

// The proxy and the wallet routes are built from config.yml when the server starts, so restart on edits.
const restartOnConfigChange = {
  name: 'restart-on-config-change',
  configureServer(server) {
    server.watcher.add(configFile);
    server.watcher.on('change', (file) => file === configFile && server.restart());
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), walletPlugin({ ...config, sources: walletSources }), restartOnConfigChange],
  server: { port: 28090, proxy },
});
