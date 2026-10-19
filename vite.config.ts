import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import { createConfig, ENV_KEYS } from './config/schema.ts';

// Import handlers only after .env files have been loaded and validated below.
const handlers: Record<string, () => Promise<{ default: (req: any, res?: any) => any }>> = {
  '/api/health': () => import('./api/health.ts'),
  '/api/traffic': () => import('./api/traffic.ts'),
  '/api/trafficimages': () => import('./api/trafficimages.ts'),
  '/api/trafficflow': () => import('./api/trafficflow.ts'),
  '/api/vms': () => import('./api/vms.ts'),
  '/api/traveltimes': () => import('./api/traveltimes.ts'),
  '/api/imageproxy': () => import('./api/imageproxy.ts'),
  '/api/expresswayspeeds': () => import('./api/expresswayspeeds.ts'),
  '/api/rainforecast': () => import('./api/rainforecast.ts'),
  '/api/forecast24h': () => import('./api/forecast24h.ts'),
  '/api/airquality': () => import('./api/airquality.ts'),
  '/api/live': () => import('./api/live.ts'),
};

function apiDevServerPlugin(): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use(apiMiddleware);
    },
    // `vite preview` serves the production build (with its service worker) and the same /api.
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware);
    },
  };
}

async function apiMiddleware(req: any, res: any, next: () => void) {
  if (!req.url?.startsWith('/api/')) {
    return next();
  }

  const pathname = req.url.split('?')[0].replace(/\.ts$/, '');

  // Provide compatibility helpers for serverless res
  if (typeof (res as any).json !== 'function') {
    (res as any).json = (body: any) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      return res;
    };
  }
  if (typeof (res as any).status !== 'function') {
    (res as any).status = (code: number) => {
      res.statusCode = code;
      return res;
    };
  }

  try {
    const load = handlers[pathname];
    if (!load) return next();
    const { default: handler } = await load();
    await handler(req, res);
  } catch (err: any) {
    console.error(`API Error on ${pathname}:`, err);
    res.statusCode = 500;
    (res as any).json({ error: 'Internal Server Error', message: err?.message });
  }
}

export default defineConfig(({ mode }) => {
  // Vite's mode files are loaded first; shell/platform values take precedence.
  // Only recognized settings are forwarded to local API handlers, never to client `define`.
  const loaded = loadEnv(mode, process.cwd(), '');
  const environment = { ...loaded, ...process.env };
  const config = createConfig(environment);
  for (const key of ENV_KEYS) {
    if (environment[key] !== undefined) process.env[key] = environment[key];
  }

  return {
    plugins: [react(), tailwindcss(), apiDevServerPlugin(), {
      name: 'validated-config-boundary',
      transform(_source, id) {
        if (id.split('?')[0].replaceAll('\\', '/').endsWith('/config/server.ts')) {
          this.error('Server config cannot be included in the browser bundle. Use config/client.ts.');
        }
      },
      transformIndexHtml(html) { return html.replaceAll('__TRAFFICPULSE_SITE_URL__', config.siteUrl); },
    }],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            // ONNX Runtime re-loads its own chunk inside a Web Worker. Keep the bundler helpers
            // it shares with the app in a small chunk of their own, so the worker doesn't import
            // the whole app (which uses `document` and crashes there).
            groups: [
              { name: 'helpers', test: /^\0(rolldown\/runtime|vite\/preload-helper)/ },
              // React rarely changes between deploys, so returning visitors keep it cached.
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
    preview: { host: config.dev.host, port: config.dev.previewPort, strictPort: true },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      host: config.dev.host,
      port: config.dev.port,
      strictPort: true,
      hmr: !config.dev.disableHmr,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: config.dev.disableHmr ? null : {},
    },
  };
});
