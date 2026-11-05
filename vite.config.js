import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { scrapeLiveProspects } from './src/lib/liveWebScraper.js'

function liveDiscoveryPlugin() {
  return {
    name: 'live-discovery-scraper',
    configureServer(server) {
      server.middlewares.use('/api/live-discovery', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const candidates = await scrapeLiveProspects(payload.config || {}, payload.count || 15);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, candidates }));
          } catch (err) {
            console.error('[Live Scraper Server Error]:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err.message, candidates: [] }));
          }
        });
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl(), liveDiscoveryPlugin()],
  server: {
    https: true,
    port: 5173,
    proxy: {
      '/api/resend': {
        target: 'https://api.resend.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/resend/, ''),
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[Vite Proxy] Resend upstream error:', err.message);
            if (res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                statusCode: 502,
                name: 'proxy_upstream_error',
                message: `Proxy failed to connect to Resend: ${err.message}`
              }));
            }
          });
        }
      },
      '/api/apollo': {
        target: 'https://api.apollo.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/apollo/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[Vite Proxy] Apollo upstream error:', err.message);
            if (res && typeof res.writeHead === 'function' && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                statusCode: 502,
                name: 'proxy_upstream_error',
                message: `Proxy failed to connect to Apollo: ${err.message}`
              }));
            }
          });
        }
      }
    }
  }
})
