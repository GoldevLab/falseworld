/**
 * Headless smoke test: load meadow, start game, capture HUD + screenshot.
 * Run: node tmp/test-meadow.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const URL = "http://127.0.0.1:3000/";
const OUT = "/home/golfredo/Documentos/apps/falseworld/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--use-angle=default",
    "--enable-features=Vulkan",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });

// Wait for WebGPU client
await page.waitForFunction(() => window.FalseWorldGpu, { timeout: 120000 });

// Wait for START ready
await page.waitForSelector("#fw-start-hit.is-ready", { timeout: 180000 });
await page.click("#fw-start-hit");
await page.waitForTimeout(1500);

// Pointer lock + canvas focus
const canvas = page.locator("#fw-canvas");
await canvas.click({ force: true });
await page.waitForTimeout(3000);

const hud = await page.locator(".hud-line").first().textContent().catch(() => "");
const fps = await page.locator("#fw-fps").textContent().catch(() => "");
const pose = await page.evaluate(() => {
  const api = window.__fw;
  return window.FalseWorldGpu && document.querySelector("#fw-canvas")
    ? { hasApi: !!api, unlocked: document.querySelector(".stage")?.dataset?.unlocked }
    : null;
});

// Sample center pixel colors from canvas
const colors = await page.evaluate(() => {
  const c = document.getElementById("fw-canvas");
  if (!c) return null;
  const ctx = c.getContext("webgpu");
  // Can't read WebGPU canvas pixels directly from JS without copyTextureToBuffer.
  // Use canvas as 2d fallback won't work. Return canvas size only.
  return { w: c.width, h: c.height, clientW: c.clientWidth, clientH: c.clientHeight };
});

await page.screenshot({ path: join(OUT, "meadow-after-start.png"), fullPage: false });

writeFileSync(join(OUT, "report.json"), JSON.stringify({ hud, fps, pose, colors, logs: logs.slice(-40) }, null, 2));
console.log(JSON.stringify({ hud, fps, pose, colors, logTail: logs.slice(-8) }, null, 2));

await browser.close();
