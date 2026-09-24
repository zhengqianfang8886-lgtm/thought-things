/**
 * ThoughtRings - 核心名词与界面措辞配置中心
 * -------------------------------------------------------------
 * 你可以在这里随心所欲地修改任何概念的称谓（如将"年轮"改为"思考"，将"回响"改为"反链"等）。
 * 修改后保存，前端界面将在 0.1 秒内即时刷新生效！
 */

export const TERMS = {
  // 1. 三大卡片内容类型 (0: 摘录, 1: 问题, 2: 感悟)
  types: {
    quote: {
      name: "客观摘录",
      shortName: "摘录",
      icon: "📖",
      sourcePrefix: "文献出处:",
      sourcePlaceholder: "文献出处（如：《置身事内》P120）",
    },
    question: {
      name: "待解之问",
      shortName: "问题",
      icon: "❓",
      unresolvedBadge: "⏳ 探索中",
      resolvedBadge: "✓ 已参透",
      sourcePrefix: "背景线索:",
      sourcePlaceholder: "来源背景（如：认知科学 / 组织设计）",
    },
    insight: {
      name: "原生感悟",
      shortName: "感悟",
      icon: "💡",
      sourcePrefix: "契机场景:",
      sourcePlaceholder: "记录灵感契机（如：深夜漫步 / 对话共鸣）",
    },
  },

  // 2. 核心隐喻：思维年轮 (Thoughts / Rings)
  rings: {
    systemName: "ThoughtRings",
    cardTitle: "思维年轮",
    layerSuffix: "层演进",
    inputLabel: "🌱 当下认知 (思维年轮)",
    questionHypoLabel: "💡 初步假设 / 解题线索",
    inputPlaceholder: "写下当下对此条手记的新认知（加粗、高亮、清单实时所见即所得）...",
    appendBtnText: "追加认知年轮",
    appendSuccessToast: "🌱 年轮已萌新芽",
    collapseIntermediate: "收起中间历史",
    expandAll: "全部展开",
  },

  // 3. 双向关联：反向链接与脉络回响 (Backlinks)
  backlinks: {
    badgeSuffix: "处回响",             // 例如: "1 处回响" 或 "1 处被引" / "1 处反链"
    drawerTitle: "思维年轮回响",       // 展开抽屉的标题
    drawerCountSuffix: "篇关联",       // 例如: "2 篇关联"
    jumpActionText: "回溯",           // 条目右侧的动作按钮: "回溯 ➔" 或 "跳转 ➔"
    drawerCloseBtn: "收起 ✕",
    emptyFallback: "作为上下文线索建立了认知延伸关联",
    onlyLinkFallback: "在卡片中建立了直接关联",
    thoughtPrefix: "年轮思考: ",
    quotePrefix: "关联原句: ",
  },

  // 4. 顶栏导航与三大主视图
  tabs: {
    capture: "✍️ 记录",
    archive: "📜 年轮",
    pinned: "🌟 常看",
  },

  // 5. 跨卡片无级跳转与回退 HUD 导航悬浮栏
  navigation: {
    hudPrefix: "查阅引用，源自：",
    hudMultiStepPrefix: "连续引用链路，来自：",
    jumpBackBtn: "跳回",
    jumpBackStepPrefix: "上一步",
    jumpBackOriginBtn: "⏪ 起点",
    unnamedEntry: "无出处手记",
  },

  // 6. 专注模式 (Focus Mode)
  focus: {
    quoteTitle: "客观原句 · 沉浸精读",
    questionTitle: "待解之问 · 沉浸探究",
    insightTitle: "原生感悟 · 深度沉淀",
    exitBtn: "✕ 退出心流",
    editQuoteBtn: "✏️ 勘误原句",
    editThoughtBtn: "✏️ 勘误",
    streamSectionTitle: "心流顿悟 · 延伸新认知：",
    streamAppendBtn: "🌱 延伸思维年轮",
    backlinksSectionTitle: "此句在全库中的知识回响",
  },

  // 7. 分类透镜筛选栏
  filters: {
    all: "全部",
    activePrefix: "⚡ 筛选中:",
    resetAllBtn: "↺ 重置全部条件",
    emptyFilterTitle: "当前分类透镜下暂无手记",
    emptyFilterReassure: "请放心，你的数据安全无虞（知识库中现存手记完好），只是当前透镜下暂无条目。",
    viewAllBtn: "查看全部手记",
  },
};
