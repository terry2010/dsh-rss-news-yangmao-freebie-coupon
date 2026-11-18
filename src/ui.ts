/**
 * 看板挂载：静态页 /dsh-rss-news-yangmao-freebie-coupon/ + 本地 JSON API。
 * 与主插件同一套 webServer 路由惯例（kind + sameSite 防护 + json CT 要求）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { YmDb } from './db.js'
import type { Syncer, SyncConfig } from './sync.js'
import type { SubmissionTracker } from './submissions.js'

const BASE = '/dsh-rss-news-yangmao-freebie-coupon'

interface Req {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  on(event: 'data', cb: (chunk: Buffer | string) => void): unknown
  on(event: 'end', cb: () => void): unknown
}
interface Res {
  statusCode: number
  setHeader(k: string, v: string): void
  end(b?: string | Buffer): void
}
export interface WebServerLike {
  register(opts: { kind: string; path: string; handler: (req: Req, res: Res) => void }): () => void
}
type Log = { info(msg: string): void; warn?(msg: string): void }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function sameSite(req: Req): boolean {
  return String(req.headers?.['sec-fetch-site'] || '').toLowerCase() !== 'cross-site'
}
async function serveStatic(res: Res, rel: string): Promise<void> {
  const webDir = join(fileURLToPath(new URL('.', import.meta.url)), 'web')
  const safe = rel.split('?')[0].replace(/^\/+|\.{2,}/g, '') || 'index.html'
  const file = join(webDir, safe)
  try {
    const body = await readFile(file)
    res.statusCode = 200
    res.setHeader('content-type', MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
}
function readBody(req: Req): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (c) => { s += c; if (s.length > 16384) reject(new Error('body too large')) })
    req.on('end', () => resolve(s))
  })
}
const json = (res: Res, code: number, body: unknown) => {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
const jsonCt = (req: Req) => String(req.headers?.['content-type'] || '').includes('application/json')

export interface UiDeps {
  db: YmDb
  syncer: Syncer
  tracker: SubmissionTracker
  cfg: { get(): SyncConfig & { syncSec: number }; set(patch: Partial<SyncConfig & { syncSec: number }>): void }
  manualSync: () => void
}

export function mountUi(ws: WebServerLike, log: Log, deps: UiDeps): () => void {
  const { db, syncer, tracker, cfg } = deps
  const guard = (fn: (req: Req, res: Res) => void | Promise<void>) => (req: Req, res: Res): Promise<void> => {
    if (!sameSite(req)) { res.statusCode = 403; res.end('forbidden'); return Promise.resolve() }
    return Promise.resolve(fn(req, res)).catch((e) => {
      log.warn?.(`api error: ${(e as Error).message}`)
      res.statusCode = 500; res.end('error')
    })
  }
  const disposers = [
    ws.register({ kind: 'exact', path: `${BASE}/`, handler: guard((_q, r) => serveStatic(r, 'index.html')) }),
    ws.register({ kind: 'exact', path: BASE, handler: guard((_q, r) => serveStatic(r, 'index.html')) }),
    ws.register({ kind: 'prefix', path: `${BASE}/web`, handler: guard((q, r) => serveStatic(r, (q.url || '').replace(`${BASE}/web/`, ''))) }),

    // ---- 条目 ----
    ws.register({
      kind: 'exact', path: `${BASE}/api/items`,
      handler: guard((req, res) => {
        const sp = new URL(req.url || '', 'http://x').searchParams
        const r = db.query({
          tab: (sp.get('tab') || 'all') as 'all',
          q: sp.get('q') || undefined,
          channel: sp.get('channel') || undefined,
          page: Number(sp.get('page')) || 1,
          pageSize: Number(sp.get('pageSize')) || 50,
        })
        const items = r.items.map((it) => ({
          id: it.id, slug: it.slug, title: it.title, summary: it.summary,
          category: it.category, platform: it.platform, claimType: it.claim_type,
          quota: it.quota, deadline: it.deadline,
          officialUrl: it.official_url, outboundUrl: it.outbound_url,
          sourceUrl: it.source_url, sourceName: it.source_name,
          trusted: it.trusted, breaking: it.breaking,
          views: it.views, clicks: it.clicks, publishedAt: it.published_at,
          marks: { claimed: !!it.claimed, favorite: !!it.favorite, hidden: !!it.hidden },
          hit: !!it.hit,
        }))
        json(res, 200, { ok: true, total: r.total, items, counts: db.counts(), channels: db.channelList() })
      }),
    }),

    // ---- 标记 ----
    ws.register({
      kind: 'exact', path: `${BASE}/api/marks`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST' || !jsonCt(req)) return json(res, 403, { error: 'json content-type required' })
        const b = JSON.parse((await readBody(req)) || '{}') as { id?: string; claimed?: boolean; favorite?: boolean; hidden?: boolean }
        if (!b.id) return json(res, 400, { error: 'id required' })
        db.setMark(b.id, { claimed: b.claimed, favorite: b.favorite, hidden: b.hidden })
        json(res, 200, { ok: true, counts: db.counts() })
      }),
    }),

    // ---- 状态 ----
    ws.register({
      kind: 'exact', path: `${BASE}/api/status`,
      handler: guard((_req, res) => json(res, 200, {
        ...syncer.status(), counts: db.counts(), channels: db.channelList(),
        cfg: cfg.get(),
      })),
    }),

    // ---- 订阅 ----
    ws.register({
      kind: 'exact', path: `${BASE}/api/subs`,
      handler: guard(async (req, res) => {
        if (req.method === 'GET') return json(res, 200, { items: db.subs() })
        if (req.method === 'DELETE') {
          const sp = new URL(req.url || '', 'http://x').searchParams
          db.delSub(Number(sp.get('id')))
          return json(res, 200, { ok: true })
        }
        if (req.method === 'POST') {
          if (!jsonCt(req)) return json(res, 403, { error: 'json content-type required' })
          const b = JSON.parse((await readBody(req)) || '{}') as {
            id?: number; keywords?: string[] | string; channels?: string[]; enabled?: boolean; _del?: boolean
          }
          const kws = Array.isArray(b.keywords) ? b.keywords.map(String)
            : String(b.keywords ?? '').split(/[,，\s]+/).filter(Boolean)
          if (b._del && b.id) { db.delSub(b.id); return json(res, 200, { ok: true }) }
          if (b.id) {
            db.setSub(b.id, { keywords: kws, channels: b.channels, enabled: b.enabled })
            return json(res, 200, { ok: true })
          }
          const id = db.addSub(kws, b.channels ?? [])
          return json(res, 201, { ok: true, id })
        }
        return json(res, 405, { error: 'method' })
      }),
    }),

    // ---- 投稿 ----
    ws.register({
      kind: 'exact', path: `${BASE}/api/submit`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST' || !jsonCt(req)) return json(res, 403, { error: 'json content-type required' })
        const b = JSON.parse((await readBody(req)) || '{}') as { url?: string; note?: string; notifyEmail?: string }
        if (!b.url || !/^https?:\/\//i.test(b.url)) return json(res, 400, { error: 'url required' })
        const r = await tracker.submit(b.url, b.note?.slice(0, 500) ?? null, b.notifyEmail?.slice(0, 200) ?? null)
        json(res, r.ok ? 202 : 400, r)
      }),
    }),
    ws.register({
      kind: 'exact', path: `${BASE}/api/track`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST' || !jsonCt(req)) return json(res, 403, { error: 'json content-type required' })
        const b = JSON.parse((await readBody(req)) || '{}') as { id?: string }
        if (!b.id) return json(res, 400, { error: 'id required' })
        json(res, 200, tracker.track(b.id.trim()))
      }),
    }),
    ws.register({
      kind: 'exact', path: `${BASE}/api/submissions`,
      handler: guard((req, res) => {
        if (req.method === 'DELETE') {
          const id = new URL(req.url || '', 'http://x').searchParams.get('id') ?? ''
          db.removeSubmission(id)
          return json(res, 200, { ok: true })
        }
        json(res, 200, { items: db.submissions() })
      }),
    }),

    // ---- 设置 + 手动同步 ----
    ws.register({
      kind: 'exact', path: `${BASE}/api/settings`,
      handler: guard(async (req, res) => {
        if (req.method === 'GET') return json(res, 200, cfg.get())
        if (req.method !== 'POST' || !jsonCt(req)) return json(res, 403, { error: 'json content-type required' })
        const b = JSON.parse((await readBody(req)) || '{}') as { apiBase?: string; dataBase?: string; syncSec?: number }
        const patch: Partial<SyncConfig & { syncSec: number }> = {}
        if (b.apiBase && /^https?:\/\//.test(b.apiBase)) patch.apiBase = b.apiBase.replace(/\/+$/, '')
        if (b.dataBase && /^https?:\/\//.test(b.dataBase)) patch.dataBase = b.dataBase.replace(/\/+$/, '')
        if (b.syncSec && b.syncSec >= 30 && b.syncSec <= 3600) patch.syncSec = Math.floor(b.syncSec)
        cfg.set(patch)
        json(res, 200, { ok: true, ...cfg.get() })
      }),
    }),
    ws.register({
      kind: 'exact', path: `${BASE}/api/sync`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST' || !jsonCt(req)) return json(res, 403, { error: 'json content-type required' })
        deps.manualSync()
        json(res, 202, { ok: true })
      }),
    }),
  ]
  log.info(`yangmao board mounted at ${BASE}/`)
  return () => { for (const d of disposers) d() }
}
