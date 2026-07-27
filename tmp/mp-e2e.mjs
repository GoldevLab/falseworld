import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000/";

async function waitStart(page, label) {
  page.on("console", (m) => {
    const t = m.text();
    if (/\[FW|VRM|mp|Online|WebSocket|error|fail/i.test(t)) {
      console.log(`[${label}]`, t.slice(0, 180));
    }
  });
  page.on("pageerror", (e) => console.log(`[${label} ERR]`, String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  const btn = page.locator("#fw-start-hit");
  await btn.waitFor({ state: "attached", timeout: 60000 });
  for (let i = 0; i < 240; i++) {
    const ready = await btn.evaluate(
      (el) => el.classList.contains("is-ready") || /START/i.test(el.textContent || "")
    );
    const err = await btn.evaluate((el) => el.classList.contains("is-error"));
    const status = await page.locator("#fw-load-status").textContent().catch(() => "");
    if (err) throw new Error(`[${label}] load error: ${status}`);
    if (ready) {
      console.log(`[${label}] ready after ${i * 2}s status=${status}`);
      break;
    }
    if (i % 15 === 0) console.log(`[${label}] loading… ${status}`);
    await page.waitForTimeout(2000);
    if (i === 239) throw new Error(`[${label}] START never ready: ${status}`);
  }
  await btn.click({ force: true });
  await page.waitForTimeout(2500);
}

async function snap(page) {
  return page.evaluate(() => {
    const mp = window.__fw && window.__fw.mp;
    const peers = mp && mp.getPeers ? mp.getPeers() : [];
    const vrm = window.__fw && window.__fw.vrm;
    return {
      id: window.__fw && window.__fw.playerId,
      connected: !!(mp && mp.isConnected && mp.isConnected()),
      peerCount: peers.length,
      peers: peers.map((p) => ({
        id: String(p.id || "").slice(0, 8),
        name: p.name,
        x: Math.round((+p.x || 0) * 10) / 10,
        y: Math.round((+p.y || 0) * 10) / 10,
        z: Math.round((+p.z || 0) * 10) / 10,
      })),
      remoteCount: vrm && typeof vrm.getRemoteCount === "function" ? vrm.getRemoteCount() : null,
      peerCountFw: window.__fw && window.__fw.peerCount,
      bodyText: (document.body.innerText || "").match(/Online[^\n]{0,80}/)?.[0] || "",
    };
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader-webgl"],
});

const pageA = await (await browser.newContext()).newPage();
const pageB = await (await browser.newContext()).newPage();

try {
  await waitStart(pageA, "A");
  console.log("A0", JSON.stringify(await snap(pageA)));

  await waitStart(pageB, "B");
  console.log("B0", JSON.stringify(await snap(pageB)));

  for (let i = 0; i < 10; i++) {
    await pageA.keyboard.down("KeyW");
    await pageB.keyboard.down("KeyD");
    await pageA.waitForTimeout(250);
    await pageB.waitForTimeout(250);
    await pageA.keyboard.up("KeyW");
    await pageB.keyboard.up("KeyD");
    await pageA.waitForTimeout(400);
  }

  const a = await snap(pageA);
  const b = await snap(pageB);
  console.log("A_final", JSON.stringify(a, null, 2));
  console.log("B_final", JSON.stringify(b, null, 2));
  const aSeesB = a.peers.some((p) => b.id && String(b.id).startsWith(p.id));
  const bSeesA = b.peers.some((p) => a.id && String(a.id).startsWith(p.id));
  console.log("RESULT", {
    aSeesB,
    bSeesA,
    aPeers: a.peerCount,
    bPeers: b.peerCount,
    aRemote: a.remoteCount,
    bRemote: b.remoteCount,
    aConn: a.connected,
    bConn: b.connected,
  });
  if (!aSeesB || !bSeesA) process.exitCode = 2;
} catch (e) {
  console.error("E2E_FAIL", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
