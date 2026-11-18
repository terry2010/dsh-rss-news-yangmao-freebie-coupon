/**
 * 同步层：manifest.txt 60s 轮询 → datarev 门控 → items.json 全量镜像
 *
 * 门控（与站点契约一致）：
 *   rev      = 服务端内容版本（任何公开面变更 +1）
 *   datarev  = CI 最近 ack 的 items.json 对应 rev
 *   datarev==rev 且 datarev>本地已拉 rev → 拉 items.json 整镜像替换
 *   datarev<rev → 数据发布中，等待下轮（UI 显示「数据发布中」）
 */
import type { MirrorItem, YmDb } from './db.js'

export interface Manifest {
  rev: number; datarev: number; ts: number;
  pending: number; active: number; breaking: number;
  channels: string[]; api: string; data: string; go: string; site: string;
}

export interface SyncConfig { apiBase: string; dataBase: string }
export const DEFAULT_API = 'https://api.chuishiban.com'
export const DEFAULT_DATA = 'https://data.chuishiban.com'

async function fetchText(url: string, timeout = 15_000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export function parseManifest(text: string): Manifest | null {
  const kv: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  if (!kv.rev) return null
  return {
    rev: Number(kv.rev) || 0,
    datarev: Number(kv.datarev) || 0,
    ts: Number(kv.ts) || 0,
    pending: Number(kv.pending) || 0,
    active: Number(kv.active) || 0,
    breaking: Number(kv.breaking) || 0,
    channels: (kv.channels ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    api: kv.api ?? '', data: kv.data ?? '', go: kv.go ?? '', site: kv.site ?? '',
  }
}

export interface SyncResult {
  ok: boolean; manifest?: Manifest; pulled?: boolean;
  freshIds?: string[]; error?: string;
}

export class Syncer {
  lastManifest: Manifest | null = null
  lastOkAt: string | null = null
  lastError: string | null = null
  private running = false

  constructor(
    private db: YmDb,
    private cfg: () => SyncConfig,
    private onFresh: (items: MirrorItem[], freshIds: string[], baseline: boolean) => void,
  ) {}

  get pulledRev(): number { return Number(this.db.meta('dataRevPulled') ?? '-1') }

  async tick(): Promise<SyncResult> {
    if (this.running) return { ok: false, error: 'busy' }
    this.running = true
    try {
      const { apiBase, dataBase } = this.cfg()
      const m = parseManifest(await fetchText(`${apiBase}/v1/manifest.txt`))
      if (!m) throw new Error('bad manifest')
      this.lastManifest = m
      this.lastOkAt = new Date().toISOString()
      this.lastError = null
      this.db.setMeta('lastOkAt', this.lastOkAt)

      // 门控：只有「发布完成态」才拉（datarev==rev 且比本地新）
      if (m.datarev === m.rev && m.datarev > this.pulledRev) {
        const payload = JSON.parse(await fetchText(`${dataBase}/items.json`)) as {
          rev: number; items: MirrorItem[]
        }
        if (payload.rev !== m.datarev) {
          // 快照 rev 与 manifest 不一致——CI 发布窗口期，下轮再来
          return { ok: true, manifest: m, pulled: false }
        }
        const baseline = this.db.meta('baselineDone') !== '1'
        const freshIds = this.db.mirrorSnapshot(payload.items)
        this.db.setMeta('dataRevPulled', String(payload.rev))
        if (baseline) this.db.setMeta('baselineDone', '1')
        this.onFresh(payload.items, freshIds, baseline)
        return { ok: true, manifest: m, pulled: true, freshIds }
      }
      return { ok: true, manifest: m, pulled: false }
    } catch (e) {
      this.lastError = (e as Error).message
      return { ok: false, error: this.lastError }
    } finally { this.running = false }
  }

  status() {
    return {
      manifest: this.lastManifest, pulledRev: this.pulledRev,
      lastOkAt: this.lastOkAt, lastError: this.lastError,
      publishing: !!this.lastManifest && this.lastManifest.datarev < this.lastManifest.rev,
    }
  }
}
