const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('../../frontend/node_modules/playwright');

(async () => {
  const file = process.argv[2];
  assert(file, 'Passare il percorso del catalogo HTML generato');
  // Managed Chromium blocks file://; serve the unchanged artifact on loopback
  // for this test. The distributed HTML itself requires no server.
  const html = fs.readFileSync(path.resolve(file));
  const server = http.createServer((request, response) => {
    if (request.url !== '/') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'], // Linux CI only; not part of the shipped HTML.
  });
  const page = await browser.newPage();
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) externalRequests.push(request.url());
  });
  try {
    await page.goto(origin);
    await page.locator('#list button').first().waitFor();
    assert.match(await page.title(), /Albertelli Kitchen/);
    await page.locator('#search').fill('21008');
    await page.waitForTimeout(250);
    await page.locator('#list button').filter({ hasText: '21008' }).first().click();
    assert.match(await page.locator('#detail').innerText(), /1\.006/);
    assert.match(await page.locator('#detail').innerText(), /Non disponibile/);
    assert.match(await page.locator('#detail').innerText(), /Pagina 200/);
    await page.locator('#search').fill('10801');
    await page.waitForTimeout(250);
    await page.locator('#list button').filter({ hasText: '10801' }).first().click();
    assert.match(await page.locator('#detail table').innerText(), /Opaco/);
    assert.match(await page.locator('#detail table').innerText(), /Laccato/);
    await page.locator('#search').fill('9312');
    await page.waitForTimeout(250);
    await page.locator('#list button').filter({ has: page.getByText('9312', { exact: true }) }).first().click();
    assert.match(await page.locator('#detail').innerText(), /Maggiorazione: 30%/);
    await page.locator('#search').fill('7904');
    await page.waitForTimeout(250);
    await page.locator('#list button').filter({ has: page.getByText('7904', { exact: true }) }).first().click();
    assert.match(await page.locator('#detail table').innerText(), /Verifica sulla pagina/);
    assert.match(await page.locator('#detail table').innerText(), /0/);
    await page.locator('#search').fill('223');
    await page.waitForTimeout(250);
    const handle = page.locator('#list button').filter({ hasText: /Maniglia \/ pomello 223/ });
    await handle.first().click();
    assert.match(await page.locator('#detail').innerText(), /Codice supplemento: 7945/);
    assert.match(await page.locator('#detail table').innerText(), /33/);
    await page.locator('#pages').click();
    await page.locator('#search').fill('sigillature');
    await page.waitForTimeout(250);
    await page.locator('#list button').first().click();
    assert.match(await page.locator('#detail').innerText(), /sigillature/i);
    assert.doesNotMatch(await page.locator('body').innerText(), /nobilia/i);
    await page.locator('#search').fill('<img src=x onerror=alert(1)>');
    await page.waitForTimeout(250);
    assert.match(await page.locator('#list').innerText(), /Nessun risultato/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    console.log('Catalogo offline: ricerca, punti, indisponibilità, superfici, maniglie, note, sicurezza e layout verificati.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
