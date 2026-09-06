import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDeployment } from './verify-deployment.mjs';

for (const mode of ['current', 'forbidden', 'stale', 'missing-asset', 'spa-fallback']) {
  test(`deployment verification: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'l16-deploy-'));
    const files = { 'index.html': '<html><div id="root"></div><script src="/app.js"></script></html>', 'app.js': 'console.log("current")', 'version.json': '{"commit":"new"}' };
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
    const server = createServer((req, res) => {
      const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
      if (mode === 'forbidden') { res.writeHead(403); res.end('Forbidden'); return; }
      if (mode === 'missing-asset' && path === 'app.js') { res.writeHead(404); res.end(); return; }
      if (mode === 'stale' && path === 'version.json') { res.end('{"commit":"old"}'); return; }
      res.end(mode === 'spa-fallback' && path === 'app.js' ? files['index.html'] : files[path]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const run = verifyDeployment(`http://127.0.0.1:${server.address().port}`, dir, { attempts: 1 });
      if (mode === 'current') await run;
      else await assert.rejects(run);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });
}
