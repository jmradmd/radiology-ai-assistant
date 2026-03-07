import { autoUpdater } from 'electron-updater';
import { Notification, dialog } from 'electron';
import { getPopupWindow } from './window';

export function setupAutoUpdater(): void {
  // Don't download automatically - notify user first
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update Available',
        body: `Radiology AI Assistant v${info.version} is available. Click to download.`,
      });

      notification.on('click', () => {
        autoUpdater.downloadUpdate();
      });

      notification.show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);

    dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Restart Now', 'Later'],
        title: 'Update Ready',
        message: `Radiology AI Assistant v${info.version} has been downloaded.`,
        detail: 'Restart the application to apply the update.',
      })
      .then((result) => {
        if (result.response === 0) {
          // User clicked "Restart Now"
          autoUpdater.quitAndInstall(false, true);
        }
      });
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto-updater error:', error);
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('Failed to check for updates:', error);
    });
  }, 10000); // 10 second delay

  // Check periodically (every 4 hours)
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((error) => {
        console.error('Failed to check for updates:', error);
      });
    },
    4 * 60 * 60 * 1000
  );
}

/**
 * Manually trigger update check
 */
export function checkForUpdates(): void {
  autoUpdater.checkForUpdates();
}
