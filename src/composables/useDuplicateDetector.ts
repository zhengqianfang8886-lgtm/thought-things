import { ref, watch, type Ref } from "vue";
import type { QuoteDetail } from "../types";

export interface DuplicateMatch {
  type: "exact" | "partial" | "contained";
  targetQuote: QuoteDetail;
  similarity: number;
}

export function useDuplicateDetector(
  inputText: Ref<string>,
  allQuotes: Ref<QuoteDetail[]>
) {
  const matchResult = ref<DuplicateMatch | null>(null);
  const isDismissed = ref(false);

  // 1. 深度清洗：剔除所有 HTML 标签、实体符、标点符号与空白字符
  const getFingerprint = (str: string): string => {
    return (str || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z0-9#]+;/gi, "")
      .replace(/[\p{P}\p{Z}\s]/gu, "")
      .toLowerCase();
  };

  // 2. 构造 3-Gram 滑动窗口集合
  const getTrigrams = (text: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 2; i++) {
      set.add(text.slice(i, i + 3));
    }
    return set;
  };

  // 3. 计算 Jaccard 相似系数
  const calcJaccard = (setA: Set<string>, setB: Set<string>): number => {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersect = 0;
    for (const item of setA) {
      if (setB.has(item)) intersect++;
    }
    return intersect / (setA.size + setB.size - intersect);
  };

  let debounceTimer: number | null = null;

  watch(inputText, (newVal) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    isDismissed.value = false;

    const cleanedInput = getFingerprint(newVal);

    // 纯文本少于 12 字不执行检测，避免输入开头单字时引起闪烁
    if (cleanedInput.length < 12) {
      matchResult.value = null;
      return;
    }

    debounceTimer = window.setTimeout(() => {
      if (isDismissed.value) return;

      const inputGrams = getTrigrams(cleanedInput);
      let bestMatch: QuoteDetail | null = null;
      let maxSim = 0;

      for (const card of allQuotes.value) {
        const cardClean = getFingerprint(card.content);
        if (!cardClean) continue;

        // A. 完全一致
        if (cleanedInput === cardClean) {
          matchResult.value = { type: "exact", targetQuote: card, similarity: 1 };
          return;
        }

        // B. 相互完全包含（超过 15 字的长句包含短句或短句扩展为长句）
        if (cardClean.length >= 15 && cleanedInput.includes(cardClean)) {
          matchResult.value = { type: "contained", targetQuote: card, similarity: 0.95 };
          return;
        }
        if (cleanedInput.length >= 15 && cardClean.includes(cleanedInput)) {
          matchResult.value = { type: "contained", targetQuote: card, similarity: 0.9 };
          return;
        }

        // C. Jaccard 模糊相似度比对
        const cardGrams = getTrigrams(cardClean);
        const sim = calcJaccard(inputGrams, cardGrams);
        if (sim > maxSim) {
          maxSim = sim;
          bestMatch = card;
        }
      }

      // 阈值：70% 以上判定为高度相似摘录
      if (maxSim >= 0.70 && bestMatch) {
        matchResult.value = {
          type: "partial",
          targetQuote: bestMatch,
          similarity: Math.round(maxSim * 100),
        };
      } else {
        matchResult.value = null;
      }
    }, 200);
  });

  const dismiss = () => {
    isDismissed.value = true;
    matchResult.value = null;
  };

  return {
    matchResult,
    dismiss,
  };
}
