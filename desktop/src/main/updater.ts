// Auto-update (electron-updater → GitHub Releases). Same pattern as
// Void-Shield v1.2.0. Dev/unpackaged builds skip; failures are quiet —
// the shell must never die for an update's sake.

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export function initUpdater(log: (line: string) => void): void {
  if (!app.isPackaged) {
    log('[update] dev build — auto-update disabled')
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (i) => log(`[update] v${i.version} available — downloading`))
  autoUpdater.on('update-downloaded', (i) => log(`[update] v${i.version} ready — applies on quit`))
  autoUpdater.on('error', (e) => log(`[update] ${e.message}`))
  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => {
      /* surfaced via the error event */
    })
  }
  setTimeout(check, 20_000).unref()
  setInterval(check, 6 * 60 * 60 * 1000).unref()
}
