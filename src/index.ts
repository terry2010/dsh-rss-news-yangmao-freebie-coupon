/**
 * dsh-rss-news-yangmao-freebie-coupon 插件入口（每日羊毛）。
 *
 * 契约（cordis bundle）：
 *  - name    'rss-news-yangmao'（cordis.patch.yml id 一致）
 *  - inject  []（rndSources 内部动态等待——主插件后装自动激活）
 *  - apply   同步层（manifest→items.json 镜像）+ 看板视图 + 订阅推送 + 投稿跟踪 + 快报供给
 *
 * 纯公开客户端：只调 manifest.txt（公开）+ items.json（CF 静态），零凭证。
 * 存储独立：items 镜像 + marks/subs/submissions 全在 companions/rss-news-yangmao/yangmao.db。
 */
import type { Context } from '@deepseek-ai/cordis'

import { YmDb, resolveDataDir } from './db.js'
import { Syncer, DEFAULT_API, DEFAULT_DATA, type SyncConfig } from './sync.js'
import { dispatchFresh } from './notify.js'
import { SubmissionTracker } from './submissions.js'
import { briefDef, briefItems } from './brief.js'
import { mountUi, type WebServerLike } from './ui.js'

export const name = 'rss-news-yangmao'
export const inject: string[] = []

const SYNC_DEFAULT_SEC = 60
const SUB_TRACK_MS = 10 * 60_000

interface Cfg extends SyncConfig { syncSec: number }

export function apply(ctx: Context) {
  const log = ctx.logger('yangmao')
  if (!hasService(ctx, 'rndSources')) {
    log.warn('每日羊毛依赖主插件 dsh-rss-news-daily（rndSources 服务）：请先安装主插件；装上后自动激活')
  }
  ctx.inject(['rndSources'], (c) => bootstrap(c, log))
}

function hasService(ctx: Context, name: string): boolean {
  try { return !!(ctx as unknown as Record<string, unknown>)[name] } catch { return false }
}

function bootstrap(ctx: Context, log: ReturnType<Context['logger']>) {
  if (ctx.rndSources.apiVersion < 1) {
    log.warn('rndSources apiVersion < 1; yangmao inert (upgrade dsh-rss-news-daily)')
    return
  }

  const db = new YmDb()
  const notify = (t: string, b: string, p?: string) => ctx.rndSources.notify(t, b, p)

  // ---- 配置（meta 持久化，UI 可改） ----
  const cfg: Cfg = {
    get apiBase() { return db.meta('apiBase') ?? DEFAULT_API },
    set apiBase(v: string) { db.setMeta('apiBase', v) },
    get dataBase() { return db.meta('dataBase') ?? DEFAULT_DATA },
    set dataBase(v: string) { db.setMeta('dataBase', v) },
    get syncSec() { return Number(db.meta('syncSec') ?? SYNC_DEFAULT_SEC) || SYNC_DEFAULT_SEC },
    set syncSec(v: number) { db.setMeta('syncSec', String(v)) },
  }
  const cfgHandle = {
    get: (): Cfg => ({ apiBase: cfg.apiBase, dataBase: cfg.dataBase, syncSec: cfg.syncSec }),
    set: (patch: Partial<Cfg>) => {
      if (patch.apiBase) cfg.apiBase = patch.apiBase
      if (patch.dataBase) cfg.dataBase = patch.dataBase
      if (patch.syncSec) { cfg.syncSec = patch.syncSec; rearm() }
    },
  }

  // ---- 同步器 ----
  const syncer = new Syncer(db, () => cfgHandle.get(), (items, freshIds, baseline) => {
    dispatchFresh(db, items, freshIds, baseline, notify)
    if (baseline) log.info(`baseline mirror done: ${items.length} items (no notifications)`)
    else if (freshIds.length) log.info(`mirror +${freshIds.length} fresh items`)
  })
  const tracker = new SubmissionTracker(db, () => cfg.apiBase, notify)

  // ---- 定时器 ----
  let syncTimer: ReturnType<typeof setInterval> | null = null
  const rearm = () => {
    if (syncTimer) clearInterval(syncTimer)
    syncTimer = setInterval(() => { void syncer.tick() }, cfg.syncSec * 1000)
    syncTimer.unref?.()
  }
  rearm()
  void syncer.tick()
  const subTimer = setInterval(() => { void tracker.tick() }, SUB_TRACK_MS)
  subTimer.unref?.()
  setTimeout(() => void tracker.tick(), 15_000).unref?.()

  // 卸载通道：历史若注入过主库则清（本插件不进主库，防御性调用）
  void ctx.rndSources.removeSources(name).then((n) => {
    if (n) log.info(`cleaned ${n} legacy source(s) from main store`)
  })

  // 阅读器「每日羊毛」tab
  ctx.rndSources.registerView(name, { id: 'yangmao', title: '每日羊毛', url: '/dsh-rss-news-yangmao-freebie-coupon/' })

  // 「羊毛日报」快报类型（apiVersion≥2）
  if (ctx.rndSources.apiVersion >= 2) {
    ctx.rndSources.registerBriefType(name, briefDef(), { items: async (since) => briefItems(db, since) })
  } else {
    log.warn('rndSources apiVersion < 2: 羊毛日报未注册（升级 dsh-rss-news-daily）')
  }

  ctx.inject(['webServer'], (c) => {
    const dispose = mountUi(
      (c as unknown as { webServer: WebServerLike }).webServer, log,
      { db, syncer, tracker, cfg: cfgHandle, manualSync: () => void syncer.tick() },
    )
    c.effect(() => dispose)
  })
  ctx.effect(() => () => {
    if (syncTimer) clearInterval(syncTimer)
    clearInterval(subTimer)
    db.close()
  })
  log.info(`yangmao: manifest ${cfg.syncSec}s poll, board at /dsh-rss-news-yangmao-freebie-coupon/, db=${resolveDataDir()}`)
}
