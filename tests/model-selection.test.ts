import { afterEach, expect, test } from 'bun:test'
import { resetProvidersCacheForTests, setProvidersForTests } from '../vendor/server/config/providersStore'
import { defaultAssignedModel, ModelNotFoundError, resolveModel } from '../vendor/server/handlers/models/mapper'
import type { ProvidersConfig } from '../vendor/server/data/defaults'
import { resolveRequestedModelId } from '../vendor/server/handlers/models/requestedModelId'
import { buildByokAvailableModels } from '../vendor/server/handlers/models/byokModelBuilder'
import { handleGetDefaultModel } from '../vendor/server/services/core/AiService'

function assigned(models: Array<{ id: string, apiModel: string, defaultOn?: boolean }>) {
  setProvidersForTests({ $schemaVersion: 1, providers: [{ id: 'magpie', name: 'Magpie', type: 'openai-chat',
    baseUrl: 'http://127.0.0.1:1/v1', auth: { kind: 'apiKey', value: 'fixture-key' },
    models: models.map(model => ({ displayName: model.id, thinking: false, contextTokenLimit: 8192, ...model })),
  }] } as ProvidersConfig)
}
afterEach(resetProvidersCacheForTests)

test('Cursor Auto uses the same enabled default as GetDefaultModel and follows assignment changes', () => {
  assigned([{ id: 'hidden', apiModel: 'must-not-run', defaultOn: false }, { id: 'group/auto', apiModel: 'route-a', defaultOn: true }])
  expect(defaultAssignedModel()?.model.id).toBe('group/auto')
  expect(resolveModel('default').apiModel).toBe('route-a')
  assigned([{ id: 'chosen', apiModel: 'route-b', defaultOn: true }])
  expect(resolveModel('default').apiModel).toBe('route-b')
  expect(() => resolveModel('removed-model')).toThrow(ModelNotFoundError)
})

test('an explicit assigned default ID wins; empty or disabled assignments never call an unrelated model', () => {
  assigned([{ id: 'first', apiModel: 'first', defaultOn: true }, { id: 'default', apiModel: 'explicit-default', defaultOn: true }])
  expect(resolveModel('default').apiModel).toBe('explicit-default')
  for (const models of [[], [{ id: 'hidden', apiModel: 'hidden', defaultOn: false }], [{ id: 'unset', apiModel: 'unset' }]]) {
    assigned(models)
    for (const alias of ['default', 'auto', '', ' AUTO '])
      expect(() => resolveModel(alias)).toThrow('Magpie → Agent → CCursor')
  }
})

test('all Cursor 3.27 Auto aliases share an explicitly enabled default; exact assignments win', async () => {
  assigned([{ id: 'unset', apiModel: 'unset' }, { id: 'chosen', apiModel: 'route', defaultOn: true }])
  for (const alias of ['default', 'auto', '', ' AUTO ', undefined, null]) {
    expect(resolveRequestedModelId(alias)).toBe('chosen')
    expect(resolveModel(alias as any).apiModel).toBe('route')
  }
  expect((await handleGetDefaultModel()).model).toBe('chosen')
  const catalog = buildByokAvailableModels()
  expect(catalog.find(m => m.name === 'unset')?.defaultOn).toBe(false)
  expect(catalog.find(m => m.name === 'chosen')?.defaultOn).toBe(true)
  assigned([{ id: 'chosen', apiModel: 'route', defaultOn: true }, { id: 'auto', apiModel: 'literal-auto', defaultOn: true }])
  expect(resolveRequestedModelId('auto')).toBe('auto')
  expect(resolveModel('auto').apiModel).toBe('literal-auto')
  expect(() => resolveModel('unknown')).toThrow(ModelNotFoundError)
})
