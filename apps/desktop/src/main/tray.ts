import { Tray, Menu, nativeImage, app, shell } from 'electron';
import path from 'path';

let tray: Tray | null = null;

interface TrayConfig {
  onLeftClick: () => void;
}

export function createTray(config: TrayConfig): void {
  const assetsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  let icon: Electron.NativeImage;

  if (process.platform === 'darwin') {
    // macOS: Use template image that adapts to menu bar theme
    const iconPath = path.join(assetsPath, 'tray-icon-Template.png');
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback: create a simple icon if file doesn't exist
      icon = createFallbackIcon();
    }
    icon.setTemplateImage(true);
  } else {
    // Windows/Linux: Use regular icon
    const iconPath = path.join(assetsPath, 'tray-icon.png');
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = createFallbackIcon();
    }
  }

  tray = new Tray(icon);
  tray.setToolTip('Radiology AI Assistant Protocol Assistant');

  // Left click opens popup
  tray.on('click', config.onLeftClick);

  // Right click shows context menu
  tray.on('right-click', () => {
    showContextMenu(config.onLeftClick);
  });
}

function showContextMenu(onOpen: () => void): void {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Radiology AI Assistant',
      click: onOpen,
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => {
        shell.openExternal(process.env.APP_BASE_URL || 'http://localhost:3000');
      },
    },
    { type: 'separator' },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          openAsHidden: true,
        });
      },
    },
    { type: 'separator' },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
    },
    {
      label: 'Quit Radiology AI Assistant',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray?.popUpContextMenu(contextMenu);
}

export function getTrayBounds(): Electron.Rectangle {
  return tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export function setTrayIcon(name: 'default' | 'alert'): void {
  if (!tray) return;

  const assetsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  let iconFile: string;
  if (process.platform === 'darwin') {
    iconFile = name === 'alert' ? 'tray-icon-alert-Template.png' : 'tray-icon-Template.png';
  } else {
    iconFile = name === 'alert' ? 'tray-icon-alert.png' : 'tray-icon.png';
  }

  const iconPath = path.join(assetsPath, iconFile);
  let icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    icon = createFallbackIcon();
  }

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray.setImage(icon);
}

// Create a simple fallback icon when assets don't exist (dev mode)
function createFallbackIcon(): Electron.NativeImage {
  // Create a simple 16x16 teal-colored icon
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4); // RGBA

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Draw a simple circle
      const dx = x - size / 2;
      const dy = y - size / 2;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < size / 2 - 1) {
        // Teal color (#14b8a6)
        canvas[idx] = 0x14; // R
        canvas[idx + 1] = 0xb8; // G
        canvas[idx + 2] = 0xa6; // B
        canvas[idx + 3] = 0xff; // A
      } else {
        // Transparent
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}
