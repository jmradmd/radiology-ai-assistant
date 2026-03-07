const { notarize } = require('@electron/notarize');
const path = require('path');

/**
 * Notarize the macOS app after packaging
 * This script is called by electron-builder after the app is signed
 * 
 * Required environment variables:
 * - APPLE_ID: Your Apple Developer account email
 * - APPLE_ID_PASSWORD: App-specific password (generate at appleid.apple.com)
 * - APPLE_TEAM_ID: Your Apple Developer Team ID
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization - not macOS');
    return;
  }

  // Check for required credentials
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization - missing credentials');
    console.log('  APPLE_ID:', appleId ? 'set' : 'missing');
    console.log('  APPLE_ID_PASSWORD:', appleIdPassword ? 'set' : 'missing');
    console.log('  APPLE_TEAM_ID:', teamId ? 'set' : 'missing');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);
  console.log('  Apple ID:', appleId);
  console.log('  Team ID:', teamId);

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
