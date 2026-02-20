import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'product-proxy',
      configureServer(server) {
        server.middlewares.use('/api/fetch', async (req, res) => {
          const url = new URL(req.url, 'http://localhost');
          const target = url.searchParams.get('url');

          if (!target) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
            return;
          }

          try {
            const response = await fetch(target, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept:
                  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
              redirect: 'follow',
            });

            if (!response.ok) {
              res.writeHead(response.status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Upstream returned ${response.status}` }));
              return;
            }

            const html = await response.text();
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(html);
          } catch (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      },
    },
  ],
});
