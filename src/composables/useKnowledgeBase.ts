import { TERMS } from "../constants/terms";
import { ref, computed } from "vue";
import type { QuoteDetail, Thought, BacklinkItem } from "../types";

/**
 * ThoughtRings 核心单一真理源 (Single Source of Truth)
 * 规范化实体存储：内存中仅以 Map<ID, QuoteDetail> 维持唯一权威实体
 */
const quotesMap = ref<Map<string, QuoteDetail>>(new Map());
const totalQuotesCount = ref<number>(0);

export function useKnowledgeBase() {
  // 1. 基础派生数据（任何实体的变动都会自动触发视图更新）
  const allQuotes = computed<QuoteDetail[]>(() => Array.from(quotesMap.value.values()));
  
  // 引用字典统一由 Map 实时派生，消灭副本割裂
  const quoteLookupMap = computed<Record<string, QuoteDetail>>(() => {
    const dict: Record<string, QuoteDetail> = {};
    for (const [id, item] of quotesMap.value.entries()) {
      dict[id] = item;
    }
    return dict;
  });

  // ----------------- 响应式双向关系图谱 (Reactive Knowledge Graph) -----------------
  const backlinkGraph = computed<Map<string, BacklinkItem[]>>(() => {
    const graph = new Map<string, BacklinkItem[]>();

    const addLink = (targetId: string, item: BacklinkItem) => {
      if (!graph.has(targetId)) {
        graph.set(targetId, []);
      }
      graph.get(targetId)!.push(item);
    };

    // 纯净提取真实文本（剔除所有 HTML 标签与引用语法本身）
    const stripAllMarkup = (raw: string): string => {
      if (!raw) return "";
      return raw
        .replace(/\[quote:[^\]]+\]/g, " ")
        .replace(/!\[.*?\]\(img:[^)]+\)/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const regex = /(?:\[quote:([a-zA-Z0-9_\-\.]+)(?:\|[^\]]*)?\]|data-quote-id="([a-zA-Z0-9_\-\.]+)")/g;

    for (const sourceCard of quotesMap.value.values()) {
      // 1. 检查正文中的引用
      if (sourceCard.content) {
        let m: RegExpExecArray | null;
        regex.lastIndex = 0;
        while ((m = regex.exec(sourceCard.content)) !== null) {
          const targetId = m[1] || m[2];
          if (targetId !== sourceCard.id) {
            // 核心修复：提取来源卡片 (sourceCard) 自己的真正文本！
            let actualSnippet = stripAllMarkup(sourceCard.content);

            // 如果来源卡片正文除了引用没写别的字，但它挂了思考年轮，穿透提取它年轮里的思考！
            if (!actualSnippet && sourceCard.thoughts && sourceCard.thoughts.length > 0) {
              const thSnippet = stripAllMarkup(sourceCard.thoughts[0].content);
              if (thSnippet) {
                actualSnippet = `年轮思考: ${thSnippet}`;
              }
            }

            // 如果确实整张卡片啥字都没写
            if (!actualSnippet) {
              actualSnippet = sourceCard.source 
                ? `引用于出处《${sourceCard.source}》的手记` 
                : TERMS.backlinks.onlyLinkFallback;
            }

            addLink(targetId, {
              source_quote_id: sourceCard.id,
              source_thought_id: null,
              is_question: sourceCard.is_question,
              quote_source: sourceCard.source,
              context_snippet: actualSnippet.slice(0, 160) + (actualSnippet.length > 160 ? "..." : ""),
              created_at: sourceCard.created_at,
            });
          }
        }
      }

      // 2. 检查年轮思考中的引用
      for (const th of sourceCard.thoughts || []) {
        if (th.content) {
          let m: RegExpExecArray | null;
          regex.lastIndex = 0;
          while ((m = regex.exec(th.content)) !== null) {
            const targetId = m[1] || m[2];
            if (targetId !== sourceCard.id) {
              // 提取该年轮思考中除了引用之外写的真实感想
              let thSnippet = stripAllMarkup(th.content);
              if (!thSnippet) {
                // 如果年轮思考只放了引用，提取主原句正文作为上下文
                const mainSnippet = stripAllMarkup(sourceCard.content);
                thSnippet = mainSnippet ? `${TERMS.backlinks.quotePrefix}${mainSnippet}` : TERMS.backlinks.emptyFallback;
              }

              addLink(targetId, {
                source_quote_id: sourceCard.id,
                source_thought_id: th.id,
                is_question: sourceCard.is_question,
                quote_source: sourceCard.source,
                context_snippet: thSnippet.slice(0, 160) + (thSnippet.length > 160 ? "..." : ""),
                created_at: th.created_at,
              });
            }
          }
        }
      }
    }

    return graph;
  });

  // 纯响应式只读接口：卡片直接调用，自动获得实时反链
  const getBacklinks = (quoteId: string): BacklinkItem[] => {
    return backlinkGraph.value.get(quoteId) || [];
  };

  const getBacklinkCount = (quoteId: string): number => {
    return backlinkGraph.value.get(quoteId)?.length || 0;
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
    // 避免重复追加
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
    backlinkGraph,
    getBacklinks,
    getBacklinkCount,
  };
}
