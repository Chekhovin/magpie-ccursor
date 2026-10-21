// SPDX-License-Identifier: AGPL-3.0-or-later
import { dataDirectory } from './src/connection'
import { superviseBridge } from './src/supervisor'

// Magpie imports every exported function as a plugin: export only this one.
export default async function CCursorPlugin() {
  let supervisor: ReturnType<typeof superviseBridge> | undefined
  return {
    config: async () => { supervisor ??= superviseBridge({ dataDir: dataDirectory(),
      port: process.env.MAGPIE_CCURSOR_PORT ? Number(process.env.MAGPIE_CCURSOR_PORT) : undefined }) },
  }
}
