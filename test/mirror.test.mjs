// 冒烟：YmDb 镜像替换 + 订阅命中 + marks
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { YmDb } from '../lib/db.js'
import { dispatchFresh } from '../lib/notify.js'
import { parseManifest } from '../lib/sync.js'

const dir = mkdtempSync(join(tmpdir(), 'ym-'))
const db = new YmDb(dir)

const item = (id, over = {}) => ({
  id, siteId: 1, slug: id, title: `T${id}`, summary: 's', content: null,
  category: 'ai', platform: 'P', claimType: 'direct', quota: '$1',
  deadline: '2099-01-01', officialUrl: `https://x/${id}`, outboundUrl: null,
  sourceUrl: null, sourceName: 't', trusted: false, breaking: false,
  status: 'active', views: 0, clicks: 0, publishedAt: '2026-01-01T00:00:00Z',
  ...over,
})

test('mirror: insert + fresh ids + replace', () => {
  const f1 = db.mirrorSnapshot([item('a'), item('b')])
  assert.deepEqual(f1.sort(), ['a', 'b'])
  const f2 = db.mirrorSnapshot([item('b'), item('c')])
  assert.deepEqual(f2, ['c'])          // b 已有不重复，a 被删缺失
  assert.equal(db.getItem('a'), undefined)
  assert.ok(db.getItem('c'))
})

test('marks + tabs', () => {
  db.setMark('c', { claimed: true })
  assert.equal(db.query({ tab: 'claimed' }).total, 1)
  db.setMark('c', { hidden: true })
  assert.equal(db.query({ tab: 'hidden' }).total, 1)
  const all = db.query({ tab: 'all' })
  assert.equal(all.total, 1)                       // b 还在
  assert.deepEqual(all.items.map(i => i.id), ['b']) // c 被 hidden 排除
})

test('notify: 订阅命中 + 突发 + 基线静默', () => {
  const sent = []
  const notify = (t, b) => sent.push(t)
  // 基线轮不推
  dispatchFresh(db, [item('n1', { breaking: true })], ['n1'], true, notify)
  assert.equal(sent.length, 0)
  // 突发广播
  dispatchFresh(db, [item('n2', { breaking: true, title: 'OpenAI 大放送' })], ['n2'], false, notify)
  assert.equal(sent.length, 1)
  // 关键词订阅
  db.addSub(['openai'], [])
  dispatchFresh(db, [item('n3', { title: 'OpenAI 新免费额度' })], ['n3'], false, notify)
  assert.equal(sent.length, 2)
  // 去重：同 item 同 sub 不再推
  dispatchFresh(db, [item('n3', { title: 'OpenAI 新免费额度' })], ['n3'], false, notify)
  assert.equal(sent.length, 2)
})

test('manifest parse', () => {
  const m = parseManifest('rev=42\ndatarev=42\npending=3\nactive=10\nbreaking=1\nchannels=ai,vps\n')
  assert.equal(m.rev, 42); assert.equal(m.datarev, 42)
  assert.equal(m.pending, 3); assert.deepEqual(m.channels, ['ai', 'vps'])
})

after(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
