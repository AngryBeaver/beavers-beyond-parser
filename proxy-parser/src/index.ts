import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

const COBALT_SESSION = process.env.COBALT_SESSION ?? '';
const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (reqUrl.pathname === '/fetch') {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'url query parameter required' }));
      return;
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          Cookie: `CobaltSession=${COBALT_SESSION}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        const statusText =
          response.status === 401 || response.status === 403
            ? 'DDB rejected CobaltSession — update COBALT_SESSION in .env or Docker environment'
            : `DDB returned ${response.status}`;
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: statusText }));
        return;
      }

      const html = await response.text();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[beyond-parser-proxy] Listening on port ${PORT}`);
  if (!COBALT_SESSION) {
    console.warn('[beyond-parser-proxy] WARNING: COBALT_SESSION not set — DDB fetches will fail auth');
  }
});
