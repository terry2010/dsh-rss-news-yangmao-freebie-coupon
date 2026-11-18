/**
 * 每日羊毛独立库：node:sqlite 单文件，与主插件 store.db 完全隔离。
 * 路径 <主数据目录>/companions/rss-news-yangmao/yangmao.db（备份随行）。
 * items 是 data.chuishiban.com/items.json 的本地镜像（快照替换）；
 * marks/subs/submissions/notified 是本地状态，不上行。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function resolveMainDataDir(): string {
  const home = process.env.DSH_HOME
  if (home) return join(home, 'data', 'rss-news-daily')
  return join(process.env.HOME || '.', '.dsh', 'rss-news-daily')
}
export function resolveDataDir(): string {
  const dir = join(resolveMainDataDir(), 'companions', 'rss-news-yangmao')
  mkdirSync(dir, { recursive: true })
  return dir
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,   -- external_id（jidan:358 / user:sub_x）
  site_id      INTEGER,
  slug         TEXT,
  title        TEXT NOT NULL,
  summary      TEXT,
  content      TEXT,
  category     TEXT,
  platform     TEXT,
  claim_type   TEXT,
  quota        TEXT,
  deadline     TEXT,
  official_url TEXT,
  outbound_url TEXT,
  source_url   TEXT,
  source_name  TEXT,
  trusted      INTEGER DEFAULT 0,
  breaking     INTEGER DEFAULT 0,
  status       TEXT NOT NULL,      -- active/expired（快照只下发公开面）
  views        INTEGER DEFAULT 0,
  clicks       INTEGER DEFAULT 0,
  published_at TEXT,
  fetched_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, category);
CREATE INDEX IF NOT EXISTS idx_items_deadline ON items(deadline);

-- 本地标记：claimed 已领取 / favorite 收藏 / hidden 已隐藏
CREATE TABLE IF NOT EXISTS marks (
  item_id TEXT PRIMARY KEY,
  claimed INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 订阅：关键词/频道过滤（空=全量）
CREATE TABLE IF NOT EXISTS subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keywords TEXT NOT NULL DEFAULT '[]',  -- JSON array
  channels TEXT NOT NULL DEFAULT '[]',  -- JSON array（空=全部频道）
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 通知去重：subId+itemId（系统通道 '_breaking'）
CREATE TABLE IF NOT EXISTS notified (
  sub_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (sub_id, item_id)
);

-- 我的投稿（id=服务端 nanoid bearer）
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,      -- new/extracting/pending/approved/duplicated/rejected/failed
  item_slug TEXT,            -- 上架后服务端下发的 slug
  item_status TEXT,
  last_notified TEXT,        -- 上次通知过的状态（去重）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

export interface MirrorItem {
  id: string; siteId: number | null; slug: string | null; title: string;
  summary: string | null; content: string | null; category: string | null;
  platform: string | null; claimType: string | null; quota: string | null;
  deadline: string | null; officialUrl: string | null; outboundUrl: string | null;
  sourceUrl: string | null; sourceName: string | null;
  trusted: boolean; breaking: boolean; status: string;
  views: number; clicks: number; publishedAt: string | null;
}
interface ItemRow {
  id: string; site_id: number | null; slug: string | null; title: string;
  summary: string | null; content: string | null; category: string | null;
  platform: string | null; claim_type: string | null; quota: string | null;
  deadline: string | null; official_url: string | null; outbound_url: string | null;
  source_url: string | null; source_name: string | null;
  trusted: number; breaking: number; status: string;
  views: number; clicks: number; published_at: string | null; fetched_at: string;
}
export interface StoredItem extends Omit<ItemRow, 'trusted' | 'breaking'> {
  trusted: boolean; breaking: boolean;
}
const rowToItem = (r: ItemRow): StoredItem => ({ ...r, trusted: !!r.trusted, breaking: !!r.breaking })

export interface Submission {
  id: string; url: string; note: string | null; status: string;
  item_slug: string | null; item_status: string | null;
  last_notified: string | null; created_at: string; updated_at: string;
}

export class YmDb {
  private db: DatabaseSync
  constructor(dir = resolveDataDir()) {
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'yangmao.db'))
    this.db.exec(SCHEMA)
  }
  close(): void { this.db.close() }

  meta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined
    return r?.value ?? null
  }
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }

  /** 快照整镜像替换；返回「新增 item id 列表」（供订阅命中/突发推送；首次基线由调用方拦） */
  mirrorSnapshot(items: MirrorItem[]): string[] {
    const now = new Date().toISOString()
    const seen = new Set(items.map((i) => i.id))
    const existing = new Set(
      (this.db.prepare('SELECT id FROM items').all() as { id: string }[]).map((r) => r.id),
    )
    const fresh: string[] = []
    const ins = this.db.prepare(`INSERT INTO items(
      id,site_id,slug,title,summary,content,category,platform,claim_type,quota,deadline,
      official_url,outbound_url,source_url,source_name,trusted,breaking,status,views,clicks,published_at,fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug,title=excluded.title,summary=excluded.summary,content=excluded.content,
        category=excluded.category,platform=excluded.platform,claim_type=excluded.claim_type,
        quota=excluded.quota,deadline=excluded.deadline,official_url=excluded.official_url,
        outbound_url=excluded.outbound_url,source_url=excluded.source_url,source_name=excluded.source_name,
        trusted=excluded.trusted,breaking=excluded.breaking,status=excluded.status,
        views=excluded.views,clicks=excluded.clicks,published_at=excluded.published_at,fetched_at=excluded.fetched_at`)
    const del = this.db.prepare('DELETE FROM items WHERE id=?')
    this.db.exec('BEGIN')
    try {
      for (const it of items) {
        ins.run(
          it.id, it.siteId, it.slug, it.title, it.summary, it.content, it.category,
          it.platform, it.claimType, it.quota, it.deadline, it.officialUrl, it.outboundUrl,
          it.sourceUrl, it.sourceName, it.trusted ? 1 : 0, it.breaking ? 1 : 0, it.status,
          it.views, it.clicks, it.publishedAt, now,
        )
        if (!existing.has(it.id)) fresh.push(it.id)
      }
      for (const id of existing) if (!seen.has(id)) del.run(id)
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
    return fresh
  }

  getItem(id: string): StoredItem | undefined {
    const r = this.db.prepare('SELECT * FROM items WHERE id=?').get(id) as ItemRow | undefined
    return r ? rowToItem(r) : undefined
  }

  query(opts: {
    tab?: 'all' | 'ai' | 'hits' | 'claimed' | 'favorite' | 'hidden'
    q?: string; channel?: string; after?: string; page?: number; pageSize?: number
  }): { total: number; items: (StoredItem & { claimed: number; favorite: number; hidden: number; hit: number })[] } {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50))
    const where: string[] = ["i.status='active'"]
    const params: (string | number)[] = []
    const joinMarks = 'LEFT JOIN marks m ON m.item_id=i.id'
    const hitJoin = `EXISTS(SELECT 1 FROM subs s WHERE s.enabled=1 AND (
      json_array_length(s.channels)=0 OR EXISTS(SELECT 1 FROM json_each(s.channels) je WHERE je.value=i.category)
    ) AND (
      json_array_length(s.keywords)=0 OR EXISTS(
        SELECT 1 FROM json_each(s.keywords) jk
        WHERE lower(i.title||' '||COALESCE(i.summary,'')||' '||COALESCE(i.platform,'')) LIKE '%'||lower(jk.value)||'%')
    ))`
    switch (opts.tab) {
      case 'ai': where.push("i.category='ai'"); break
      case 'hits': where.push(`AND0`); break // placeholder 防误用，hits 走 hitJoin
      case 'claimed': where.push('COALESCE(m.claimed,0)=1'); break
      case 'favorite': where.push('COALESCE(m.favorite,0)=1'); break
      case 'hidden': where.push('COALESCE(m.hidden,0)=1'); break
    }
    if (opts.tab === 'hits') where.push(hitJoin)
    // 「已隐藏」视图只看 hidden=1；其余视图全部排除隐藏条目
    if (opts.tab !== 'hidden') where.push('COALESCE(m.hidden,0)=0')
    if (opts.channel) { where.push('i.category=?'); params.push(opts.channel) }
    if (opts.after) { where.push('COALESCE(i.published_at,i.fetched_at) >= ?'); params.push(opts.after) }
    if (opts.q) {
      where.push("(lower(i.title||' '||COALESCE(i.summary,'')) LIKE ?)")
      params.push(`%${opts.q.toLowerCase()}%`)
    }
    const w = where.filter((x) => x !== 'AND0').join(' AND ')
    const total = (this.db.prepare(
      `SELECT COUNT(*) n FROM items i ${joinMarks} WHERE ${w}`,
    ).get(...params) as { n: number }).n
    const rows = this.db.prepare(
      `SELECT i.*, COALESCE(m.claimed,0) claimed, COALESCE(m.favorite,0) favorite,
              COALESCE(m.hidden,0) hidden, ${hitJoin} AS hit
       FROM items i ${joinMarks} WHERE ${w}
       ORDER BY i.breaking DESC, COALESCE(i.published_at,i.fetched_at) DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, (page - 1) * pageSize) as unknown as (ItemRow & { claimed: number; favorite: number; hidden: number; hit: number })[]
    return { total, items: rows.map((r) => ({ ...rowToItem(r), claimed: r.claimed, favorite: r.favorite, hidden: r.hidden, hit: r.hit })) }
  }

  counts(): Record<string, number> {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    const hitJoin = `EXISTS(SELECT 1 FROM subs s WHERE s.enabled=1 AND (
      json_array_length(s.channels)=0 OR EXISTS(SELECT 1 FROM json_each(s.channels) je WHERE je.value=i.category)
    ) AND (
      json_array_length(s.keywords)=0 OR EXISTS(
        SELECT 1 FROM json_each(s.keywords) jk
        WHERE lower(i.title||' '||COALESCE(i.summary,'')||' '||COALESCE(i.platform,'')) LIKE '%'||lower(jk.value)||'%')
    ))`
    return {
      all: one(`SELECT COUNT(*) n FROM items i LEFT JOIN marks m ON m.item_id=i.id WHERE i.status='active' AND COALESCE(m.hidden,0)=0`),
      ai: one(`SELECT COUNT(*) n FROM items i LEFT JOIN marks m ON m.item_id=i.id WHERE i.status='active' AND i.category='ai' AND COALESCE(m.hidden,0)=0`),
      hits: one(`SELECT COUNT(*) n FROM items i LEFT JOIN marks m ON m.item_id=i.id WHERE i.status='active' AND COALESCE(m.hidden,0)=0 AND ${hitJoin}`),
      claimed: one(`SELECT COUNT(*) n FROM items i JOIN marks m ON m.item_id=i.id WHERE i.status='active' AND m.claimed=1`),
      favorite: one(`SELECT COUNT(*) n FROM items i JOIN marks m ON m.item_id=i.id WHERE i.status='active' AND m.favorite=1`),
      hidden: one(`SELECT COUNT(*) n FROM items i JOIN marks m ON m.item_id=i.id WHERE i.status='active' AND m.hidden=1`),
      channels: 0,
    }
  }
  channelList(): { category: string; n: number }[] {
    return this.db.prepare(
      `SELECT i.category, COUNT(*) n FROM items i LEFT JOIN marks m ON m.item_id=i.id
       WHERE i.status='active' AND COALESCE(m.hidden,0)=0 GROUP BY i.category ORDER BY n DESC`,
    ).all() as unknown as { category: string; n: number }[]
  }

  setMark(itemId: string, patch: { claimed?: boolean; favorite?: boolean; hidden?: boolean }): void {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO marks(item_id,updated_at) VALUES(?,?)
      ON CONFLICT(item_id) DO NOTHING`).run(itemId, now)
    const sets: string[] = []; const vals: (string | number)[] = []
    for (const k of ['claimed', 'favorite', 'hidden'] as const) {
      if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k] ? 1 : 0) }
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE marks SET ${sets.join(',')}, updated_at=? WHERE item_id=?`).run(...vals, now, itemId)
  }

  // ---- 订阅 ----
  subs(): { id: number; keywords: string[]; channels: string[]; enabled: boolean; created_at: string }[] {
    const rows = this.db.prepare('SELECT * FROM subs ORDER BY id').all() as
      { id: number; keywords: string; channels: string; enabled: number; created_at: string }[]
    return rows.map((r) => ({
      id: r.id, keywords: JSON.parse(r.keywords || '[]') as string[],
      channels: JSON.parse(r.channels || '[]') as string[],
      enabled: !!r.enabled, created_at: r.created_at,
    }))
  }
  addSub(keywords: string[], channels: string[]): number {
    const r = this.db.prepare('INSERT INTO subs(keywords,channels,created_at) VALUES(?,?,?)')
      .run(JSON.stringify(keywords), JSON.stringify(channels), new Date().toISOString())
    return Number(r.lastInsertRowid)
  }
  setSub(id: number, patch: { keywords?: string[]; channels?: string[]; enabled?: boolean }): void {
    const sets: string[] = []; const vals: (string | number)[] = []
    if (patch.keywords) { sets.push('keywords=?'); vals.push(JSON.stringify(patch.keywords)) }
    if (patch.channels) { sets.push('channels=?'); vals.push(JSON.stringify(patch.channels)) }
    if (patch.enabled !== undefined) { sets.push('enabled=?'); vals.push(patch.enabled ? 1 : 0) }
    if (!sets.length) return
    this.db.prepare(`UPDATE subs SET ${sets.join(',')} WHERE id=?`).run(...vals, id)
  }
  delSub(id: number): void { this.db.prepare('DELETE FROM subs WHERE id=?').run(id) }

  // ---- 通知去重 ----
  wasNotified(subId: string, itemId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM notified WHERE sub_id=? AND item_id=?').get(subId, itemId)
  }
  markNotified(subId: string, itemId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO notified(sub_id,item_id,created_at) VALUES(?,?,?)')
      .run(subId, itemId, new Date().toISOString())
  }

  // ---- 投稿跟踪 ----
  addSubmission(id: string, url: string, note: string | null): void {
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO submissions(id,url,note,status,created_at,updated_at)
      VALUES(?,?,?,'new',?,?) ON CONFLICT(id) DO NOTHING`).run(id, url, note, now, now)
  }
  removeSubmission(id: string): void {
    this.db.prepare('DELETE FROM submissions WHERE id=?').run(id)
  }
  submissions(): Submission[] {
    return this.db.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all() as unknown as Submission[]
  }
  trackableSubmissions(): Submission[] {
    return this.db.prepare(
      `SELECT * FROM submissions WHERE status NOT IN ('approved','rejected','duplicated','failed') OR item_status IS NULL`,
    ).all() as unknown as Submission[]
  }
  updateSubmission(id: string, status: string, itemSlug?: string | null, itemStatus?: string | null): void {
    this.db.prepare(`UPDATE submissions SET status=?, item_slug=COALESCE(?,item_slug),
      item_status=COALESCE(?,item_status), updated_at=? WHERE id=?`)
      .run(status, itemSlug ?? null, itemStatus ?? null, new Date().toISOString(), id)
  }
  subLastNotified(id: string): string | null {
    const r = this.db.prepare('SELECT last_notified FROM submissions WHERE id=?').get(id) as { last_notified: string | null } | undefined
    return r?.last_notified ?? null
  }
  setSubLastNotified(id: string, status: string): void {
    this.db.prepare('UPDATE submissions SET last_notified=? WHERE id=?').run(status, id)
  }
}
