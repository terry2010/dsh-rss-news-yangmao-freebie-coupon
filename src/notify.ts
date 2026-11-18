/**
 * 通知分发：新条目 → 突发广播 + 订阅命中 → rndSources.notify（主插件桌面推送）
 * 基线轮（首装首次镜像）不推任何通知。
 */
import type { MirrorItem, YmDb } from './db.js'

type Notify = (title: string, body: string, path?: string) => void

const VIEW_PATH = '/dsh-rss-news-yangmao-freebie-coupon/'

function matchSub(item: MirrorItem, sub: { keywords: string[]; channels: string[] }): boolean {
  if (sub.channels.length && item.category && !sub.channels.includes(item.category)) return false
  if (!sub.keywords.length) return true // 仅频道限定或全量订阅
  const hay = `${item.title} ${item.summary ?? ''} ${item.platform ?? ''}`.toLowerCase()
  return sub.keywords.some((k) => k && hay.includes(k.toLowerCase()))
}

export function dispatchFresh(db: YmDb, items: MirrorItem[], freshIds: string[], baseline: boolean, notify: Notify): void {
  if (baseline || !freshIds.length) return
  const fresh = items.filter((i) => freshIds.includes(i.id) && i.status === 'active')
  if (!fresh.length) return
  const subs = db.subs().filter((s) => s.enabled)

  for (const it of fresh) {
    // 1) 突发广播（所有用户）
    if (it.breaking && !db.wasNotified('_breaking', it.id)) {
      db.markNotified('_breaking', it.id)
      notify(`每日羊毛·突发 🔥 ${it.title}`,
        `${it.platform ?? ''} ${it.quota ?? ''}`.trim() || it.summary || '', VIEW_PATH)
    }
    // 2) 订阅命中
    for (const s of subs) {
      const key = `sub:${s.id}`
      if (db.wasNotified(key, it.id)) continue
      if (!matchSub(it, s)) continue
      db.markNotified(key, it.id)
      notify(`每日羊毛·订阅命中 ${it.title}`,
        (it.summary ?? it.platform ?? '').slice(0, 120), VIEW_PATH)
    }
  }
}
