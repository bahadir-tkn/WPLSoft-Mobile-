const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

let mainWindow = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'WPLSoft — Delta DVP PLC',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#ECEEF2',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const bundledEntry = path.resolve(__dirname, 'web-dist', 'index.html');
  mainWindow.loadFile(bundledEntry);

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const expectedUrlPrefix = new URL(`file://${path.dirname(bundledEntry)}/`).href;
    if (!targetUrl.startsWith(expectedUrlPrefix)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(targetUrl)) {
        shell.openExternal(targetUrl);
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
