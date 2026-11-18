/**
 * 羊毛日报：接入主插件快报产线（rndSources apiVersion≥2）。
 * registerBriefType 注册类型 + items 供给器——调度/AI概括/落盘/合并视图/通知全走主插件。
 * 条目取自本地镜像库（since 窗口内 fetched_at/published_at 的 active 条目）。
 * 评分免 LLM：突发 9 > 可信源 8 > 普通 6。
 */
import type { BriefTypeDef, FeedItem } from 'dsh-rss-news-daily'
import type { StoredItem, YmDb } from './db.js'

const SCORE_BREAKING = 9
const SCORE_TRUSTED = 8
const SCORE_NORMAL = 6
const MAX_WINDOW = 300

export function briefDef(): BriefTypeDef {
  return {
    id: 'yangmao-daily',
    name: '羊毛日报',
    schedule: { kind: 'daily', time: '08:00' },
    // 供给器类型：sourceIds 是「允许名单」语义——本地源 id 用 'yangmao' 统一
    sourceIds: ['yangmao'],
    sourceNames: { yangmao: '炊事班' },
    minScore: SCORE_NORMAL,
    maxItems: 30,
    itemTime: false,
    prompt: '概括今日羊毛：按「额度最大/最稀缺」排前，逐行一条以 - 开头、至多 15 条；'
      + '每条写明【平台】【额度/福利】【截止/领取方式】；到期的标注「今日到期」；'
      + '只摆事实，禁止任何评论、预测、褒贬判断及操作暗示。',
  }
}

/** 供 registerBriefType opts.items：窗口内 active 条目 → FeedItem */
export function briefItems(db: YmDb, since: string): FeedItem[] {
  const rows: (StoredItem & { hit: number })[] = []
  for (let page = 1; rows.length < MAX_WINDOW; page++) {
    const r = db.query({ tab: 'all', after: since, page, pageSize: 100 } as Parameters<YmDb['query']>[0])
    rows.push(...r.items)
    if (rows.length >= r.total || !r.items.length) break
  }
  // 按 突发>可信>普通 打分；同标题去重（快照可能带回源条目）
  const seen = new Set<string>()
  const out: FeedItem[] = []
  for (const it of rows.slice(0, MAX_WINDOW)) {
    const k = it.title.trim().toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({
      id: it.id,
      sourceId: 'yangmao',
      title: it.title,
      link: it.official_url ?? it.source_url ?? '#',
      summary: it.summary ?? '',
      content: it.content ?? '',
      publishedAt: it.published_at ?? it.fetched_at,
      fetchedAt: it.fetched_at,
      hash: '',
      digestedDay: '',
      topic: it.category ?? 'deal',
      score: 0,
      reasons: [],
      llmScore: it.breaking ? SCORE_BREAKING : it.trusted ? SCORE_TRUSTED : SCORE_NORMAL,
      ...(it.breaking ? { llmReason: '突发羊毛' } : it.trusted ? { llmReason: '可信源' } : {}),
      tags: [it.category, it.platform].filter((x): x is string => !!x),
      state: { read: false, hidden: false, liked: 0, hot: it.breaking },
    })
  }
  return out
}
