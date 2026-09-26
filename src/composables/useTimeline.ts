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

  // 【新增】月/日归档统计必须独立于分页与当前筛选状态，永远反映全库真实数据，
  // 否则一旦 quotes.value 只是当前加载/筛选出的子集，侧栏的天数/篇数统计就会失真。
  // 因此改为消费后端 get_timeline_stats（对全表做 GROUP BY，与分页完全解耦）。
  const remoteDayStats = ref<{
    quotes: Array<{ day: string; count: number }>;
    thoughts: Array<{ day: string; count: number }>;
  } | null>(null);

  const loadTimelineStats = async () => {
    try {
      const { invoke } = await import("../ipc-bridge");
      remoteDayStats.value = await invoke("get_timeline_stats");
    } catch (e) {
      console.error("加载时间轴统计失败:", e);
    }
  };

  const timelineArchiveGroups = computed<MonthArchiveGroup[]>(() => {
    const weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const stats = remoteDayStats.value;
    if (!stats) return [];

    const monthMap = new Map<
      string,
      { label: string; start: number; end: number; daysMap: Map<string, DayArchiveItem> }
    >();

    const ingest = (day: string, count: number, kind: "quote" | "thought") => {
      if (timeFilterScope.value !== "all" && timeFilterScope.value !== kind) return;
      const [y, m, dd] = day.split("-").map(Number);
      if (!y || !m || !dd) return;
      const mKey = `${y}-${String(m).padStart(2, "0")}`;
      const dKey = day;

      if (!monthMap.has(mKey)) {
        const mStart = new Date(y, m - 1, 1).getTime();
        const mEnd = new Date(y, m, 0, 23, 59, 59, 999).getTime();
        monthMap.set(mKey, {
          label: `${y} 年 ${String(m).padStart(2, "0")} 月`,
          start: mStart,
          end: mEnd,
          daysMap: new Map(),
        });
      }
      const mEntry = monthMap.get(mKey)!;
      if (!mEntry.daysMap.has(dKey)) {
        const d = new Date(y, m - 1, dd);
        const dStart = new Date(y, m - 1, dd, 0, 0, 0, 0).getTime();
        const dEnd = new Date(y, m - 1, dd, 23, 59, 59, 999).getTime();
        mEntry.daysMap.set(dKey, {
          key: dKey,
          label: `${String(m).padStart(2, "0")}月${String(dd).padStart(2, "0")}日`,
          dayOfWeek: weekNames[d.getDay()],
          start: dStart,
          end: dEnd,
          quoteCount: 0,
          thoughtCount: 0,
          totalCount: 0,
        });
      }
      const dEntry = mEntry.daysMap.get(dKey)!;
      if (kind === "quote") dEntry.quoteCount += count;
      else dEntry.thoughtCount += count;
      dEntry.totalCount += count;
    };

    (stats.quotes || []).forEach((r) => ingest(r.day, r.count, "quote"));
    (stats.thoughts || []).forEach((r) => ingest(r.day, r.count, "thought"));

    return Array.from(monthMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mKey, v]) => {
        const days = Array.from(v.daysMap.values()).sort((a, b) => b.key.localeCompare(a.key));
        const mTotal = days.reduce((sum, d) => sum + d.totalCount, 0);
        return { key: mKey, label: v.label, start: v.start, end: v.end, totalCount: mTotal, days };
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
    loadTimelineStats,
  };
}
