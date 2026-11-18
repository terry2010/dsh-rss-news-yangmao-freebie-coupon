# dsh-rss-news-yangmao-freebie-coupon

DSH 伴随插件「每日羊毛」——[炊事班](https://chuishiban.com)羊毛/优惠情报的桌面客户端。

依赖主插件 [`dsh-rss-news-daily`](https://github.com/terry2010/dsh-rss-news-daily)（提供 `rndSources` / `webServer` 服务）。

## 功能

- **羊毛看板**：独立视图页（全部 / AI福利 / 订阅命中 / 已领取 / 收藏 / 已隐藏），分类 chips、搜索、本地标记（领取/收藏/隐藏）
- **订阅命中推送**：关键词 + 频道过滤规则，命中即时桌面通知（走主插件 `rndSources.notify`）
- **突发广播**：`breaking` 条目全员即时推送
- **投稿**：插件内向 chuishiban.com 投稿，跟踪 ID 轮询状态、状态跃迁通知
- **羊毛日报**：向主插件快报供给 FeedItem（`registerBriefType('yangmao')`）

## 数据流（只读公开端点，无凭证）

```
manifest.txt  api.chuishiban.com    60s 轮询 ~200B
items.json    data.chuishiban.com   datarev 门控后全量快照替换
submissions   api.chuishiban.com    POST 投稿 + GET 轮询（id 即 bearer）
```

## 开发

```bash
npm install
npm test          # tsc 构建 + node --test
```

安装到本地 profile 后重启 dsh；看板在「每日羊毛」视图 tab。

数据目录：`<DSH_HOME|~/.dsh>/rss-news-daily/companions/rss-news-yangmao/yangmao.db`（独立于主插件 store.db）。

## License

Apache-2.0
