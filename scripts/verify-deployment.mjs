import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function listFiles(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(dir, name + '/'));
    else result.push(name);
  }
  return result;
}

export async function verifyDeployment(base, dir, { attempts = 6, interval = 10000 } = {}) {
  const files = await listFiles(dir);
  if (!files.includes('index.html') || !files.includes('version.json')) throw new Error('Build or version marker missing');
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      for (const file of files) {
        const url = new URL(file === 'index.html' ? '/' : '/' + file, base);
        url.searchParams.set('deployment_check', `${Date.now()}-${attempt}`);
        const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (response.status !== 200) throw new Error(`${file}: HTTP ${response.status}`);
        const actual = Buffer.from(await response.arrayBuffer());
        const expected = await readFile(join(dir, file));
        if (!actual.equals(expected)) throw new Error(`${file}: deployed content differs from this build`);
      }
      console.log(`Verified current build: ${files.length} files match at ${base}`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`Verification ${attempt}/${attempts}: ${error.message}`);
      if (attempt < attempts) await delay(interval);
    }
  }
  throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyDeployment(process.argv[2], process.argv[3] || 'dist').catch(() => { process.exitCode = 1; });
}
