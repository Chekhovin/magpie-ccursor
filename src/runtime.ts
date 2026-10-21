import { homedir } from 'node:os'
import { join } from 'node:path'
import { resetCatalogCacheForTests } from '../vendor/server/config/catalogStore'
import { clearManagedSkillsCache } from '../vendor/server/config/managedSkillsStore'
import { clearWebToolsCache } from '../vendor/server/config/searchConfigStore'
import { resetBlobCacheForTests } from '../vendor/server/handlers/agent/blobStore'
import { resetCloneRegistryForTests } from '../vendor/server/handlers/agent/cloneRegistry'
import { setDataDir } from '../vendor/server/config/paths'
import { onProvidersChange, resetProvidersCacheForTests, startProvidersWatcher, stopProvidersWatcher } from '../vendor/server/config/providersStore'
import { loadRoutes, onRoutesChange, startRoutesWatcher, stopRoutesWatcher } from '../vendor/server/config/routesStore'
import { resetProviderInstanceCache } from '../vendor/server/handlers/llm/providerRuntime'
import { bumpRefreshSignal, pushRoutesUpdate, startServer, stopServer } from '../vendor/server/index'

let occupied = false

function clearDirectoryCaches(): void {
  resetProviderInstanceCache()
  resetProvidersCacheForTests()
  resetCatalogCacheForTests()
  clearManagedSkillsCache()
  clearWebToolsCache()
  resetBlobCacheForTests()
  resetCloneRegistryForTests()
}

/** One standalone server owns the upstream module state in this process. */
export async function startRuntime({ dataDir = join(homedir(), '.magpie-ccursor'), port = 39831 }: { dataDir?: string, port?: number } = {}): Promise<{ port: number, stop: () => Promise<void> }> {
  if (occupied) throw new Error('Runtime already running or starting')
  occupied = true
  const disposers: Array<() => void> = []
  let stopping: Promise<void> | undefined
  const stop = () => stopping ??= (async () => {
    stopProvidersWatcher()
    stopRoutesWatcher()
    for (const dispose of disposers) dispose()
    try { await stopServer() }
    finally {
      clearDirectoryCaches()
      occupied = false
    }
  })()
  try {
    setDataDir(dataDir)
    clearDirectoryCaches()
    const address = await startServer({ host: '127.0.0.1', port })
    disposers.push(onProvidersChange(() => {
      resetProviderInstanceCache()
      bumpRefreshSignal()
    }))
    disposers.push(onRoutesChange(() => {
      pushRoutesUpdate(loadRoutes().redirect.filter(r => r.startsWith('REST:')).map(r => r.slice(5)))
      bumpRefreshSignal()
    }))
    startProvidersWatcher()
    startRoutesWatcher()
    return { port: address.port, stop }
  }
  catch (error) {
    await stop()
    throw error
  }
}
