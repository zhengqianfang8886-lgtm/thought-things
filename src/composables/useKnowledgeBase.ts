import { ref, computed } from "vue";
import type { QuoteDetail, Thought, BacklinkItem } from "../types";

/**
 * ThoughtRings 核心单一真理源 (Single Source of Truth)
 * 规范化实体存储：内存中仅以 Map<ID, QuoteDetail> 维持唯一权威实体
 */
const quotesMap = ref<Map<string, QuoteDetail>>(new Map());
const totalQuotesCount = ref<number>(0);

export function useKnowledgeBase() {
  // 1. 基础派生数据：严格按 created_at 降序排列，保证撤销恢复条目瞬回原位
  const allQuotes = computed<QuoteDetail[]>(() => {
    return Array.from(quotesMap.value.values()).sort((a, b) => b.created_at - a.created_at);
  });
  
  // 引用字典统一由 Map 实时派生，消灭副本割裂
  const quoteLookupMap = computed<Record<string, QuoteDetail>>(() => {
    const dict: Record<string, QuoteDetail> = {};
    for (const [id, item] of quotesMap.value.entries()) {
      dict[id] = item;
    }
    return dict;
  });

  // ----------------- 高性能轻量反链缓存系统 (消灭全量正则计算) -----------------
  // 反链详情与数量直接由 SQLite B-Tree 查询驱动，零 CPU 掉帧
  const backlinksCache = ref<Map<string, BacklinkItem[]>>(new Map());

  const getBacklinks = (quoteId: string): BacklinkItem[] => {
    return backlinksCache.value.get(quoteId) || [];
  };

  const getBacklinkCount = (quoteId: string): number => {
    const card = quotesMap.value.get(quoteId);
    if (card && card.backlinks_count !== undefined) {
      return card.backlinks_count;
    }
    return backlinksCache.value.get(quoteId)?.length || 0;
  };

  const loadBacklinksForQuote = async (quoteId: string) => {
    try {
      const { invoke } = await import("../ipc-bridge");
      const list = await invoke<BacklinkItem[]>("get_backlinks", { quoteId });
      backlinksCache.value.set(quoteId, list || []);
    } catch (e) {
      console.error("加载反链明细失败:", e);
    }
  };

  // 2. 批量加载与分页追加
  const setQuotes = (items: QuoteDetail[], totalCount?: number, append: boolean = false) => {
    if (!append) {
      quotesMap.value.clear();
    }
    for (const item of items) {
      quotesMap.value.set(item.id, {
        ...item,
        tags: item.tags || [],
        thoughts: item.thoughts || [],
        backlinks_count: item.backlinks_count || 0,
      });
    }
    if (totalCount !== undefined) {
      totalQuotesCount.value = totalCount;
    }
  };

  // 3. 原生单体操作（原子更新，0ms 反射到所有视图）
  // 原生实体全量恢复（支持撤销误删时 0ms 原地复苏）
  const upsertQuote = (quote: QuoteDetail) => {
    quotesMap.value.set(quote.id, {
      ...quote,
      tags: quote.tags || [],
      thoughts: quote.thoughts || [],
      backlinks_count: quote.backlinks_count || 0,
    });
    totalQuotesCount.value = quotesMap.value.size;
  };

  const getQuote = (id: string): QuoteDetail | undefined => {
    return quotesMap.value.get(id);
  };

  const removeQuote = (id: string) => {
    quotesMap.value.delete(id);
    totalQuotesCount.value = Math.max(0, totalQuotesCount.value - 1);
  };

  const updateQuoteContent = (
    id: string,
    content: string,
    source: string | null,
    isQuestion?: number
  ) => {
    const card = quotesMap.value.get(id);
    if (!card) return;
    card.content = content;
    card.source = source;
    if (isQuestion !== undefined) {
      card.is_question = isQuestion;
    }
  };

  const appendThought = (quoteId: string, thought: Thought) => {
    const card = quotesMap.value.get(quoteId);
    if (!card) return;
    if (!card.thoughts) card.thoughts = [];
    if (!card.thoughts.some((t) => t.id === thought.id)) {
      card.thoughts.push(thought);
    }
  };

  const updateThoughtContent = (thoughtId: string, newContent: string) => {
    for (const card of quotesMap.value.values()) {
      const th = card.thoughts.find((t) => t.id === thoughtId);
      if (th) {
        th.content = newContent;
        th.updated_at = Date.now();
        break;
      }
    }
  };

  const removeThought = (thoughtId: string) => {
    for (const card of quotesMap.value.values()) {
      const idx = card.thoughts.findIndex((t) => t.id === thoughtId);
      if (idx >= 0) {
        card.thoughts.splice(idx, 1);
        break;
      }
    }
  };

  const attachTag = (quoteId: string, tag: string) => {
    const card = quotesMap.value.get(quoteId);
    if (card && !card.tags.includes(tag)) {
      card.tags.push(tag);
    }
  };

  const detachTag = (quoteId: string, tag: string) => {
    const card = quotesMap.value.get(quoteId);
    if (card) {
      const idx = card.tags.indexOf(tag);
      if (idx >= 0) card.tags.splice(idx, 1);
    }
  };

  return {
    quotesMap,
    allQuotes,
    quoteLookupMap,
    totalQuotesCount,
    setQuotes,
    getQuote,
    upsertQuote,
    removeQuote,
    updateQuoteContent,
    appendThought,
    updateThoughtContent,
    removeThought,
    attachTag,
    detachTag,
    backlinksCache,
    loadBacklinksForQuote,
    getBacklinks,
    getBacklinkCount,
  };
}
