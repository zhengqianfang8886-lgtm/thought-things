import { ref, computed, onUnmounted, type Ref } from "vue";

export interface VirtualScrollOptions<T> {
  items: Ref<T[]>;
  estimatedItemHeight?: number;
  itemGap?: number;
  bufferCount?: number;
  virtualThreshold?: number;
  keyGetter: (item: T) => string;
}

export function useVirtualScroll<T>(options: VirtualScrollOptions<T>) {
  const {
    items,
    estimatedItemHeight = 260,
    itemGap = 24, // 严格对应 Tailwind gap-6 = 24px
    bufferCount = 4,
    virtualThreshold = 30, // 小于等于 30 条时直接直出渲染，杜绝任何闪白
    keyGetter,
  } = options;

  const scrollContainerRef = ref<HTMLElement | null>(null);
  const scrollTop = ref(0);
  const viewportHeight = ref(800);

  // 内部实测高度字典与已挂载节点反查表（精确回收 ResizeObserver 避免内存泄露）
  const measuredHeights = new Map<string, number>();
  const observedElements = new Map<string, HTMLElement>();
  const heightVersion = ref(0);
  let resizeObserver: ResizeObserver | null = null;

  // 必须同步创建（不能放进 onMounted）：子元素的 ref 回调先于父组件的 onMounted 执行，
  // 放进 onMounted 会导致首屏可见卡片在注册时 observer 还是 null，从未被真正 observe。
  if (typeof window !== "undefined" && "ResizeObserver" in window) {
    let pendingUpdates = false;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const key = target.getAttribute("data-virtual-key");
        if (key) {
          const h = Math.round(target.offsetHeight);
          if (h > 0 && measuredHeights.get(key) !== h) {
            measuredHeights.set(key, h);
            pendingUpdates = true;
          }
        }
      }
      if (pendingUpdates) {
        pendingUpdates = false;
        heightVersion.value++;
      }
    });
  }

  const isVirtualized = computed(() => {
    return items.value.length > virtualThreshold;
  });

  const getItemHeight = (key: string): number => {
    return measuredHeights.get(key) || estimatedItemHeight;
  };

  // 核心前缀和表：严格计入真实元素高与 Tailwind gap-6 边距
  const offsetPositions = computed(() => {
    // 显式依赖版本号，尺寸实测变化时才重算
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    heightVersion.value;

    const list = items.value;
    const len = list.length;
    const positions: number[] = new Array(len);
    let cumulative = 0;

    for (let i = 0; i < len; i++) {
      positions[i] = cumulative;
      const key = keyGetter(list[i]);
      cumulative += getItemHeight(key) + itemGap;
    }

    return {
      positions,
      totalHeight: Math.max(0, cumulative - (len > 0 ? itemGap : 0)),
    };
  });

  // 二分查找第一个进入视口的元素
  const findStartIndex = (top: number): number => {
    const positions = offsetPositions.value.positions;
    let low = 0;
    let high = positions.length - 1;
    let ans = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (positions[mid] <= top) {
        ans = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return ans;
  };

  // 核心计算属性：视口可见切片窗口
  const virtualState = computed(() => {
    const list = items.value;
    const len = list.length;

    if (len === 0) {
      return {
        isVirtualized: false,
        startIndex: 0,
        endIndex: 0,
        visibleItems: [],
        topSpacer: 0,
        bottomSpacer: 0,
        totalHeight: 0,
      };
    }

    // 条目较少时，直接直出全量数据，零计算开销
    if (!isVirtualized.value) {
      return {
        isVirtualized: false,
        startIndex: 0,
        endIndex: len - 1,
        visibleItems: list,
        topSpacer: 0,
        bottomSpacer: 0,
        totalHeight: 0,
      };
    }

    const { positions, totalHeight } = offsetPositions.value;
    const currentTop = Math.max(0, scrollTop.value);
    const rawStart = findStartIndex(currentTop);

    const startIndex = Math.max(0, rawStart - bufferCount);

    let rawEnd = startIndex;
    const targetBottom = currentTop + viewportHeight.value;
    while (rawEnd < len && positions[rawEnd] < targetBottom) {
      rawEnd++;
    }
    const endIndex = Math.min(len - 1, rawEnd + bufferCount);

    const topSpacer = positions[startIndex] || 0;
    const lastRenderedKey = keyGetter(list[endIndex]);
    const lastRenderedBottom = (positions[endIndex] || 0) + getItemHeight(lastRenderedKey);
    const bottomSpacer = Math.max(0, totalHeight - lastRenderedBottom);

    return {
      isVirtualized: true,
      startIndex,
      endIndex,
      visibleItems: list.slice(startIndex, endIndex + 1),
      topSpacer,
      bottomSpacer,
      totalHeight,
    };
  });

  // 关键修复：从原生的 Event Target 靶向直读 scrollTop，绝不依赖脆弱的模板 Ref
  const onScroll = (e?: Event) => {
    const el = (e?.target as HTMLElement) || scrollContainerRef.value;
    if (el) {
      scrollTop.value = el.scrollTop;
      if (el.clientHeight > 0 && el.clientHeight !== viewportHeight.value) {
        viewportHeight.value = el.clientHeight;
      }
    }
  };

  const registerItemElement = (key: string, el: HTMLElement | null) => {
    // 节点随虚拟滚动移出视口并销毁时，立即注销监听，杜绝内存泄漏
    if (!el) {
      const prevEl = observedElements.get(key);
      if (prevEl && resizeObserver) {
        resizeObserver.unobserve(prevEl);
        observedElements.delete(key);
      }
      return;
    }

    const prevEl = observedElements.get(key);
    if (prevEl && prevEl !== el && resizeObserver) {
      resizeObserver.unobserve(prevEl);
    }
    observedElements.set(key, el);

    if (resizeObserver) {
      resizeObserver.observe(el);
    }
    const h = el.offsetHeight;
    if (h > 0 && measuredHeights.get(key) !== h) {
      measuredHeights.set(key, h);
      heightVersion.value++;
    }
  };

  const scrollToKey = (key: string) => {
    const list = items.value;
    const idx = list.findIndex((item) => keyGetter(item) === key);
    if (idx < 0) return;

    const targetTop = offsetPositions.value.positions[idx] || 0;
    const container = scrollContainerRef.value;
    if (container) {
      container.scrollTop = Math.max(0, targetTop - 30);
      scrollTop.value = container.scrollTop;
    } else {
      scrollTop.value = Math.max(0, targetTop - 30);
    }
  };

  onUnmounted(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    observedElements.clear();
  });

  return {
    scrollContainerRef,
    virtualState,
    isVirtualized,
    onScroll,
    registerItemElement,
    scrollToKey,
  };
}
