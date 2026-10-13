// Renders build/icon.svg to build/icon.png (1024×1024). electron-builder
// derives the Windows .ico and macOS .icns from that PNG at package time.
// Uses the repository root's playwright-core with any installed Chromium.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync(new URL("./build/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(
  `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="1024" height="1024" ')}</body></html>`,
);
await page.screenshot({ path: new URL("./build/icon.png", import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log("Wrote build/icon.png");
