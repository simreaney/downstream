// Copies the web build (../dist) into ./app for electron-builder to package.
// Run `npm run build` in the repository root first.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const app = fileURLToPath(new URL("./app/", import.meta.url));

if (!existsSync(new URL("index.html", `file://${dist}`))) {
  console.error("No web build found in ../dist. Run `npm run build` in the repository root first.");
  process.exit(1);
}
rmSync(app, { recursive: true, force: true });
cpSync(dist, app, { recursive: true });
console.log(`Copied ${dist} -> ${app}`);
