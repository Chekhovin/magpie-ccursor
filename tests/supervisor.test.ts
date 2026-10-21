import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { superviseBridge } from '../src/supervisor'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
test('supervisor recovers from spawn failure and unexpected exit, then cancels retry on stop', async () => {
  const instances: any[] = [], logs: string[] = []
  let calls = 0
  const spawnProcess: any = () => {
    calls++
    if (calls === 1) throw new Error('fixture spawn failure')
    const child: any = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: () => child.emit('close', 0) }
    instances.push(child)
    return child
  }
  const supervisor = superviseBridge({ dataDir: 'unused-fixture', restartDelay: 5, spawnProcess, log: m => logs.push(m) })
  try {
    await sleep(30)
    expect(instances.length).toBe(1)
    instances[0].emit('close', 1)
    await sleep(35)
    expect(instances.length).toBe(2)
    instances[1].emit('error', new Error('fixture process error'))
    instances[1].emit('close', -1)
    supervisor.stop()
    await sleep(50)
    expect(instances.length).toBe(2)
    expect(logs.some(l => l.includes('fixture spawn failure'))).toBe(true)
  } finally { supervisor.stop() }
})
