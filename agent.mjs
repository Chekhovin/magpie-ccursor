// SPDX-License-Identifier: AGPL-3.0-or-later
// Agent configuration is written and restored by Magpie, not by the provider host.
export const agent = {
  id: 'ccursor',
  name: 'CCursor',
  bin: 'cursor',
  dir: '~/.cursor',
  config: '~/.magpie-ccursor/connection.json',
  format: 'json',
  ua: ['magpie-ccursor'],
  notice: 'Start Magpie before Cursor. Select a model inside Cursor. See the CCursor plugin page for first-time setup.',
}

export function connect({ gateway, models }) {
  if (!gateway || typeof gateway.v1 !== 'string' || !gateway.key)
    throw new Error('Magpie did not provide the Agent gateway URL and key.')
  if (!Array.isArray(models))
    throw new Error('Magpie did not provide the Agent model list.')
  return {
    schemaVersion: 1,
    enabled: true,
    // Magpie uses a top-level string equal to its gateway key as the connection marker.
    apiKey: gateway.key,
    baseUrl: gateway.v1,
    gateway: { v1: gateway.v1, key: gateway.key },
    models: models.map(({ id, name, context, output, images, efforts }) => ({
      id, name, context, output, images, efforts,
    })),
  }
}
