/**
 * 投稿跟踪：本地 submissions 表的 id 即 bearer → GET /v1/submissions/{id}
 * 状态跃迁 → 桌面通知 + 看板「我的投稿」更新。
 * 发现机制边界：只能跟踪「本机提交过/手动粘贴过 id」的投稿（无账号）。
 */
import type { YmDb } from './db.js'

type Notify = (title: string, body: string, path?: string) => void
const VIEW_PATH = '/dsh-rss-news-yangmao-freebie-coupon/'

interface SubStatus {
  status: string
  createdAt: string
  updatedAt: string
  item?: { slug: string; status: string }
  note?: string
}

// 状态 → 通知文案（extracting/new 中间态静默）
const TEXT: Record<string, (name: string) => [string, string] | null> = {
  pending: (n) => [`📮 投稿已受理：「${n}」`, '进入审核队列'],
  duplicated: (n) => [`📮 投稿重复：「${n}」`, '与已有条目相同'],
  rejected: (n) => [`📮 投稿未通过：「${n}」`, '未通过审核'],
  failed: (n) => [`📮 投稿处理失败：「${n}」`, '可稍后重新提交'],
  approved: (n) => [`🚀 投稿已上架：「${n}」`, '点击查看详情'],
}

export class SubmissionTracker {
  private running = false
  constructor(
    private db: YmDb,
    private apiBase: () => string,
    private notify: Notify,
  ) {}

  /** 投稿（插件内提交 + 网页提交后粘贴 id） */
  async submit(url: string, note: string | null, notifyEmail: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      const r = await fetch(`${this.apiBase()}/v1/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, note, notifyEmail }),
        signal: AbortSignal.timeout(15_000),
      })
      const j = await r.json() as { id?: string; error?: string }
      if (!r.ok || !j.id) return { ok: false, error: j.error ?? `HTTP ${r.status}` }
      this.db.addSubmission(j.id, url, note)
      return { ok: true, id: j.id }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  }

  /** 手动跟踪外部提交的 id（网页提交粘贴） */
  track(id: string, url = ''): { ok: boolean; error?: string } {
    if (!/^sub_[\w-]{8,40}$/.test(id)) return { ok: false, error: 'id 格式不对（sub_…）' }
    this.db.addSubmission(id, url || '(外部提交)', null)
    void this.tick()
    return { ok: true }
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const s of this.db.trackableSubmissions()) {
        try {
          const r = await fetch(`${this.apiBase()}/v1/submissions/${encodeURIComponent(s.id)}`,
            { signal: AbortSignal.timeout(10_000) })
          if (r.status === 404) { // id 无效/被清
            this.db.updateSubmission(s.id, 'failed', null, null)
            continue
          }
          if (!r.ok) continue
          const j = await r.json() as SubStatus
          const itemSlug = j.item?.slug ?? null
          const itemStatus = j.item?.status ?? null
          // 已上架 → 终态 approved
          const status = itemStatus === 'active' ? 'approved' : j.status
          const prev = s.status
          if (status !== prev || itemSlug !== s.item_slug) {
            this.db.updateSubmission(s.id, status, itemSlug, itemStatus)
          }
          // 跃迁通知（去重：last_notified）
          const lastN = this.db.subLastNotified(s.id)
          const notifyKey = itemStatus === 'active' ? 'approved' : status
          if (notifyKey !== lastN) {
            const fn = TEXT[notifyKey]
            const tb = fn ? fn(s.url.replace(/^https?:\/\//, '').slice(0, 40)) : null
            if (tb) this.notify(tb[0], tb[1], VIEW_PATH)
            this.db.setSubLastNotified(s.id, notifyKey)
          }
        } catch { /* 单条失败下轮 */ }
      }
    } finally { this.running = false }
  }
}
