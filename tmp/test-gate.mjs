/**
 * Debug load gate — capture errors without waiting forever.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const URL = "http://127.0.0.1:3000/";
const OUT = "/home/golfredo/Documentos/apps/falseworld/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=default", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const snap = await page.evaluate(() => ({
    gpu: !!navigator.gpu,
    fwGpu: !!window.FalseWorldGpu,
    vrm: !!window.FalseWorldVrm,
    inv: !!window.FalseWorldInv,
    gateStatus: document.getElementById("fw-load-status")?.textContent,
    gateErr: document.querySelector(".load-err")?.textContent,
    startClass: document.getElementById("fw-start-hit")?.className,
    startText: document.getElementById("fw-start-hit")?.textContent,
    unlocked: document.querySelector(".stage")?.dataset?.unlocked,
  }));
  console.log(`tick ${i}`, JSON.stringify(snap));
  if (snap.startClass?.includes("is-ready")) break;
  if (snap.startClass?.includes("is-error") || snap.gateErr) break;
}

await page.screenshot({ path: join(OUT, "gate-debug.png") });
writeFileSync(join(OUT, "gate-logs.json"), JSON.stringify(logs.slice(-80), null, 2));
await browser.close();
