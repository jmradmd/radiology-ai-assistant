import { BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { getTrayBounds } from './tray';

let popupWindow: BrowserWindow | null = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 600;

export async function createPopupWindow(): Promise<BrowserWindow> {
  popupWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    transparent: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the renderer
  if (app.isPackaged) {
    await popupWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  } else {
    // Development: load from Vite dev server
    await popupWindow.loadURL('http://localhost:5173');
    // Open DevTools in detached mode for debugging
    // popupWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Hide on blur (click outside)
  popupWindow.on('blur', () => {
    // Small delay to prevent accidental hide when clicking within app
    setTimeout(() => {
      if (popupWindow && !popupWindow.isFocused()) {
        hidePopup();
      }
    }, 100);
  });

  // Prevent window from being closed, just hide it
  popupWindow.on('close', (e) => {
    e.preventDefault();
    hidePopup();
  });

  return popupWindow;
}

export function getPopupWindow(): BrowserWindow | null {
  return popupWindow;
}

export function showPopup(): void {
  if (!popupWindow) return;

  const position = calculatePosition();
  popupWindow.setPosition(position.x, position.y, false);
  popupWindow.show();
  popupWindow.focus();

  // Notify renderer that window is shown (for input focus)
  popupWindow.webContents.send('window:shown');
}

export function hidePopup(): void {
  if (!popupWindow) return;
  popupWindow.hide();
}

function calculatePosition(): { x: number; y: number } {
  const trayBounds = getTrayBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });
  const workArea = display.workArea;
  const bounds = display.bounds;

  let x: number;
  let y: number;

  if (process.platform === 'darwin') {
    // macOS: Menu bar is at top, popup appears below tray
    x = Math.round(trayBounds.x - WINDOW_WIDTH / 2 + trayBounds.width / 2);
    y = trayBounds.y + trayBounds.height + 4;

    // Keep within screen bounds
    x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - WINDOW_WIDTH - 8));
  } else {
    // Windows/Linux: Detect taskbar position based on workArea difference
    const taskbarOnBottom = workArea.height < bounds.height && workArea.y === bounds.y;
    const taskbarOnTop = workArea.y > bounds.y;
    const taskbarOnRight = workArea.width < bounds.width && workArea.x === bounds.x;
    const taskbarOnLeft = workArea.x > bounds.x;

    if (taskbarOnBottom) {
      // Most common: taskbar at bottom
      x = Math.min(trayBounds.x, workArea.x + workArea.width - WINDOW_WIDTH - 8);
      y = workArea.y + workArea.height - WINDOW_HEIGHT - 8;
    } else if (taskbarOnTop) {
      // Taskbar at top
      x = Math.min(trayBounds.x, workArea.x + workArea.width - WINDOW_WIDTH - 8);
      y = workArea.y + 8;
    } else if (taskbarOnRight) {
      // Taskbar on right
      x = workArea.x + workArea.width - WINDOW_WIDTH - 8;
      y = Math.min(trayBounds.y, workArea.y + workArea.height - WINDOW_HEIGHT - 8);
    } else if (taskbarOnLeft) {
      // Taskbar on left
      x = workArea.x + 8;
      y = Math.min(trayBounds.y, workArea.y + workArea.height - WINDOW_HEIGHT - 8);
    } else {
      // Fallback: bottom-right corner
      x = workArea.x + workArea.width - WINDOW_WIDTH - 8;
      y = workArea.y + workArea.height - WINDOW_HEIGHT - 8;
    }
  }

  return { x: Math.round(x), y: Math.round(y) };
}
