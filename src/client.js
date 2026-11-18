/**
 * 客户端半体（classic script！宿主经 window.__ModuleLoader__.load 加载，
 * 禁止 ESM export）。当前无应用内 UI 需求——注册即返回（主插件缺席时
 * 服务端已打 warn 指路，后续如需 modal 指路可参照 kuaixun client 补）。
 */
;(() => {
  'use strict'
  window.__ModuleLoader__.load({
    id: 'dsh-rss-news-yangmao-freebie-coupon',
    factory: () => {
      const inject = []
      function apply() { /* no-op */ }
      return { inject, apply }
    },
  })
})()
