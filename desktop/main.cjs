const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("node:path");
const { Runtime } = require("./runtime.cjs");
const { backupData } = require("./backup.cjs");
app.setName("Albertelli Design Studio");
let win,
  runtime,
  working = false,
  cleaned = false;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", (event) => {
    if (runtime && !cleaned) {
      event.preventDefault();
      cleaned = true;
      runtime.stop().finally(() => app.exit(0));
    }
  });
  app
    .whenReady()
    .then(start)
    .catch(async (e) => {
      dialog.showErrorBox("Avvio non riuscito", e.message);
      if (runtime) await runtime.stop();
      cleaned = true;
      app.quit();
    });
}
async function start() {
  const userDir = app.getPath("userData");
  const dataDir = path.join(userDir, "data");
  const logsDir = path.join(userDir, "logs");
  runtime = new Runtime({
    resources: app.isPackaged
      ? process.resourcesPath
      : path.join(__dirname, "staged"),
    dataDir,
    logsDir,
    electronNode: true,
  });
  const url = await runtime.start();
  win = new BrowserWindow({
    width: 1500,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: "#f7f6f1",
    title: "Albertelli Design Studio",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      partition: "persist:studio-local",
    },
  });
  const session = win.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (new URL(details.url).origin === runtime.webUrl)
      details.requestHeaders["x-studio-desktop-ui"] = runtime.uiToken;
    callback({ requestHeaders: details.requestHeaders });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    if (new URL(details.url).origin === runtime.webUrl)
      headers["Content-Security-Policy"] = [
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'",
      ];
    callback({ responseHeaders: headers });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== runtime.webUrl) event.preventDefault();
  });
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Continua a lavorare", "Chiudi senza salvare"],
      defaultId: 0,
      cancelId: 0,
      message: "Ci sono modifiche non salvate. Vuoi chiudere?",
    });
    if (choice === 1) event.preventDefault();
  });
  session.on("will-download", (_event, item) =>
    item.setSaveDialogOptions({
      defaultPath: path.join(
        app.getPath("downloads"),
        path.basename(item.getFilename()),
      ),
    }),
  );
  win.once("ready-to-show", () => win.show());
  watchChildren();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Studio",
        submenu: [
          {
            label: "Crea backup dei dati…",
            click: () => createBackup(dataDir),
          },
          { label: "Apri cartella dati", click: () => shell.openPath(dataDir) },
          { label: "Apri cartella log", click: () => shell.openPath(logsDir) },
          { type: "separator" },
          { label: "Esci", accelerator: "Alt+F4", click: () => win.close() },
        ],
      },
      {
        label: "Modifica",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "Visualizza",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Informazioni",
        click: () =>
          dialog.showMessageBox(win, {
            message: "Albertelli Design Studio",
            detail:
              "Versione " +
              app.getVersion() +
              " · prototipo locale DEMO\nProgetti e campioni restano sul computer. Le proposte sono dimostrative, senza IA esterna.",
          }),
      },
    ]),
  );
  await win.loadURL(url);
}
function watchChildren() {
  for (const child of runtime.children)
    child.on("exit", () => {
      if (!runtime.stopping && !working && !cleaned) {
        dialog.showErrorBox(
          "Componente arrestato",
          "Un componente locale si è arrestato. Chiudi e riapri lo studio; i progetti salvati rimangono disponibili.",
        );
        win?.close();
      }
    });
}
async function createBackup(dataDir) {
  if (working) return;
  const confirmation = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Annulla", "Continua"],
    defaultId: 0,
    cancelId: 0,
    message: "Backup dei progetti salvati",
    detail:
      "Salva prima le modifiche aperte. Durante il backup lo studio viene riavviato e le modifiche non salvate andranno perse. Il backup contiene database, campioni e chiave locale: conservalo in un luogo privato.",
  });
  if (confirmation.response !== 1) return;
  const selected = await dialog.showOpenDialog(win, {
    title: "Scegli dove salvare il backup",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled) return;
  working = true;
  try {
    // Prevent any renderer write during the offline copy.
    await win.loadURL("about:blank");
    await runtime.stop();
    const destination = await backupData(dataDir, selected.filePaths[0]);
    await runtime.start();
    watchChildren();
    await win.loadURL(runtime.webUrl);
    await dialog.showMessageBox(win, {
      message: "Backup completato",
      detail: destination,
    });
  } catch (e) {
    dialog.showErrorBox("Backup non completato", e.message);
    if (!runtime.children.length) {
      try {
        await runtime.start();
        await win.loadURL(runtime.webUrl);
      } catch (startError) {
        dialog.showErrorBox("Riavvio non riuscito", startError.message);
        win.close();
      }
    }
  } finally {
    working = false;
  }
}
