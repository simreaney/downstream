/**
 * Electron entry point for the desktop build.
 *
 * The game is the same Vite build that GitHub Pages serves, copied into
 * `app/` by `npm run prepare-app`. It is served over a custom `app://` scheme
 * rather than loaded from `file://` for two reasons:
 *
 *   - The simulation runs in a module worker (`new Worker(url, { type:
 *     "module" })`), and Chromium refuses module workers from `file://`
 *     because the page has an opaque origin.
 *   - The build uses `base: "/downstream/"` (see vite.config.ts), so every
 *     asset URL is absolute. Serving `app://downstream/downstream/...` keeps
 *     those URLs valid without a separate desktop build.
 *
 * Registering the scheme as standard and secure gives the page a real origin,
 * so localStorage (saves, language choice) persists between launches.
 */
const { app, BrowserWindow, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "app";
const HOST = "downstream";
const BASE = "/downstream/";
const ROOT = path.join(__dirname, "app");
const START_URL = `${SCHEME}://${HOST}${BASE}play/`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function resolveRequest(requestUrl) {
  let rel = decodeURIComponent(new URL(requestUrl).pathname);
  rel = rel.startsWith(BASE) ? rel.slice(BASE.length) : rel.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(ROOT, rel);
  // Refuse anything that escapes the bundled build, e.g. `..` segments.
  return file.startsWith(ROOT + path.sep) ? file : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links that leave the game (the author's site, DESIGN.md on GitHub) open in
  // the system browser rather than replacing the game in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${SCHEME}://`)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  win.loadURL(START_URL);
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const file = resolveRequest(request.url);
    if (!file) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
