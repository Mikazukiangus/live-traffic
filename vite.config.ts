import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import healthHandler from './api/health.ts';
import trafficHandler from './api/traffic.ts';
import trafficImagesHandler from './api/trafficimages.ts';
import trafficFlowHandler from './api/trafficflow.ts';
import vmsHandler from './api/vms.ts';
import travelTimesHandler from './api/traveltimes.ts';
import imageProxyHandler from './api/imageproxy.ts';
import expresswaySpeedsHandler from './api/expresswayspeeds.ts';
import rainForecastHandler from './api/rainforecast.ts';
import forecast24hHandler from './api/forecast24h.ts';
import airQualityHandler from './api/airquality.ts';
import liveFeedsHandler from './api/live.ts';

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
    switch (pathname) {
      case '/api/health':
        await healthHandler(req, res);
        return;
      case '/api/traffic':
        await trafficHandler(req, res);
        return;
      case '/api/trafficimages':
        await trafficImagesHandler(req, res);
        return;
      case '/api/trafficflow':
        await trafficFlowHandler(req, res);
        return;
      case '/api/vms':
        await vmsHandler(req, res);
        return;
      case '/api/traveltimes':
        await travelTimesHandler(req, res);
        return;
      case '/api/imageproxy':
        await imageProxyHandler(req, res);
        return;
      case '/api/expresswayspeeds':
        await expresswaySpeedsHandler(req, res);
        return;
      case '/api/rainforecast':
        await rainForecastHandler(req, res);
        return;
      case '/api/forecast24h':
        await forecast24hHandler(req, res);
        return;
      case '/api/airquality':
        await airQualityHandler(req, res);
        return;
      case '/api/live':
        await liveFeedsHandler(req, res);
        return;
      default:
        return next();
    }
  } catch (err: any) {
    console.error(`API Error on ${pathname}:`, err);
    res.statusCode = 500;
    (res as any).json({ error: 'Internal Server Error', message: err?.message });
  }
}

export default defineConfig(({ mode }) => {
  // Expose server-only secrets from .env / .env.local to the /api handlers in dev.
  // Vercel injects these directly into process.env in production.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['LTA_ACCOUNT_KEY', 'LTA_API_KEY']) {
    if (env[key] && !process.env[key]) {
      process.env[key] = env[key];
    }
  }

  return {
    plugins: [react(), tailwindcss(), apiDevServerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            // ONNX Runtime re-loads its own chunk inside a Web Worker. Keep the bundler helpers
            // it shares with the app in a small chunk of their own, so the worker doesn't import
            // the whole app (which uses `document` and crashes there).
            groups: [{ name: 'helpers', test: /^\0(rolldown\/runtime|vite\/preload-helper)/ }],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
