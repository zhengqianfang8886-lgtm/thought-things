import { ref, computed, watch, onUnmounted, type Ref } from "vue";

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
    estimatedItemHeight = 135,
    itemGap = 10, // 对应 Tailwind gap-3.5 = 14px
    bufferCount = 8,
    virtualThreshold = 60,
    keyGetter,
  } = options;

  const scrollContainerRef = ref<HTMLElement | null>(null);
  const scrollTop = ref(0);
  const viewportHeight = ref(800);

  // 内部实测高度字典与已挂载节点反查表
  const measuredHeights = new Map<string, number>();
  const observedElements = new Map<string, HTMLElement>();
  const heightVersion = ref(0);
  let itemResizeObserver: ResizeObserver | null = null;
  let containerResizeObserver: ResizeObserver | null = null;

  // 1. 同步创建元素尺寸观测器
  if (typeof window !== "undefined" && "ResizeObserver" in window) {
    let pendingUpdates = false;
    let rafUpdateId: number | null = null;
    const scheduleHeightVersionUpdate = () => {
      if (rafUpdateId !== null) return;
      rafUpdateId = requestAnimationFrame(() => {
        rafUpdateId = null;
        heightVersion.value++;
      });
    };

    itemResizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const key = target.getAttribute("data-virtual-key");
        if (key) {
          const h = Math.round(target.offsetHeight);
          const oldH = measuredHeights.get(key) || 0;
          // 核心优化：高频微小抖动(<=2px)直接忽略，严禁触发全局前缀和重算死循环！
          if (h > 0 && Math.abs(oldH - h) > 2) {
            measuredHeights.set(key, h);
            changed = true;
          }
        }
      }
      if (changed) {
        scheduleHeightVersionUpdate();
      }
    });

    // 2. 核心突破：容器级 ResizeObserver，窗口缩放/侧栏伸缩时 0ms 自动对齐可视高度！
    containerResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr.height > 0 && cr.height !== viewportHeight.value) {
          viewportHeight.value = cr.height;
        }
      }
    });
  }

  // 3. 【核心根治】监听容器变化，一旦挂载立即直读真实尺寸并开启动态观测！
  // 关键修复：当列表数据（如撤销恢复）发生改变时，强制更新 heightVersion 触发切片重绘
  watch(
    () => items.value.length,
    () => {
      heightVersion.value++;
    }
  );

  watch(scrollContainerRef, (newEl, oldEl) => {
    if (oldEl && containerResizeObserver) {
      containerResizeObserver.unobserve(oldEl);
    }
    if (newEl) {
      if (newEl.clientHeight > 0) {
        viewportHeight.value = newEl.clientHeight;
      }
      scrollTop.value = newEl.scrollTop;
      if (containerResizeObserver) {
        containerResizeObserver.observe(newEl);
      }
    }
  });

  const isVirtualized = computed(() => {
    return items.value.length > virtualThreshold;
  });

  const getItemHeight = (key: string): number => {
    return measuredHeights.get(key) || estimatedItemHeight;
  };

  // 核心前缀和表
  const offsetPositions = computed(() => {
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

  // 核心计算属性：视口可见切片窗口 (防空白自愈机制)
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

    // 条目较少时，直接直出全量数据，零白屏风险
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
    
    // 【响应式修复】直接读取响应式 ref 的 scrollTop.value，确保滚动事件触发切片重算
    const currentTop = Math.max(0, scrollTop.value);

    const rawStart = findStartIndex(currentTop);
    const startIndex = Math.max(0, rawStart - bufferCount);

    let rawEnd = startIndex;
    const targetBottom = currentTop + Math.max(viewportHeight.value, 600);
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

  let scrollRafId: number | null = null;
  const onScroll = (e?: Event) => {
    const el = (e?.target as HTMLElement) || scrollContainerRef.value;
    if (!el) return;
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      scrollTop.value = el.scrollTop;
      if (el.clientHeight > 0 && el.clientHeight !== viewportHeight.value) {
        viewportHeight.value = el.clientHeight;
      }
    });
  };

  const registerItemElement = (key: string, el: HTMLElement | null) => {
    if (!el) {
      const prevEl = observedElements.get(key);
      if (prevEl && itemResizeObserver) {
        itemResizeObserver.unobserve(prevEl);
        observedElements.delete(key);
      }
      return;
    }

    const prevEl = observedElements.get(key);
    if (prevEl && prevEl !== el && itemResizeObserver) {
      itemResizeObserver.unobserve(prevEl);
    }
    observedElements.set(key, el);

    if (itemResizeObserver) {
      itemResizeObserver.observe(el);
    }
    // 关键根治：仅将高度记录进 Map，严禁在 Vue 挂载周期直接触发 heightVersion.value++，由 RAF 异步结算
    const h = el.offsetHeight;
    if (h > 0 && measuredHeights.get(key) !== h) {
      measuredHeights.set(key, h);
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

  // 显式同步视口高度与位置
  const syncViewport = () => {
    const el = scrollContainerRef.value;
    if (el) {
      if (el.clientHeight > 0) viewportHeight.value = el.clientHeight;
      scrollTop.value = el.scrollTop;
    }
  };

  onUnmounted(() => {
    if (itemResizeObserver) {
      itemResizeObserver.disconnect();
      itemResizeObserver = null;
    }
    if (containerResizeObserver) {
      containerResizeObserver.disconnect();
      containerResizeObserver = null;
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
    syncViewport,
  };
}
