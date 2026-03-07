import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell } from 'electron';
import * as path from 'path';
import Store from 'electron-store';

const store = new Store();
let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  createTray();
  createWindow();
  
  const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
  globalShortcut.register(shortcut, toggleWindow);
  
  registerIpcHandlers();
});

function createTray() {
  // Use empty icon - Electron will show default
  tray = new Tray(path.join(__dirname, '../../assets/tray-icon.png'));
  tray.setToolTip('Radiology AI Assistant');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 500,
    minWidth: 320,
    minHeight: 400,
    maxWidth: 600,
    maxHeight: 800,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('blur', () => mainWindow?.hide());
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    positionWindow();
    mainWindow.show();
    mainWindow.focus();
  }
}

function positionWindow() {
  if (!mainWindow || !tray) return;
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const x = Math.round(trayBounds.x - windowBounds.width / 2 + trayBounds.width / 2);
  const y = process.platform === 'darwin' ? trayBounds.y + trayBounds.height + 4 : trayBounds.y - windowBounds.height - 4;
  mainWindow.setPosition(x, y);
}

function registerIpcHandlers() {
  ipcMain.on('window:hide', () => mainWindow?.hide());
  ipcMain.on('shell:open', (_, url) => shell.openExternal(url));
  ipcMain.handle('store:get', (_, key) => store.get(key));
  ipcMain.handle('store:set', (_, key, value) => { store.set(key, value); return true; });
  ipcMain.handle('store:delete', (_, key) => { store.delete(key); return true; });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
