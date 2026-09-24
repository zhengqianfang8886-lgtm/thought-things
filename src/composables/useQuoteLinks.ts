import { TERMS } from "../constants/terms";
import { ref, computed, nextTick, type Ref } from "vue";
import { invoke } from "../ipc-bridge";
import type { QuoteDetail, NavHistoryItem, TimeFilterRange } from "../types";

export function useQuoteLinks(
  quotes: Ref<QuoteDetail[]>,
  filterOnlyQuestions: Ref<boolean>,
  selectedTag: Ref<string | null>,
  selectedTimeRange: Ref<TimeFilterRange | null>,
  searchQuery: Ref<string>,
  loadData: () => Promise<void>,
  showToast: (msg: string) => void,
  normalizeTagName: (tag: string) => string,
  onScrollToVirtualItem?: (id: string) => void,
  onSwitchToArchiveTab?: () => void,
  selectedEntryTypeFilter?: Ref<string>
) {
  const quoteLookupMap = ref<Record<string, QuoteDetail>>({});
  const navStack = ref<NavHistoryItem[]>([]);
  const highlightedQuoteId = ref<string | null>(null);
  const viewingQuoteRef = ref<QuoteDetail | null>(null);
  let isSilentFetching = false;

  const activeNavBack = computed(() => {
    return navStack.value.length > 0 ? navStack.value[navStack.value.length - 1] : null;
  });

  const updateQuoteLookup = (items: QuoteDetail[]) => {
    const next = { ...quoteLookupMap.value };
    for (const item of items) {
      next[item.id] = { ...item, tags: item.tags || [] };
    }
    quoteLookupMap.value = next;
  };

  const setQuoteLookup = (items: QuoteDetail[]) => {
    const freshMap: Record<string, QuoteDetail> = {};
    for (const item of items) {
      freshMap[item.id] = { ...item, tags: item.tags || [] };
    }
    quoteLookupMap.value = freshMap;
  };

  const removeQuoteFromLookup = (quoteId: string) => {
    const next = { ...quoteLookupMap.value };
    delete next[quoteId];
    quoteLookupMap.value = next;
  };

  const fetchAllQuotesSilently = async () => {
    if (isSilentFetching) return;
    isSilentFetching = true;
    try {
      const res = await invoke<any>("get_quotes", {
        onlyQuestions: false,
        tag: null,
        search: null,
        all: true,
      });
      const all: QuoteDetail[] = Array.isArray(res) ? res : (res.items || []);
      setQuoteLookup(all);
    } catch (e) {
      console.error("加载全局引用失败:", e);
    } finally {
      isSilentFetching = false;
    }
  };

  // 核心跳转管线：融合虚拟滚动、Tab 切换与视图过滤清除
  const jumpToQuote = async (targetId: string, sourceCardId?: string) => {
    if (!quoteLookupMap.value[targetId]) {
      await fetchAllQuotesSilently();
    }
    const targetQuote = quoteLookupMap.value[targetId] || quotes.value.find((q) => q.id === targetId);
    if (!targetQuote) {
      showToast("未找到该摘录条目（可能已被删除）");
      return;
    }

    // 1. 记录导航链路
    let actualSourceId = sourceCardId;
    if (!actualSourceId) {
      const foundCard = quotes.value.find(
        (c) =>
          c.content.includes(`[quote:${targetId}]`) ||
          c.thoughts.some((t) => t.content.includes(`[quote:${targetId}]`))
      );
      if (foundCard) actualSourceId = foundCard.id;
    }

    // 纯净剥离所有 HTML 标签与特殊符号，生成自然杂志级标题
    const stripToText = (str: string) => {
      return (str || "")
        .replace(/\[quote:[^\]]+\]/g, "")
        .replace(/!\[.*?\]\(img:[^)]+\)/g, "[图片]")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const sourceCard = actualSourceId ? (quoteLookupMap.value[actualSourceId] || quotes.value.find((q) => q.id === actualSourceId)) : null;
    const clean = sourceCard ? stripToText(sourceCard.content) : "";
    const typeLabel = sourceCard ? (sourceCard.is_question === 1 ? "问题" : (sourceCard.is_question === 2 ? "感悟" : "摘录")) : "";
    
    const sourceTitle = sourceCard
      ? (sourceCard.source
          ? `[${typeLabel}] 《${sourceCard.source}》`
          : `[${typeLabel}] ${clean.slice(0, 18) || "无标题"}${clean.length > 18 ? "..." : ""}`)
      : "上一步条目";

    // 2. 强制切回年轮列表 Tab（如果在记录页或置顶页点击跳转）
    if (onSwitchToArchiveTab) {
      onSwitchToArchiveTab();
    }

    // 1.1 记录当前所有可能被变更的过滤器环境
    const lastItem = navStack.value[navStack.value.length - 1];
    if (actualSourceId && actualSourceId !== targetId) {
      if (!lastItem || lastItem.sourceCardId !== actualSourceId) {
        navStack.value.push({
          sourceCardId: actualSourceId,
          sourceTitle,
          prevFilterOnlyQuestions: filterOnlyQuestions.value,
          prevSelectedTag: selectedTag.value,
          prevSelectedTimeRange: selectedTimeRange.value,
          prevSearchQuery: searchQuery.value,
          prevEntryTypeFilter: selectedEntryTypeFilter?.value || 'all',
        });
        if (navStack.value.length > 20) navStack.value.shift();
      }
    }

    // 3. 【全障碍穿透】：自动解除一切阻碍目标卡片呈现的过滤条件
    let needReload = false;

    // A. 穿透分类透镜 (问题 ↔ 摘录 ↔ 感悟)
    if (selectedEntryTypeFilter && selectedEntryTypeFilter.value !== 'all') {
      const currentFilter = selectedEntryTypeFilter.value;
      const matchesTarget = 
        (currentFilter === 'question' && targetQuote.is_question === 1) ||
        (currentFilter === 'insight' && targetQuote.is_question === 2) ||
        (currentFilter === 'quote' && targetQuote.is_question === 0) || (currentFilter === 'has_thought' && targetQuote.thoughts && targetQuote.thoughts.length > 0);
      
      if (!matchesTarget) {
        selectedEntryTypeFilter.value = 'all'; // 自动放开分类限制，让目标呈现！
      }
    }

    // B. 穿透旧版问题筛选
    if (filterOnlyQuestions.value && targetQuote.is_question === 0) {
      filterOnlyQuestions.value = false;
      needReload = true;
    }

    // C. 穿透标签筛选
    const targetTags = targetQuote.tags || [];
    if (
      selectedTag.value &&
      !targetTags.map(normalizeTagName).includes(normalizeTagName(selectedTag.value))
    ) {
      selectedTag.value = null;
      needReload = true;
    }

    // D. 穿透搜索关键词
    if (searchQuery.value) {
      const q = searchQuery.value.trim().toLowerCase();
      const matchC = targetQuote.content && targetQuote.content.toLowerCase().includes(q);
      const matchS = targetQuote.source && targetQuote.source.toLowerCase().includes(q);
      if (!matchC && !matchS) {
        searchQuery.value = "";
        needReload = true;
      }
    }

    // E. 穿透时间范围
    if (selectedTimeRange.value) {
      const { start, end } = selectedTimeRange.value;
      if (targetQuote.created_at < start || targetQuote.created_at > end) {
        selectedTimeRange.value = null;
        needReload = true;
      }
    }

    if (needReload) await loadData();
    await nextTick();

    // 4. 通知虚拟滚动引擎定位粗略高度
    if (onScrollToVirtualItem) {
      onScrollToVirtualItem(targetId);
    }
    await nextTick();

    // 5. 【智能多阶对齐】：克服虚拟滚动 DOM 节点延迟渲染问题，100% 精确对齐并亮起微光
    const tryScrollAndHighlight = (attemptsLeft: number) => {
      const targetEl = document.getElementById("quote_card_" + targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightedQuoteId.value = targetId;
        setTimeout(() => {
          if (highlightedQuoteId.value === targetId) highlightedQuoteId.value = null;
        }, 2800);
      } else if (attemptsLeft > 0) {
        if (onScrollToVirtualItem) onScrollToVirtualItem(targetId);
        setTimeout(() => tryScrollAndHighlight(attemptsLeft - 1), 60);
      }
    };

    setTimeout(() => tryScrollAndHighlight(4), 30);
  };

  const jumpBackToSource = async () => {
    if (navStack.value.length === 0) return;
    const item = navStack.value.pop()!;

    if (onSwitchToArchiveTab) onSwitchToArchiveTab();

    filterOnlyQuestions.value = item.prevFilterOnlyQuestions;
    selectedTag.value = item.prevSelectedTag;
    selectedTimeRange.value = item.prevSelectedTimeRange;
    searchQuery.value = item.prevSearchQuery;
    if (selectedEntryTypeFilter && item.prevEntryTypeFilter) {
      selectedEntryTypeFilter.value = item.prevEntryTypeFilter;
    }

    await loadData();
    await nextTick();

    if (onScrollToVirtualItem) {
      onScrollToVirtualItem(item.sourceCardId);
    }
    await nextTick();

    setTimeout(() => {
      const sourceEl = document.getElementById("quote_card_" + item.sourceCardId);
      if (sourceEl) {
        sourceEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      highlightedQuoteId.value = item.sourceCardId;
      setTimeout(() => {
        if (highlightedQuoteId.value === item.sourceCardId) highlightedQuoteId.value = null;
      }, 2800);
    }, 60);
  };

  const jumpBackToRoot = async () => {
    if (navStack.value.length === 0) return;
    const rootItem = navStack.value[0];
    navStack.value = [];

    if (onSwitchToArchiveTab) onSwitchToArchiveTab();

    filterOnlyQuestions.value = rootItem.prevFilterOnlyQuestions;
    selectedTag.value = rootItem.prevSelectedTag;
    selectedTimeRange.value = rootItem.prevSelectedTimeRange;
    searchQuery.value = rootItem.prevSearchQuery;

    await loadData();
    await nextTick();

    if (onScrollToVirtualItem) {
      onScrollToVirtualItem(rootItem.sourceCardId);
    }
    await nextTick();

    setTimeout(() => {
      const rootEl = document.getElementById("quote_card_" + rootItem.sourceCardId);
      if (rootEl) {
        rootEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      highlightedQuoteId.value = rootItem.sourceCardId;
      setTimeout(() => {
        if (highlightedQuoteId.value === rootItem.sourceCardId) highlightedQuoteId.value = null;
      }, 2800);
    }, 60);
  };

  const clearNavStack = () => {
    navStack.value = [];
  };

  return {
    quoteLookupMap,
    navStack,
    highlightedQuoteId,
    viewingQuoteRef,
    activeNavBack,
    updateQuoteLookup,
    setQuoteLookup,
    removeQuoteFromLookup,
    fetchAllQuotesSilently,
    jumpToQuote,
    jumpBackToSource,
    jumpBackToRoot,
    clearNavStack,
  };
}
