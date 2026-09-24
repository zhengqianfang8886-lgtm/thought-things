import { ref, computed, type Ref } from "vue";
import type { QuoteDetail, TimeFilterRange, MonthArchiveGroup, DayArchiveItem } from "../types";

export function useTimeline(
  quotes: Ref<QuoteDetail[]>,
  quoteLookupMap: Ref<Record<string, QuoteDetail>>
) {
  const isSidebarOpen = ref(localStorage.getItem("tr_sidebar_open") !== "false");
  const toggleSidebar = () => {
    isSidebarOpen.value = !isSidebarOpen.value;
    localStorage.setItem("tr_sidebar_open", String(isSidebarOpen.value));
  };

  const sidebarMode = ref<"tags" | "timeline">("tags");
  const timeFilterScope = ref<"all" | "quote" | "thought">("all");
  const selectedTimeRange = ref<TimeFilterRange | null>(null);
  const expandedTimelineMonths = ref<Record<string, boolean>>({});

  const toggleMonthTimelineExpand = (monthKey: string) => {
    expandedTimelineMonths.value[monthKey] = !isMonthTimelineExpanded(monthKey);
  };
  const isMonthTimelineExpanded = (monthKey: string): boolean => {
    return expandedTimelineMonths.value[monthKey] !== false;
  };

  const timelineArchiveGroups = computed<MonthArchiveGroup[]>(() => {
    const monthMap = new Map<
      string,
      {
        label: string;
        start: number;
        end: number;
        daysMap: Map<string, DayArchiveItem>;
      }
    >();

    const weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const universe =
      Object.values(quoteLookupMap.value).length > 0
        ? Object.values(quoteLookupMap.value)
        : quotes.value;

    universe.forEach((q) => {
      // 1. 原句时间点
      if (timeFilterScope.value === "all" || timeFilterScope.value === "quote") {
        const d = new Date(q.created_at);
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const dKey = `${mKey}-${String(d.getDate()).padStart(2, "0")}`;

        if (!monthMap.has(mKey)) {
          const mStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
          const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
          monthMap.set(mKey, {
            label: `${d.getFullYear()} 年 ${String(d.getMonth() + 1).padStart(2, "0")} 月`,
            start: mStart,
            end: mEnd,
            daysMap: new Map(),
          });
        }
        const mEntry = monthMap.get(mKey)!;
        if (!mEntry.daysMap.has(dKey)) {
          const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
          const dEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
          mEntry.daysMap.set(dKey, {
            key: dKey,
            label: `${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`,
            dayOfWeek: weekNames[d.getDay()],
            start: dStart,
            end: dEnd,
            quoteCount: 0,
            thoughtCount: 0,
            totalCount: 0,
          });
        }
        const dEntry = mEntry.daysMap.get(dKey)!;
        dEntry.quoteCount += 1;
        dEntry.totalCount += 1;
      }

      // 2. 年轮认知时间点
      if (timeFilterScope.value === "all" || timeFilterScope.value === "thought") {
        (q.thoughts || []).forEach((th) => {
          const d = new Date(th.created_at);
          const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const dKey = `${mKey}-${String(d.getDate()).padStart(2, "0")}`;

          if (!monthMap.has(mKey)) {
            const mStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
            const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
            monthMap.set(mKey, {
              label: `${d.getFullYear()} 年 ${String(d.getMonth() + 1).padStart(2, "0")} 月`,
              start: mStart,
              end: mEnd,
              daysMap: new Map(),
            });
          }
          const mEntry = monthMap.get(mKey)!;
          if (!mEntry.daysMap.has(dKey)) {
            const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
            const dEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
            mEntry.daysMap.set(dKey, {
              key: dKey,
              label: `${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`,
              dayOfWeek: weekNames[d.getDay()],
              start: dStart,
              end: dEnd,
              quoteCount: 0,
              thoughtCount: 0,
              totalCount: 0,
            });
          }
          const dEntry = mEntry.daysMap.get(dKey)!;
          dEntry.thoughtCount += 1;
          dEntry.totalCount += 1;
        });
      }
    });

    return Array.from(monthMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mKey, v]) => {
        const days = Array.from(v.daysMap.values()).sort((a, b) => b.key.localeCompare(a.key));
        const mTotal = days.reduce(
          (sum, d) =>
            sum +
            (timeFilterScope.value === "thought"
              ? d.thoughtCount
              : timeFilterScope.value === "quote"
              ? d.quoteCount
              : d.totalCount),
          0
        );
        return {
          key: mKey,
          label: v.label,
          start: v.start,
          end: v.end,
          totalCount: mTotal,
          days,
        };
      });
  });

  const quickTimePresets = computed(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
    const weekStart = todayStart - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

    return [
      { label: "⚡ 今日", start: todayStart, end: todayEnd },
      { label: "🌱 本周", start: weekStart, end: Date.now() },
      { label: "🌿 本月", start: monthStart, end: Date.now() },
      { label: "🌲 今年", start: yearStart, end: Date.now() },
    ];
  });

  const selectTimeFilter = (range: TimeFilterRange | null) => {
    if (selectedTimeRange.value?.label === range?.label) {
      selectedTimeRange.value = null;
    } else {
      selectedTimeRange.value = range;
    }
  };

  const getFilteredQuotes = (list: QuoteDetail[]): QuoteDetail[] => {
    if (!selectedTimeRange.value) return list;
    const { start, end } = selectedTimeRange.value;
    const scope = timeFilterScope.value;

    return list.filter((q) => {
      const qMatches = q.created_at >= start && q.created_at <= end;
      const thMatches = (q.thoughts || []).some((t) => t.created_at >= start && t.created_at <= end);

      if (scope === "quote") return qMatches;
      if (scope === "thought") return thMatches;
      return qMatches || thMatches;
    });
  };

  return {
    isSidebarOpen,
    sidebarMode,
    timeFilterScope,
    selectedTimeRange,
    expandedTimelineMonths,
    timelineArchiveGroups,
    quickTimePresets,
    toggleSidebar,
    selectTimeFilter,
    toggleMonthTimelineExpand,
    isMonthTimelineExpanded,
    getFilteredQuotes,
  };
}
