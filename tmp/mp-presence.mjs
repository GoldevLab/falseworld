import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000/";

async function loadMp(page, label) {
  page.on("pageerror", (e) => console.log(`[${label} ERR]`, String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for multiplayer script (no WebGPU / START needed)
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => !!(window.FalseWorldMp && window.FalseWorldMp.create));
    if (ok) break;
    await page.waitForTimeout(100);
    if (i === 99) throw new Error(`[${label}] FalseWorldMp missing`);
  }
  // Unique guest per context
  const info = await page.evaluate((seed) => {
    const g = window.FalseWorldMp.loadGuest();
    window.__fw = Object.assign(window.__fw || {}, { playerId: g.id, playerName: g.name });
    const mp = window.FalseWorldMp.create();
    let last = [];
    mp.connect({
      seed,
      name: g.name + "-" + Math.random().toString(36).slice(2, 5),
      getPose: () => ({
        x: 5 + Math.random() * 4,
        y: 3 + Math.random(),
        z: 5 + Math.random() * 4,
        yaw: 0,
        moving: true,
        sprinting: false,
        crouching: false,
      }),
      onPeers: (list) => { last = list || []; window.__testPeers = last; },
    });
    window.__testMp = mp;
    return { id: mp.getSelfId(), name: mp.getName() };
  }, 42);
  console.log(`[${label}] connected as`, info);
  return info;
}

async function snap(page) {
  return page.evaluate(() => {
    const mp = window.__testMp;
    const peers = mp ? mp.getPeers() : [];
    return {
      id: mp && mp.getSelfId(),
      connected: mp && mp.isConnected(),
      peerCount: peers.length,
      peers: peers.map((p) => ({
        id: String(p.id).slice(0, 8),
        x: +(+p.x).toFixed(1),
        y: +(+p.y).toFixed(1),
        z: +(+p.z).toFixed(1),
      })),
    };
  });
}

const browser = await chromium.launch({ headless: true });
const pageA = await (await browser.newContext()).newPage();
const pageB = await (await browser.newContext()).newPage();

try {
  const aInfo = await loadMp(pageA, "A");
  const bInfo = await loadMp(pageB, "B");

  let aSeesB = false;
  let bSeesA = false;
  let a;
  let b;
  for (let i = 0; i < 20; i++) {
    await pageA.waitForTimeout(250);
    await pageB.waitForTimeout(250);
    a = await snap(pageA);
    b = await snap(pageB);
    aSeesB = a.peers.some((p) => String(bInfo.id).startsWith(p.id) || String(b.id).startsWith(p.id));
    bSeesA = b.peers.some((p) => String(aInfo.id).startsWith(p.id) || String(a.id).startsWith(p.id));
    if (aSeesB && bSeesA) break;
  }
  console.log("A_final", JSON.stringify(a, null, 2));
  console.log("B_final", JSON.stringify(b, null, 2));
  console.log("RESULT", { aSeesB, bSeesA, aPeers: a.peerCount, bPeers: b.peerCount });
  if (!aSeesB || !bSeesA) {
    console.error("FAIL asymmetric or empty peers");
    process.exitCode = 2;
  } else {
    console.log("PASS both tabs see each other via presence");
  }
} catch (e) {
  console.error("TEST_FAIL", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
