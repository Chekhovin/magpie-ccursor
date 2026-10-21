import { afterEach, expect, test } from 'bun:test'
import { resetProvidersCacheForTests, setProvidersForTests } from '../vendor/server/config/providersStore'
import { defaultAssignedModel, ModelNotFoundError, resolveModel } from '../vendor/server/handlers/models/mapper'
import type { ProvidersConfig } from '../vendor/server/data/defaults'

function assigned(models: Array<{ id: string, apiModel: string, defaultOn?: boolean }>) {
  setProvidersForTests({ $schemaVersion: 1, providers: [{ id: 'magpie', name: 'Magpie', type: 'openai-chat',
    baseUrl: 'http://127.0.0.1:1/v1', auth: { kind: 'apiKey', value: 'fixture-key' },
    models: models.map(model => ({ displayName: model.id, thinking: false, contextTokenLimit: 8192, ...model })),
  }] } as ProvidersConfig)
}
afterEach(resetProvidersCacheForTests)

test('Cursor Auto uses the same enabled default as GetDefaultModel and follows assignment changes', () => {
  assigned([{ id: 'hidden', apiModel: 'must-not-run', defaultOn: false }, { id: 'group/auto', apiModel: 'route-a' }])
  expect(defaultAssignedModel()?.model.id).toBe('group/auto')
  expect(resolveModel('default').apiModel).toBe('route-a')
  assigned([{ id: 'chosen', apiModel: 'route-b' }])
  expect(resolveModel('default').apiModel).toBe('route-b')
  expect(() => resolveModel('removed-model')).toThrow(ModelNotFoundError)
})

test('an explicit assigned default ID wins; empty or disabled assignments never call an unrelated model', () => {
  assigned([{ id: 'first', apiModel: 'first' }, { id: 'default', apiModel: 'explicit-default' }])
  expect(resolveModel('default').apiModel).toBe('explicit-default')
  for (const models of [[], [{ id: 'hidden', apiModel: 'hidden', defaultOn: false }]]) {
    assigned(models)
    expect(() => resolveModel('default')).toThrow('Magpie → Agent → CCursor')
  }
})
