import { chromium } from 'playwright';

const BASE = process.env.FW_URL || 'http://127.0.0.1:3000/';

async function bootTab(browser, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/FW mp|VRM|remote|Online|WebSocket|error|warn/i.test(t)) {
      console.log(`[${label}]`, t.slice(0, 200));
    }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Wait for START
  const start = page.locator('#fw-start, button:has-text("START")').first();
  await start.waitFor({ state: 'visible', timeout: 180000 });
  // small settle
  await page.waitForTimeout(1500);
  await start.click({ force: true });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const mp = window.__fw && window.__fw.mp;
    const peers = mp && mp.getPeers ? mp.getPeers() : [];
    return {
      playerId: window.__fw && window.__fw.playerId,
      connected: mp && mp.isConnected ? mp.isConnected() : false,
      peerCount: peers.length,
      peers: peers.map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z })),
      hasSetRemote: !!(window.__fw && window.__fw._dbgRemotes),
    };
  });
  return { ctx, page, info, label };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const a = await bootTab(browser, 'A');
  console.log('A', JSON.stringify(a.info, null, 2));
  const b = await bootTab(browser, 'B');
  console.log('B', JSON.stringify(b.info, null, 2));
  // wait for sync
  await a.page.waitForTimeout(3000);
  await b.page.waitForTimeout(500);
  const a2 = await a.page.evaluate(() => {
    const mp = window.__fw && window.__fw.mp;
    const peers = mp && mp.getPeers ? mp.getPeers() : [];
    return {
      playerId: window.__fw && window.__fw.playerId,
      connected: mp && mp.isConnected && mp.isConnected(),
      peerCount: peers.length,
      peers: peers.map(p => ({ id: (p.id||'').slice(0,8), name: p.name, x:+p.x.toFixed?.(1)||p.x, y:+p.y.toFixed?.(1)||p.y, z:+p.z.toFixed?.(1)||p.z })),
      status: document.querySelector('.fw-status, #fw-status, [data-status]')?.textContent || '',
    };
  });
  const b2 = await b.page.evaluate(() => {
    const mp = window.__fw && window.__fw.mp;
    const peers = mp && mp.getPeers ? mp.getPeers() : [];
    return {
      playerId: window.__fw && window.__fw.playerId,
      connected: mp && mp.isConnected && mp.isConnected(),
      peerCount: peers.length,
      peers: peers.map(p => ({ id: (p.id||'').slice(0,8), name: p.name, x:+p.x.toFixed?.(1)||p.x, y:+p.y.toFixed?.(1)||p.y, z:+p.z.toFixed?.(1)||p.z })),
      status: document.querySelector('.fw-status, #fw-status, [data-status]')?.textContent || '',
    };
  });
  console.log('A after', JSON.stringify(a2, null, 2));
  console.log('B after', JSON.stringify(b2, null, 2));
  const aSeesB = a2.peers.some(p => p.id && b2.playerId && b2.playerId.startsWith(p.id));
  const bSeesA = b2.peers.some(p => p.id && a2.playerId && a2.playerId.startsWith(p.id));
  console.log('RESULT aSeesB=', aSeesB, 'bSeesA=', bSeesA, 'aPeers=', a2.peerCount, 'bPeers=', b2.peerCount);
  await a.ctx.close();
  await b.ctx.close();
} finally {
  await browser.close();
}
