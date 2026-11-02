// SPDX-License-Identifier: AGPL-3.0-or-later
import { dataDirectory } from './src/connection'
import { saveLocalizationOption } from './src/plugin-options'
import { superviseBridge } from './src/supervisor'

// Magpie imports every exported function as a plugin: export only this one.
export default async function CCursorPlugin(_input?: unknown, options?: { localize?: boolean }) {
  const dataDir = dataDirectory()
  let supervisor: ReturnType<typeof superviseBridge> | undefined
  return {
    config: async () => {
      // The host reloads options while a supervised daemon may still be running.
      await saveLocalizationOption(dataDir, options)
      supervisor ??= superviseBridge({ dataDir,
        port: process.env.MAGPIE_CCURSOR_PORT ? Number(process.env.MAGPIE_CCURSOR_PORT) : undefined })
    },
  }
}
