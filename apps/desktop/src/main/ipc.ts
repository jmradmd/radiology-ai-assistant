import { ipcMain, app, shell, Notification, clipboard } from 'electron';
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  canEncrypt,
  getPreferences,
  setPreferences,
  type Preferences,
} from './store';
import { hidePopup, showPopup } from './window';
import { setTrayIcon } from './tray';

export function registerIpcHandlers(): void {
  // ====== Window Control ======
  ipcMain.on('window:hide', () => {
    hidePopup();
  });

  ipcMain.on('window:close', () => {
    hidePopup();
  });

  ipcMain.on('window:show', () => {
    showPopup();
  });

  // ====== Auth Persistence ======
  ipcMain.handle('auth:get', () => {
    return getAuthToken();
  });

  ipcMain.handle('auth:set', (_, token: string) => {
    return setAuthToken(token);
  });

  ipcMain.handle('auth:clear', () => {
    clearAuthToken();
    return true;
  });

  ipcMain.handle('auth:canEncrypt', () => {
    return canEncrypt();
  });

  // ====== Preferences ======
  ipcMain.handle('preferences:get', () => {
    return getPreferences();
  });

  ipcMain.handle('preferences:set', (_, prefs: Partial<Preferences>) => {
    setPreferences(prefs);
    return true;
  });

  // ====== App Info ======
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  // ====== Shell Operations ======
  ipcMain.on('shell:openExternal', (_, url: string) => {
    // Security: Only allow http(s) and tel: URLs
    if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('tel:')) {
      shell.openExternal(url);
    } else {
      console.warn('Blocked external URL:', url);
    }
  });

  // ====== Notifications ======
  ipcMain.on(
    'notification:show',
    (_, { title, body, urgency }: { title: string; body: string; urgency?: 'normal' | 'critical' }) => {
      if (!Notification.isSupported()) {
        console.warn('Notifications not supported on this platform');
        return;
      }

      const notification = new Notification({
        title,
        body,
        urgency: urgency || 'normal',
      });

      notification.on('click', () => {
        showPopup();
      });

      notification.show();
    }
  );

  // ====== Tray Icon ======
  ipcMain.on('tray:setIcon', (_, iconName: 'default' | 'alert') => {
    setTrayIcon(iconName);
  });

  // ====== Clipboard ======
  ipcMain.handle('clipboard:write', (_, text: string) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('clipboard:read', () => {
    return clipboard.readText();
  });
}
