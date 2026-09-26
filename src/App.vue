<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { invoke } from "./ipc-bridge";
import TulipDecor from "./components/TulipDecor.vue";
import TreeRingStamp from "./components/TreeRingStamp.vue";
import { QuoteRefExtension } from "./extensions/QuoteRefExtension";
import TiptapEditor from "./components/TiptapEditor.vue";
import ImageLightboxModal from "./components/modals/ImageLightboxModal.vue";
import TagManagerModal from "./components/modals/TagManagerModal.vue";
import TagTrendsView from "./components/TagTrendsView.vue";


import type { Thought, QuoteDetail, AppLog, BacklinkItem } from "./types";
import { useSecurity } from "./composables/useSecurity";
import { useQuoteLinks } from "./composables/useQuoteLinks";
import { useRichText } from "./composables/useRichText";
import { useTags } from "./composables/useTags";
import { useTimeline } from "./composables/useTimeline";
import { useVirtualScroll } from "./composables/useVirtualScroll";
import { useKnowledgeBase } from "./composables/useKnowledgeBase";
import { TERMS } from "./constants/terms";

// ----------------- 日志与提示 -----------------
const isLogModalOpen = ref(false);
const logs = ref<AppLog[]>([]);
let logIdCounter = 0;

const addLog = (level: AppLog["level"], tag: string, msg: string) => {
  const d = new Date();
  const time = `${d.toTimeString().split(" ")[0]}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  logs.value.unshift({ id: ++logIdCounter, time, level, tag, msg });
  if (logs.value.length > 100) logs.value.pop();
};
const clearLogs = () => { logs.value = []; };

const toastMessage = ref<string | null>(null);
const showToast = (msg: string, duration: number = 2400) => {
  toastMessage.value = msg;
  window.setTimeout(() => { toastMessage.value = null; }, duration);
};

// ----------------- 平台与快捷键 -----------------
const isMac = ref(false);
const modifierKey = computed(() => (isMac.value ? "⌘" : "Ctrl"));

// ----------------- 核心数据与状态 (接入单一真理源) -----------------
const knowledgeBase = useKnowledgeBase();
const quotes = knowledgeBase.allQuotes;
const totalQuotesCount = knowledgeBase.totalQuotesCount;
// 全库真实总数，独立于任何筛选/分页状态，专供界面数字展示使用（见 loadData 内的刷新逻辑）
const libraryTotalCount = ref<number>(0);
const currentTab = ref<"capture" | "archive" | "pinned" | "trends">("capture");
const entryType = ref<0 | 1 | 2>(0); // 0: 客观摘录, 1: 待解之问, 2: 原生感悟
const isEntryQuestion = computed(() => entryType.value === 1);
const filterOnlyQuestions = ref(false);
const selectedEntryTypeFilter = ref<'all' | 'quote' | 'insight' | 'question' | 'has_thought'>('all');
const searchQuery = ref("");
const isSubmitting = ref(false);

// ----------------- 终生级游标分页流状态 -----------------
const nextCursor = ref<number | null>(null);
const hasMoreQuotes = ref(true);
const isLoadingMore = ref(false);
// (已统一收敛至 knowledgeBase.totalQuotesCount)

// ----------------- 领域子系统装配 -----------------
const richTextEngine = useRichText(showToast);

const tagsEngine = useTags(
  quotes,
  async () => { await loadData(); },
  showToast
);

// 侧栏标签树"快捷添加子标签"：预填父级路径后打开标签管理台
const tagManagerQuickAddParent = ref<string | null>(null);
const quickAddSidebarSubtag = (parentPath: string) => {
  tagManagerQuickAddParent.value = parentPath;
  tagsEngine.isTagManagerOpen.value = true;
};

const timelineEngine = useTimeline(quotes, computed(() => quoteLinksEngine.quoteLookupMap.value));

const quoteLinksEngine = useQuoteLinks(
  quotes,
  filterOnlyQuestions,
  tagsEngine.selectedTag,
  timelineEngine.selectedTimeRange,
  searchQuery,
  async () => { await loadData(); },
  showToast,
  tagsEngine.normalizeTagName,
  (targetId) => { virtualScrollEngine.scrollToKey(targetId); },
  () => { 
    if (focusQuote.value) closeFocusMode();
    currentTab.value = "archive"; 
  },
  selectedEntryTypeFilter,
  knowledgeBase.quoteLookupMap
);

const securityEngine = useSecurity(
  async () => {
    await loadData();
  },
  showToast
);

// 综合过滤数据
const displayedQuotes = computed(() => {
  // 1. 时间轴范围过滤
  let baseList = timelineEngine.getFilteredQuotes(quotes.value);

  // 2. 标签层级过滤 (支持父子标签包含)
  if (tagsEngine.selectedTag.value) {
    const selected = tagsEngine.normalizeTagName(tagsEngine.selectedTag.value);
    baseList = baseList.filter((item) => {
      const cardTags = (item.tags || []).map(tagsEngine.normalizeTagName);
      return cardTags.some((t) => t === selected || t.startsWith(selected + "/"));
    });
  }

  // 3. 全局搜索过滤
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    baseList = baseList.filter((item) => {
      const matchContent = item.content && item.content.toLowerCase().includes(q);
      const matchSource = item.source && item.source.toLowerCase().includes(q);
      const matchThoughts = (item.thoughts || []).some((t) => t.content && t.content.toLowerCase().includes(q));
      return matchContent || matchSource || matchThoughts;
    });
  }

  // 4. 分类透镜智能过滤 (摘录 / 感悟 / 问题 / 深入思考)
  if (selectedEntryTypeFilter.value === 'quote') {
    return baseList.filter((q) => q.is_question === 0);
  } else if (selectedEntryTypeFilter.value === 'insight') {
    return baseList.filter((q) => q.is_question === 2);
  } else if (selectedEntryTypeFilter.value === 'question') {
    return baseList.filter((q) => q.is_question === 1);
  } else if (selectedEntryTypeFilter.value === 'has_thought') {
    // 核心激活：仅返回至少拥有一条思考年轮的手记
    return baseList.filter((q) => q.thoughts && q.thoughts.length > 0);
  }

  return baseList;
});

// ----------------- 视口自适应虚拟滚动装配 -----------------
const archiveContainerRef = ref<HTMLElement | null>(null);

const virtualScrollEngine = useVirtualScroll<QuoteDetail>({
  items: displayedQuotes,
  estimatedItemHeight: 260,
  itemGap: 24,
  bufferCount: 4,
  virtualThreshold: 30, // 30 条以内直出渲染，大于 30 条启动虚拟视口
  keyGetter: (item) => item.id,
});

const handleArchiveScroll = (e: Event) => {
  virtualScrollEngine.onScroll(e);
  const el = e.target as HTMLElement;
  if (el) {
    // 距底部 320px 时无缝静默预拉取下一页，实现永不间断的时光漫卷
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
      loadMoreQuotes();
    }
  }
};

// ----------------- 常看聚焦看板 -----------------
const PINNED_STORAGE_KEY = "tr_pinned_quote_ids";
const pinnedQuoteIds = ref<string[]>([]);

const loadPinnedQuoteIds = () => {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    pinnedQuoteIds.value = raw ? JSON.parse(raw) : [];
  } catch {
    pinnedQuoteIds.value = [];
  }
};

const isCardPinned = (cardId: string): boolean => {
  return pinnedQuoteIds.value.includes(cardId);
};

const togglePinCard = (cardId: string) => {
  const idx = pinnedQuoteIds.value.indexOf(cardId);
  if (idx >= 0) {
    pinnedQuoteIds.value.splice(idx, 1);
    showToast("已从常看移除");
  } else {
    pinnedQuoteIds.value.unshift(cardId);
    showToast("🌟 已置顶于常看");
  }
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedQuoteIds.value));
};

const pinnedQuotesList = computed<QuoteDetail[]>(() => {
  const lookup = quoteLinksEngine.quoteLookupMap.value;
  const result: QuoteDetail[] = [];
  for (const id of pinnedQuoteIds.value) {
    if (lookup[id]) {
      result.push(lookup[id]);
    } else {
      const found = quotes.value.find((q) => q.id === id);
      if (found) result.push(found);
    }
  }
  return result;
});

// ----------------- 常看卡片原生拖拽排序管线 -----------------
const draggingPinnedIndex = ref<number | null>(null);
const dragOverPinnedIndex = ref<number | null>(null);

const handlePinnedDragStart = (e: DragEvent, index: number) => {
  draggingPinnedIndex.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
};

const handlePinnedDragOver = (e: DragEvent, index: number) => {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
  if (dragOverPinnedIndex.value !== index) {
    dragOverPinnedIndex.value = index;
  }
};

const handlePinnedDragLeave = (_e: DragEvent, index: number) => {
  if (dragOverPinnedIndex.value === index) {
    dragOverPinnedIndex.value = null;
  }
};

const handlePinnedDrop = (e: DragEvent, targetIndex: number) => {
  e.preventDefault();
  const sourceIndex = draggingPinnedIndex.value;
  draggingPinnedIndex.value = null;
  dragOverPinnedIndex.value = null;

  if (sourceIndex === null || sourceIndex === targetIndex) return;

  // 原地重排置顶 ID 数组
  const updatedIds = [...pinnedQuoteIds.value];
  const [movedId] = updatedIds.splice(sourceIndex, 1);
  updatedIds.splice(targetIndex, 0, movedId);

  pinnedQuoteIds.value = updatedIds;
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(updatedIds));
  showToast('✓ 已更新常看优先级顺序');
};

const handlePinnedDragEnd = () => {
  draggingPinnedIndex.value = null;
  dragOverPinnedIndex.value = null;
};

// ----------------- 卡片交互控制 -----------------
const activeActionCardId = ref<string | null>(null);
const handleCardClick = (cardId: string) => {
  activeActionCardId.value = cardId;
};
const handleCardMouseLeave = (cardId: string) => {
  if (activeActionCardId.value === cardId) activeActionCardId.value = null;
};

// 将富文本 HTML 彻底清洗为纯净文本 (剥离所有 HTML 标签并保留自然段落与清单换行)
const stripHtmlForCopy = (raw: string): string => {
  if (!raw) return "";
  let text = raw
    .replace(/\[quote:[^\]]+\]/g, "")
    .replace(/!\[.*?\]\(img:[^)]+\)/g, "[图片]")
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");

  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

// 判断 Tiptap 富文本 HTML 是否实质为空（剥离标签后无可见文本/图片标记）
// 修复：单纯 .trim() 无法识别 "<p></p>" 这类仅含格式标记的空内容
const isContentEmpty = (html: string): boolean => {
  if (!html) return true;
  const stripped = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return stripped.length === 0;
};

const copyQuoteSummary = async (card: QuoteDetail) => {
  try {
    const cleanContent = stripHtmlForCopy(card.content);
    const cleanSource = card.source ? stripHtmlForCopy(card.source) : "";
    const textToCopy = cleanSource
      ? `“${cleanContent}”\n—— ${cleanSource}`
      : cleanContent;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showToast("📋 已复制原句摘要");
  } catch {
    showToast("复制失败");
  }
};

// ----------------- 录入草稿与持久化 -----------------
const DRAFT_KEY_QUOTE = "tr_draft_quote";
const DRAFT_KEY_SOURCE = "tr_draft_source";
const DRAFT_KEY_THOUGHT = "tr_draft_thought";
const RECENT_SOURCES_KEY = "tr_recent_sources";

const inputQuote = ref(localStorage.getItem(DRAFT_KEY_QUOTE) || "");
const inputSource = ref(localStorage.getItem(DRAFT_KEY_SOURCE) || "");
const inputThought = ref(localStorage.getItem(DRAFT_KEY_THOUGHT) || "");
const isThoughtExpanded = ref(Boolean(inputThought.value && inputThought.value.trim()));

// 图片持久化与 TipTap 自动嵌入管线
const saveFileAndInsert = (file: File, targetEditor: any) => {
  const ext = file.name ? file.name.split(".").pop() || "png" : "png";
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const base64Str = ev.target?.result as string;
    if (base64Str) {
      try {
        const filename = await invoke<string>("save_image_base64", { base64Data: base64Str, extHint: ext });
        if (filename) {
          richTextEngine.resolveAndLoadImage(filename);
          const snippet = `\n![图片](img:${filename})\n`;
          if (targetEditor && targetEditor.chain) {
            targetEditor.chain().focus().insertContent(snippet).run();
          } else if (editor.value) {
            editor.value.chain().focus().insertContent(snippet).run();
          }
          showToast("📷 截图已载入");
        }
      } catch (err: any) {
        showToast("图片保存失败: " + (err?.message || err));
      }
    }
  };
  reader.readAsDataURL(file);
};

const handleEditorImagePaste = (event: ClipboardEvent, targetEditor: any): boolean => {
  const items = event.clipboardData?.items;
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        saveFileAndInsert(file, targetEditor);
        return true;
      }
    }
  }
  return false;
};

// 挂载现代工业级 Tiptap 所见即所得引擎
const editor = useEditor({
  content: inputQuote.value,
  extensions: [
    Underline,
    QuoteRefExtension,
    StarterKit.configure({
      heading: { levels: [1, 2] },
    }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: () => entryType.value === 1 ? '抛出探索心中的困惑与假设（支持加粗、高亮、清单实时所见即所得）...' : '在此录入客观原句摘录（支持加粗、高亮、清单实时所见即所得）...',
    }),
  ],
  editorProps: {
    handlePaste: (view, event) => handleEditorImagePaste(event, editor.value),
  },
  onUpdate: ({ editor: e }) => {
    inputQuote.value = e.getHTML();
  },
});

// 右侧伴随年轮 Tiptap 所见即所得引擎 (体验与左侧完全对齐)
const thoughtEditor = useEditor({
  content: inputThought.value,
  extensions: [
    Underline,
    QuoteRefExtension,
    StarterKit,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: () => '记录第一直觉、反思或线索（加粗、高亮、清单实时所见即所得）...',
    }),
  ],
  editorProps: {
    handlePaste: (view, event) => handleEditorImagePaste(event, thoughtEditor.value),
  },
  onUpdate: ({ editor: e }) => {
    inputThought.value = e.getHTML();
  },
});

onBeforeUnmount(() => {
  editor.value?.destroy();
  thoughtEditor.value?.destroy();
});
// 变量已前置初始化

watch(inputQuote, (val) => localStorage.setItem(DRAFT_KEY_QUOTE, val));
watch(inputSource, (val) => localStorage.setItem(DRAFT_KEY_SOURCE, val));
watch(inputThought, (val) => localStorage.setItem(DRAFT_KEY_THOUGHT, val));

const recentSources = ref<string[]>([]);
const loadRecentSources = () => {
  try {
    const raw = localStorage.getItem(RECENT_SOURCES_KEY);
    recentSources.value = raw ? JSON.parse(raw) : [];
  } catch {
    recentSources.value = [];
  }
};
const rememberSource = (src: string) => {
  const clean = src.trim();
  if (!clean) return;
  const filtered = recentSources.value.filter((s) => s !== clean);
  filtered.unshift(clean);
  recentSources.value = filtered.slice(0, 5);
  localStorage.setItem(RECENT_SOURCES_KEY, JSON.stringify(recentSources.value));
};

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const thoughtTextareaRef = ref<HTMLTextAreaElement | null>(null);

// 用户手动选择的模式具有绝对权威，不再根据问号强制篡改
const handleQuoteInput = () => {};



const handleCreateQuote = async () => {
  if (isContentEmpty(inputQuote.value)) return;
  if (tagsEngine.tagInputText.value.trim()) tagsEngine.pushTag(tagsEngine.tagInputText.value);
  isSubmitting.value = true;
  try {
    const src = inputSource.value.trim();
    if (src) rememberSource(src);

    await invoke("create_quote_with_thought", {
      content: inputQuote.value.trim(),
      source: src || null,
      isQuestion: entryType.value === 1,
      entryType: entryType.value,
      thought: inputThought.value.trim() || null,
      tags: tagsEngine.attachedTags.value.map(tagsEngine.normalizeTagName),
    });

    inputQuote.value = "";
    editor.value?.commands.clearContent();
    thoughtEditor.value?.commands.clearContent();
    inputSource.value = "";
    inputThought.value = "";
    localStorage.removeItem(DRAFT_KEY_QUOTE);
    localStorage.removeItem(DRAFT_KEY_SOURCE);
    localStorage.removeItem(DRAFT_KEY_THOUGHT);
    tagsEngine.attachedTags.value = [];
    entryType.value = 0;
    showToast("✨ 已收录入年轮");
    await loadData();
    // 保存成功后自动顺畅切入年轮主轴，看到刚长出的新卡片
    currentTab.value = "archive";
  } catch (err: any) {
    addLog("error", "SUBMIT", `录入失败: ${err?.message || err}`);
  } finally {
    isSubmitting.value = false;
  }
};

const loadData = async (reset = true) => {
  if (securityEngine.isAppLocked.value) return;
  if (reset) {
    nextCursor.value = null;
    hasMoreQuotes.value = true;
  }
  if (!reset && (!hasMoreQuotes.value || isLoadingMore.value)) return;
  try {
    const queryTag = tagsEngine.selectedTag.value;
    const querySearch = searchQuery.value.trim() ? searchQuery.value.trim() : null;
    const timeRange = timelineEngine.selectedTimeRange.value;

    // "🌱 深入思考"透镜依赖 thoughts 数量聚合，后端暂无索引化查询支持；
    // 为保证结果绝对完整（宁可牺牲这一种筛选下的分页收益，也不漏卡片），
    // 该透镜单独退回全量拉取，不影响其余筛选的分页行为。
    const needsFullFetch = selectedEntryTypeFilter.value === 'has_thought';

    const params: any = {
      tag: queryTag || null,
      search: querySearch,
      entryType: selectedEntryTypeFilter.value === 'quote' ? 0
        : selectedEntryTypeFilter.value === 'insight' ? 2
        : selectedEntryTypeFilter.value === 'question' ? 1
        : 'all',
    };
    if (timeRange) {
      params.startTs = timeRange.start;
      params.endTs = timeRange.end;
      params.timeScope = timelineEngine.timeFilterScope.value;
    }
    if (needsFullFetch) {
      params.all = true;
    } else {
      params.cursor = reset ? null : nextCursor.value;
      params.limit = 40;
    }

    // 与分页请求并发拉取"全库真实总数"与"时间轴统计"——两者都独立于当前筛选/
    // 分页状态查询全表，只在 reset（筛选条件变化/首次加载）时才需要刷新。
    const [res, grandTotal] = await Promise.all([
      invoke<any>("get_quotes", params),
      reset ? invoke<number>("get_total_quotes_count") : Promise.resolve(null),
      reset ? timelineEngine.loadTimelineStats() : Promise.resolve(null),
    ]);

    const items: QuoteDetail[] = Array.isArray(res) ? res : (res.items || []);
    const cursor = res.next_cursor !== undefined ? res.next_cursor : null;
    const more = res.has_more !== undefined ? res.has_more : false;
    const total = res.total_count !== undefined ? res.total_count : items.length;

    knowledgeBase.setQuotes(items, total, !reset && !needsFullFetch);

    nextCursor.value = needsFullFetch ? null : cursor;
    hasMoreQuotes.value = needsFullFetch ? false : more;
    if (reset && grandTotal !== null) {
      libraryTotalCount.value = grandTotal;
    }
    tagsEngine.tagStats.value = await invoke("get_tag_stats");
    richTextEngine.scanAllImages(items);
  } catch (err) {
    console.error("加载年轮失败:", err);
  }
};

const loadMoreQuotes = async () => {
  if (isLoadingMore.value || !hasMoreQuotes.value || securityEngine.isAppLocked.value) return;
  isLoadingMore.value = true;
  try {
    await loadData(false);
  } finally {
    isLoadingMore.value = false;
  }
};

let debounceTimer: number | null = null;
const handleSearchInput = () => {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    loadData();
  }, 160);
};

// 搜索框一键快速清空
const clearSearchQuery = () => {
  searchQuery.value = "";
  loadData();
};

// 是否激活了任意筛选条件 (用于第二轨弹性胶囊池显隐)
const hasActiveConstraints = computed(() => {
  return Boolean(
    tagsEngine.selectedTag.value !== null ||
    timelineEngine.selectedTimeRange.value !== null
  );
});

const resetAllConstraints = () => {
  tagsEngine.selectedTag.value = null;
  timelineEngine.selectedTimeRange.value = null;
};

// ----------------- 年轮延伸与编辑 -----------------
const activeAppendQuoteId = ref<string | null>(null);
const appendThoughtContent = ref("");
const editingThoughtId = ref<string | null>(null);
const editingThoughtText = ref("");

// 全局心流沉浸模态编辑状态
const zenEditorRef = ref<any>(null);
const zenEditState = ref({
  isOpen: false,
  type: 'thought' as 'quote' | 'thought',
  id: '',
  title: '沉浸式编辑思维年轮',
  content: ''
});

const openZenEditForThought = (t: Thought) => {
  const textToEdit = (editingThoughtId.value === t.id && editingThoughtText.value)
    ? editingThoughtText.value
    : t.content;

  zenEditState.value = {
    isOpen: true,
    type: 'thought',
    id: t.id,
    title: '沉浸式编辑 · 思维年轮',
    content: textToEdit
  };
};

const openZenEditForQuote = (card: QuoteDetail) => {
  const textToEdit = (editingQuoteId.value === card.id && editingQuoteContent.value)
    ? editingQuoteContent.value
    : card.content;

  zenEditState.value = {
    isOpen: true,
    type: 'quote',
    id: card.id,
    title: '沉浸式编辑 · 典藏原句',
    content: textToEdit
  };
};

const cancelZenEdit = () => {
  zenEditState.value.isOpen = false;
};

const saveZenEdit = async () => {
  if (!zenEditState.value.isOpen) return;

  // 1. 【核心突破】直接穿透 TipTap 实例直取实时 HTML，杜绝 v-model 异步延迟造成的丢字与空值
  let liveHtml = '';
  if (zenEditorRef.value?.editor) {
    liveHtml = zenEditorRef.value.editor.getHTML();
  } else {
    liveHtml = zenEditState.value.content || '';
  }

  const cleanContent = liveHtml.trim();

  // 校验实质内容
  const stripped = cleanContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
  if (!stripped && !cleanContent.includes('<img')) {
    showToast("内容不能为空");
    return;
  }

  const { type, id } = zenEditState.value;
  // 2. 立即关闭弹窗
  zenEditState.value.isOpen = false;

  try {
    if (type === 'thought') {
      // 3. 关闭行内编辑状态，防止卡片旧状态占位
      editingThoughtId.value = null;
      editingThoughtText.value = "";

      // 4. 写入 SQLite 数据库
      await invoke("update_thought", { thoughtId: id, content: cleanContent });
      richTextEngine.extractAndPreload(cleanContent);
      showToast("✓ 年轮思考已保存");

    } else if (type === 'quote') {
      // 3. 关闭原句行内编辑状态
      editingQuoteId.value = null;
      editingQuoteContent.value = "";
      editingQuoteSource.value = "";

      const card = knowledgeBase.getQuote(id) || quotes.value.find(q => q.id === id);
      const source = card?.source || null;
      const entryType = card?.is_question !== undefined ? card.is_question : 0;

      // 4. 写入 SQLite 数据库
      await invoke("update_quote", {
        quoteId: id,
        content: cleanContent,
        source,
        isQuestion: entryType === 1,
        entryType
      });
      richTextEngine.extractAndPreload(cleanContent);
      showToast("✓ 原句已保存");
    }

    // 5. 【关键刷新】重新拉取最新数据，触发全界面 100% 响应式重绘！
    await loadData(false);

  } catch (err: any) {
    showToast("保存失败: " + (err?.message || err));
  }
};

const startAppendThought = (quoteId: string) => {
  appendThoughtContent.value = "";
  activeAppendQuoteId.value = quoteId;
};

const handleAppendThought = async (quoteId: string) => {
  if (isContentEmpty(appendThoughtContent.value)) return;
  const content = appendThoughtContent.value.trim();
  appendThoughtContent.value = "";
  activeAppendQuoteId.value = null;

  try {
    const thoughtId = await invoke<string>("append_thought", { quoteId, content });
    
    // 1. 【真理源原子追加】单点修改，所有卡片流与关联视图自动生效
    const now = Date.now();
    knowledgeBase.appendThought(quoteId, {
      id: thoughtId || String(now),
      quote_id: quoteId,
      content,
      created_at: now,
      updated_at: now,
    });

    richTextEngine.extractAndPreload(content);
    showToast("🌱 年轮已萌新芽");
  } catch (err: any) {
    showToast("追加失败: " + (err?.message || err));
  }
};

const startEditThought = (thought: Thought) => {
  editingThoughtId.value = thought.id;
  editingThoughtText.value = thought.content;
};

const saveEditThought = async () => {
  if (!editingThoughtId.value || isContentEmpty(editingThoughtText.value)) return;
  const targetThoughtId = editingThoughtId.value;
  const newContent = editingThoughtText.value.trim();

  // 1. 【真理源原子更新】
  knowledgeBase.updateThoughtContent(targetThoughtId, newContent);

  editingThoughtId.value = null;
  editingThoughtText.value = "";
  richTextEngine.extractAndPreload(newContent);
  showToast("✓ 已更新认知");

  try {
    await invoke("update_thought", { thoughtId: targetThoughtId, content: newContent });
  } catch (err: any) {
    showToast("保存失败: " + (err?.message || err));
  }
};

const pendingDeleteThoughtId = ref<string | null>(null);
let deleteThoughtTimer: number | null = null;
const requestDeleteThought = (thoughtId: string) => {
  if (pendingDeleteThoughtId.value === thoughtId) {
    if (deleteThoughtTimer) clearTimeout(deleteThoughtTimer);
    pendingDeleteThoughtId.value = null;
    doDeleteThought(thoughtId);
  } else {
    pendingDeleteThoughtId.value = thoughtId;
    if (deleteThoughtTimer) clearTimeout(deleteThoughtTimer);
    deleteThoughtTimer = window.setTimeout(() => {
      pendingDeleteThoughtId.value = null;
    }, 3000);
  }
};

const doDeleteThought = async (thoughtId: string) => {
  let parentQuoteId: string | null = null;
  let targetThought: Thought | null = null;
  for (const q of knowledgeBase.allQuotes.value) {
    const t = q.thoughts.find((th) => th.id === thoughtId);
    if (t) {
      parentQuoteId = q.id;
      targetThought = JSON.parse(JSON.stringify(t));
      break;
    }
  }

  // 1. 内存中 0ms 瞬间抹除
  knowledgeBase.removeThought(thoughtId);

  // 2. 将完整对象推入长效撤销栈（只要不关软件，随时撤销）
  if (parentQuoteId && targetThought) {
    undoStack.value.push({
      id: thoughtId,
      type: 'thought',
      title: '年轮认知',
      data: { quoteId: parentQuoteId, thought: targetThought },
    });
    if (undoStack.value.length > 50) undoStack.value.shift();
  }

  showToast('🗑️ 已删除年轮认知 (按 Ctrl+Z 可随时撤销)');

  // 3. 异步物理同步数据库
  try {
    await invoke("delete_thought", { thoughtId });
  } catch (e) {
    console.error("物理删除思考失败", e);
  }
};

const pendingDeleteQuoteId = ref<string | null>(null);
let deleteQuoteTimer: number | null = null;
const requestDeleteQuote = (quoteId: string) => {
  if (pendingDeleteQuoteId.value === quoteId) {
    if (deleteQuoteTimer) clearTimeout(deleteQuoteTimer);
    pendingDeleteQuoteId.value = null;
    doDeleteQuote(quoteId);
  } else {
    pendingDeleteQuoteId.value = quoteId;
    if (deleteQuoteTimer) clearTimeout(deleteQuoteTimer);
    deleteQuoteTimer = window.setTimeout(() => {
      pendingDeleteQuoteId.value = null;
    }, 3000);
  }
};

// ----------------- 会话级长效撤销栈 (Desktop-Grade Undo History Stack) -----------------
interface UndoStackAction {
  id: string;
  type: 'quote' | 'thought';
  title: string;
  data: any;
}
// 维护真正的历史撤销栈，只要软件开着，永久可逐层撤回（上限 50 步）
const undoStack = ref<UndoStackAction[]>([]);
const hasUndoHistory = computed(() => undoStack.value.length > 0);

const executeUndo = async () => {
  if (undoStack.value.length === 0) return;
  const action = undoStack.value.pop()!;

  if (action.type === 'quote') {
    const card = action.data as QuoteDetail;
    // 1. 0ms 瞬间复原内存真理源
    knowledgeBase.upsertQuote(card);
    showToast(`✓ 已恢复手记: ${action.title} (按 Ctrl+Z 可继续撤销)`);

    // 2. 界面定位回该卡片并亮起到达动效
    await nextTick();
    virtualScrollEngine.scrollToKey(action.id);
    quoteLinksEngine.highlightedQuoteId.value = action.id;
    setTimeout(() => {
      if (quoteLinksEngine.highlightedQuoteId.value === action.id) {
        quoteLinksEngine.highlightedQuoteId.value = null;
      }
    }, 2400);

    // 3. 将整篇手记完整回写至底层 SQLite 数据库
    try {
      await invoke("import_backup", {
        jsonStr: JSON.stringify({ records: [card] })
      });
    } catch (e) {
      console.error("恢复手记落盘失败:", e);
    }

  } else if (action.type === 'thought') {
    const { quoteId, thought } = action.data;
    // 1. 内存真理源追加
    knowledgeBase.appendThought(quoteId, thought);
    showToast(`✓ 已恢复思维年轮`);
    await nextTick();
    virtualScrollEngine.scrollToKey(quoteId);

    // 2. 回写思考到数据库
    try {
      await invoke("append_thought", {
        quoteId: quoteId,
        content: thought.content
      });
    } catch (e) {
      console.error("恢复思考落盘失败:", e);
    }
  }
};

const doDeleteQuote = async (quoteId: string) => {
  const card = knowledgeBase.getQuote(quoteId);
  if (!card) return;
  const snapshot = JSON.parse(JSON.stringify(card));

  // 1. 内存中 0ms 瞬间抹除
  knowledgeBase.removeQuote(quoteId);
  if (focusQuote.value && focusQuote.value.id === quoteId) closeFocusMode();

  // 2. 推入会话长效撤销栈 (支持任意时刻按 Ctrl+Z 找回)
  const cleanTitle = card.source ? `《${card.source}》` : (card.content.replace(/<[^>]+>/g, '').slice(0, 14) || '手记');
  undoStack.value.push({
    id: quoteId,
    type: 'quote',
    title: cleanTitle,
    data: snapshot,
  });
  if (undoStack.value.length > 50) undoStack.value.shift();

  showToast(`🗑️ 已删除 ${cleanTitle} (按 Ctrl+Z 随时恢复)`);

  // 3. 底层数据库即刻执行物理删除，保证底层数据纯净
  try {
    await invoke("delete_quote", { quoteId });
  } catch (e) {
    console.error("物理删除落盘失败", e);
  }
};

const handleToggleResolved = async (quoteId: string) => {
  try {
    await invoke("toggle_resolved", { quoteId });
    await loadData();
  } catch (err) {
    console.error(err);
  }
};

const editingQuoteId = ref<string | null>(null);
const editingQuoteContent = ref("");
const editingQuoteSource = ref("");
const editingQuoteIsQuestion = ref(false);
const editingEntryType = ref<0 | 1 | 2>(0);

const startEditQuote = (card: QuoteDetail) => {
  editingQuoteId.value = card.id;
  editingQuoteContent.value = card.content;
  editingQuoteSource.value = card.source || "";
  editingQuoteIsQuestion.value = card.is_question === 1;
editingEntryType.value = (card.is_question as any) || 0;
};

const cancelEditQuote = () => {
  editingQuoteId.value = null;
  editingQuoteContent.value = "";
  editingQuoteSource.value = "";
};

const saveEditQuote = async () => {
  if (!editingQuoteId.value || isContentEmpty(editingQuoteContent.value)) return;
  const targetId = editingQuoteId.value;
  const newContent = editingQuoteContent.value.trim();
  const newSource = editingQuoteSource.value.trim() || null;
  // 1. 【真理源单点更新】所有引用与卡片同步完成更新
  knowledgeBase.updateQuoteContent(targetId, newContent, newSource, editingEntryType.value);

  // 关闭编辑窗口
  editingQuoteId.value = null;
  richTextEngine.extractAndPreload(newContent);
  showToast("✓ 原句内容已更新");

  try {
    await invoke("update_quote", {
      quoteId: targetId,
      content: newContent,
      source: newSource,
      isQuestion: editingEntryType.value === 1,
      entryType: editingEntryType.value,
    });
  } catch (err: any) {
    showToast("更新失败: " + (err?.message || err));
    await loadData(); // 失败才安全回滚
  }
};

// 折叠管理
const expandedQuoteTexts = ref<Record<string, boolean>>({});
const expandedThoughtTexts = ref<Record<string, boolean>>({});
const expandedThoughtRings = ref<Record<string, boolean>>({});

const toggleQuoteExpand = (id: string) => { expandedQuoteTexts.value[id] = !expandedQuoteTexts.value[id]; };
const toggleThoughtExpand = (id: string) => { expandedThoughtTexts.value[id] = !expandedThoughtTexts.value[id]; };
const toggleCardThoughtsExpand = (cardId: string) => { expandedThoughtRings.value[cardId] = !isCardThoughtsExpanded(cardId); };
const isCardThoughtsExpanded = (cardId: string): boolean => { return expandedThoughtRings.value[cardId] === true; };

// ----------------- 反向链接 / 知识脉络回响 (由图谱引擎纯响应式驱动) -----------------
const expandedBacklinkCardIds = ref<Record<string, boolean>>({});

// 纯前端本地 0ms 开关，数据直通 knowledgeBase，彻底告别旧缓存与网络等待
const toggleBacklinks = async (quoteId: string) => {
  const willExpand = !expandedBacklinkCardIds.value[quoteId];
  expandedBacklinkCardIds.value[quoteId] = willExpand;
  if (willExpand) {
    // 0ms 打开抽屉，按需异步拉取该条手记的精准反链明细，杜绝全库扫表
    await knowledgeBase.loadBacklinksForQuote(quoteId);
  }
};

// 专注模式
const focusQuote = ref<QuoteDetail | null>(null);
const focusThoughtInput = ref("");

const openFocusMode = (card: QuoteDetail) => {
  focusQuote.value = card;
  focusThoughtInput.value = "";
};

const closeFocusMode = () => {
  focusQuote.value = null;
  focusThoughtInput.value = "";
  isQuoteRefPickerOpen.value = false;
  quoteLinksEngine.viewingQuoteRef.value = null;
};

const handleAppendThoughtInFocus = async () => {
  if (!focusQuote.value || isContentEmpty(focusThoughtInput.value)) return;
  const targetQuoteId = focusQuote.value.id;
  const content = focusThoughtInput.value.trim();
  focusThoughtInput.value = "";

  try {
    const thoughtId = await invoke<string>("append_thought", {
      quoteId: targetQuoteId,
      content,
    });

    // 1. 【前端 0ms 乐观插入】立即推入专注视图当前卡片的年轮列表，页面瞬间长出新轮！
    const now = Date.now();
    const newThought: Thought = {
      id: thoughtId || String(now),
      quote_id: targetQuoteId,
      content,
      created_at: now,
      updated_at: now,
    };

    if (!focusQuote.value.thoughts) {
      focusQuote.value.thoughts = [];
    }
    focusQuote.value.thoughts.push(newThought);

    // 单一真理源已自动同步全部视图
    knowledgeBase.appendThought(targetQuoteId, newThought);

    richTextEngine.extractAndPreload(content);
    showToast("🌱 年轮已延伸");

    // 2. 异步落盘并与后端数据库校验同步
    await loadData();

    // 维持响应式引用最新
    const refreshed = quotes.value.find((q) => q.id === targetQuoteId) || quoteLinksEngine.quoteLookupMap.value[targetQuoteId];
    if (refreshed && focusQuote.value) {
      focusQuote.value = refreshed;
    }
  } catch (err: any) {
    showToast("追加失败: " + (err?.message || err));
  }
};

// 引用选择器
const isQuoteRefPickerOpen = ref(false);
const quoteRefSearchQuery = ref("");
let activeInsertTarget: HTMLTextAreaElement | string | null = null;
const activeTiptapEditor = ref<any>(null);

// 【关键修复】引用选择器必须能检索全库范围内的摘录，而不仅仅是当前已加载分页
// 中恰好存在的条目——否则会出现"明明存在却搜不到"的假空结果。因此始终直接
// 向后端发起检索，而不是过滤客户端内存中的 quoteLookupMap。
const availableQuoteList = ref<QuoteDetail[]>([]);
const isQuoteRefSearchLoading = ref(false);
let quoteRefSearchDebounceTimer: number | null = null;

const runQuoteRefSearch = async () => {
  isQuoteRefSearchLoading.value = true;
  try {
    const q = quoteRefSearchQuery.value.trim();
    const res = await invoke<any>("get_quotes", {
      entryType: 0,
      search: q || null,
      cursor: null,
      limit: 60,
    });
    const items: QuoteDetail[] = Array.isArray(res) ? res : (res.items || []);
    availableQuoteList.value = items;
    // 顺手回填单一真理源，插入引用后立即能在别处正确渲染标题
    for (const it of items) {
      knowledgeBase.upsertQuote(it);
    }
  } catch (err) {
    console.error("引用检索失败:", err);
  } finally {
    isQuoteRefSearchLoading.value = false;
  }
};

watch(quoteRefSearchQuery, () => {
  if (quoteRefSearchDebounceTimer) window.clearTimeout(quoteRefSearchDebounceTimer);
  quoteRefSearchDebounceTimer = window.setTimeout(runQuoteRefSearch, 180);
});

const openQuoteRefPicker = (target: any) => {
  if (target && typeof target === 'object' && target.chain) {
    activeTiptapEditor.value = target;
    activeInsertTarget = 'tiptap';
  } else {
    activeInsertTarget = target;
  }
  quoteRefSearchQuery.value = "";
  runQuoteRefSearch();
  isQuoteRefPickerOpen.value = true;
};

const insertQuoteRefLink = (quoteId: string) => {
  const targetQuote = knowledgeBase.getQuote(quoteId) || quoteLinksEngine.quoteLookupMap.value[quoteId];
  const plainText = (targetQuote?.content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[|\]\[]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const rawTitle = targetQuote?.source ? targetQuote.source : plainText.slice(0, 16);
  const cleanTitle = (rawTitle || "摘录原句").replace(/[|\]\[]/g, '').trim();

  // 维度二核心飞跃：直接向 TipTap 注入原生原子实体节点，编辑态再无代码！
  if (activeInsertTarget === 'tiptap' && activeTiptapEditor.value) {
    activeTiptapEditor.value.chain().focus().insertContent({
      type: 'quoteRef',
      attrs: { quoteId, title: cleanTitle }
    }).run();
    isQuoteRefPickerOpen.value = false;
    showToast("🔗 已插入原子引用胶囊");
    return;
  }
  if (activeInsertTarget === 'editor' || !activeInsertTarget) {
    editor.value?.chain().focus().insertContent({
      type: 'quoteRef',
      attrs: { quoteId, title: cleanTitle }
    }).run();
    isQuoteRefPickerOpen.value = false;
    showToast("🔗 已插入原子引用胶囊");
    return;
  } else if (activeInsertTarget === 'thoughtEditor') {
    thoughtEditor.value?.chain().focus().insertContent({
      type: 'quoteRef',
      attrs: { quoteId, title: cleanTitle }
    }).run();
    isQuoteRefPickerOpen.value = false;
    showToast("🔗 已插入原子引用胶囊");
    return;
  }

  isQuoteRefPickerOpen.value = false;
  showToast("🔗 已插入原子引用胶囊");
};

// 富文本点击代理
const handleRichContainerClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const quoteBadge = target.closest(".quote-link-badge") as HTMLElement | null;
  if (quoteBadge) {
    e.stopPropagation();
    const refId = quoteBadge.getAttribute("data-ref-quote-id");
    if (refId) {
      if (focusQuote.value) {
        const q = quoteLinksEngine.quoteLookupMap.value[refId] || quotes.value.find((item) => item.id === refId);
        if (q) quoteLinksEngine.viewingQuoteRef.value = q;
        return;
      }
      const sourceCardEl = quoteBadge.closest("article[id^='quote_card_']") as HTMLElement | null;
      const sourceCardId = sourceCardEl ? sourceCardEl.id.replace("quote_card_", "") : undefined;
      quoteLinksEngine.jumpToQuote(refId, sourceCardId);
    }
    return;
  }

  const imgTrigger = target.closest(".preview-trigger") as HTMLElement | null;
  if (imgTrigger) {
    const filename = imgTrigger.getAttribute("data-preview-img");
    if (filename && richTextEngine.loadedImageMap.value[filename] && richTextEngine.loadedImageMap.value[filename] !== "ERROR") {
      richTextEngine.previewModalImage.value = richTextEngine.loadedImageMap.value[filename];
    }
  }
};

// 偏好设置
const isSettingsOpen = ref(false);
const systemFonts = ref<string[]>([]);
const isScanningFonts = ref(false);
const currentFontFamily = ref(localStorage.getItem("tr_font_family") || "system-ui");
const fontSearchFilter = ref("");
const isExporting = ref(false);
const isBackupModalOpen = ref(false);
const lastBackupTime = ref(localStorage.getItem("tr_last_backup_time") || null);
const isCreatingSnapshot = ref(false);

const handleTriggerJsonBackup = async () => {
  await handleExportBackup();
  const nowStr = new Date().toLocaleString();
  lastBackupTime.value = nowStr;
  localStorage.setItem("tr_last_backup_time", nowStr);
};

const handleCreateDbSnapshot = async () => {
  isCreatingSnapshot.value = true;
  try {
    const res = await invoke<any>("create_db_snapshot");
    if (res && res.filename) {
      showToast(`✓ SQLite 物理热快照已生成: ${res.filename}`);
      const nowStr = new Date().toLocaleString();
      lastBackupTime.value = nowStr;
      localStorage.setItem("tr_last_backup_time", nowStr);
    }
  } catch (err: any) {
    showToast("生成快照失败: " + (err?.message || err));
  } finally {
    isCreatingSnapshot.value = false;
  }
};

const handleOpenDataFolder = async () => {
  try {
    await invoke("open_user_data_folder");
  } catch (err: any) {
    showToast("无法打开目录: " + (err?.message || err));
  }
};

const isCleaningImages = ref(false);

const handleCleanOrphanImages = async () => {
  isCleaningImages.value = true;
  try {
    const res = await invoke<{ deleted_count: number; freed_bytes: number }>("clean_orphan_images");
    showToast(`✓ 已清理 ${res.deleted_count} 张孤立图片`);
  } catch (err: any) {
    showToast("清理失败: " + (err?.message || err));
  } finally {
    isCleaningImages.value = false;
  }
};

const handleExportMarkdownVault = async () => {
  try {
    const mdStr = await invoke<string>("export_markdown_vault");
    const blob = new Blob([mdStr], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ThoughtRings-Vault-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✓ 终生 Markdown 知识库已下载");
  } catch (err: any) {
    showToast("导出 Markdown 失败: " + (err?.message || err));
  }
};

const handleExportBackup = async () => {
  try {
    isExporting.value = true;
    const jsonStr = await invoke<string>("export_backup");
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thought-rings-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("备份文件已下载");
  } catch {
    showToast("导出失败");
  } finally {
    isExporting.value = false;
  }
};

const filteredSystemFonts = computed(() => {
  const q = fontSearchFilter.value.trim().toLowerCase();
  if (!q) return systemFonts.value.slice(0, 80);
  return systemFonts.value.filter((f) => f.toLowerCase().includes(q)).slice(0, 80);
});

const scanLocalFonts = async () => {
  isScanningFonts.value = true;
  try {
    systemFonts.value = await invoke<string[]>("get_system_fonts");
  } catch (err) {
    console.error(err);
  } finally {
    isScanningFonts.value = false;
  }
};

const applyFontFamily = (family: string) => {
  currentFontFamily.value = family;
  localStorage.setItem("tr_font_family", family);
  document.documentElement.style.setProperty("--font-custom", `"${family}", system-ui, sans-serif`);
};

const currentTheme = ref(localStorage.getItem("tr_theme") || "tulip");
const currentFontSize = ref(localStorage.getItem("tr_font_size") || "normal");

const applySettings = () => {
  document.documentElement.setAttribute("data-theme", currentTheme.value);
  localStorage.setItem("tr_theme", currentTheme.value);
  localStorage.setItem("tr_font_size", currentFontSize.value);
  if (currentFontFamily.value) {
    document.documentElement.style.setProperty("--font-custom", `"${currentFontFamily.value}", system-ui, sans-serif`);
  }
};

watch([currentTheme, currentFontSize], applySettings);

watch(currentTab, (newTab) => {
  if (newTab === 'archive') {
    nextTick(() => {
      if (archiveContainerRef.value) {
        virtualScrollEngine.scrollContainerRef.value = archiveContainerRef.value;
        virtualScrollEngine.syncViewport();
      }
    });
  }
});

// (全量数据已常驻内存，分类切换由 computed 0ms 即时响应)

// 剪贴板与本地图文
const fileInputRef = ref<HTMLInputElement | null>(null);
const triggerSelectImage = () => { fileInputRef.value?.click(); };

const handleFileInputChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const ext = file.name.split(".").pop() || "png";
  const reader = new FileReader();
  reader.onload = async (event) => {
    const base64Str = event.target?.result as string;
    if (base64Str) {
      try {
        const filename = await invoke<string>("save_image_base64", { base64Data: base64Str, extHint: ext });
        richTextEngine.resolveAndLoadImage(filename);
        editor.value?.chain().focus().insertContent(`\n![图片](img:${filename})\n`).run();
        showToast("📷 图片已存入");
      } catch {
        showToast("保存失败");
      }
    }
  };
  reader.readAsDataURL(file);
  target.value = "";
};

const smartPasteButtonAction = async () => {
  try {
    const directFilename = await invoke<string>("paste_clipboard_image");
    if (directFilename) {
      richTextEngine.resolveAndLoadImage(directFilename);
      editor.value?.chain().focus().insertContent(`\n![图片](img:${directFilename})\n`).run();
      showToast("📷 截图已载入");
      return;
    }
  } catch {}

  let text = "";
  try { text = await navigator.clipboard.readText(); } catch {
    try { text = await invoke<string>("read_system_clipboard"); } catch {}
  }

  if (text) {
    editor.value?.chain().focus().insertContent(text).run();
    showToast("已粘贴文本");
  }
};

const formatDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const formatShortDate = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const getRingTimeSpan = (baseTs: number, thoughtTs: number): string => {
  const diffMs = thoughtTs - baseTs;
  if (diffMs < 60 * 1000) return "片刻后";
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) return `+${diffMinutes}分钟`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `+${diffHours}小时`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `+${diffDays}天沉淀`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `+${diffMonths}个月`;
  return `+${(diffDays / 365).toFixed(1)}年`;
};

// 键盘调度
const handleGlobalKeyDown = (e: KeyboardEvent) => {
  if ((e.altKey && e.key === "ArrowLeft") || (isMac.value && e.metaKey && e.key === "[")) {
    if (quoteLinksEngine.navStack.value.length > 0) {
      e.preventDefault();
      quoteLinksEngine.jumpBackToSource();
      return;
    }
  }

  if (e.key === "Escape") {
    if (isBackupModalOpen.value) { isBackupModalOpen.value = false; return; }
    if (activeActionCardId.value) { activeActionCardId.value = null; return; }
    if (isQuoteRefPickerOpen.value) { isQuoteRefPickerOpen.value = false; return; }
    if (quoteLinksEngine.viewingQuoteRef.value) { quoteLinksEngine.viewingQuoteRef.value = null; return; }
    if (focusQuote.value) { closeFocusMode(); return; }
    if (richTextEngine.previewModalImage.value) { richTextEngine.previewModalImage.value = null; return; }
    if (tagsEngine.isTagManagerOpen.value) { tagsEngine.isTagManagerOpen.value = false; return; }
    if (tagsEngine.isTagPickerModalOpen.value) { tagsEngine.isTagPickerModalOpen.value = false; return; }
    if (isLogModalOpen.value) { isLogModalOpen.value = false; return; }
    if (isSettingsOpen.value) { isSettingsOpen.value = false; return; }
    if (editingQuoteId.value) { cancelEditQuote(); return; }
    if (activeAppendQuoteId.value) { activeAppendQuoteId.value = null; return; }
  }

  const isMod = isMac.value ? e.metaKey : e.ctrlKey;
  if (isMod) {
    // 监听 Ctrl+Z / Cmd+Z：当存在待撤销操作且未处于输入框内部编辑时，瞬间触发撤销恢复
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true' ||
        activeEl.classList.contains('ProseMirror')
      );
      if (!isTyping && hasUndoHistory.value) {
        e.preventDefault();
        executeUndo();
        return;
      }
    }

    if (e.key === "\\") {
      e.preventDefault();
      timelineEngine.toggleSidebar();
    } else if (securityEngine.isAppLocked.value) return;
    else if (e.key === "1") { e.preventDefault(); currentTab.value = "capture"; }
    else if (e.key === "2") { e.preventDefault(); currentTab.value = "archive"; }
    else if (e.key === "3") { e.preventDefault(); currentTab.value = "pinned"; }
    else if (e.key === "4") { e.preventDefault(); currentTab.value = "trends"; }
    else if (e.key === "Enter" && currentTab.value === "capture") { e.preventDefault(); handleCreateQuote(); }
    else if (e.key === "l") { e.preventDefault(); securityEngine.lockAppNow(); }
    else if (e.key === "d") { e.preventDefault(); isLogModalOpen.value = !isLogModalOpen.value; }
  }
};

onMounted(async () => {
  isMac.value = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  applySettings();
  loadRecentSources();
  scanLocalFonts();
  loadPinnedQuoteIds();

  if (archiveContainerRef.value) {
    virtualScrollEngine.scrollContainerRef.value = archiveContainerRef.value;
  }

  await securityEngine.initSecurity(async () => {
    await loadData();
  });

  window.addEventListener("keydown", handleGlobalKeyDown);
});

// ----------------- 灵感漫游与年轮闪回 -----------------
const isResurfaceModalOpen = ref(false);
const isResurfaceLoading = ref(false);
const resurfaceData = ref<{
  card: QuoteDetail;
  prompt_title: string;
  days_ago: number;
  reason_tag: string;
} | null>(null);
const resurfaceThoughtInput = ref("");
const isResurfaceSubmitting = ref(false);

const openResurfaceModal = async () => {
  isResurfaceLoading.value = true;
  resurfaceThoughtInput.value = "";
  try {
    const res = await invoke<any>("get_resurface_quote");
    if (!res) {
      showToast("手记年轮空空如也，先记录几条笔记吧 🌱");
      return;
    }
    resurfaceData.value = res;
    richTextEngine.extractAndPreload(res.card.content);
    for (const th of res.card.thoughts || []) {
      richTextEngine.extractAndPreload(th.content);
    }
    isResurfaceModalOpen.value = true;
  } catch (err: any) {
    showToast("漫游失败: " + (err?.message || err));
  } finally {
    isResurfaceLoading.value = false;
  }
};

const handleResurfaceAppendThought = async () => {
  if (!resurfaceData.value || isContentEmpty(resurfaceThoughtInput.value)) return;
  const targetQuoteId = resurfaceData.value.card.id;
  const content = resurfaceThoughtInput.value.trim();
  isResurfaceSubmitting.value = true;

  try {
    const thoughtId = await invoke<string>("append_thought", { quoteId: targetQuoteId, content });
    
    // 原地推入年轮展示
    const now = Date.now();
    resurfaceData.value.card.thoughts.push({
      id: thoughtId || String(now),
      quote_id: targetQuoteId,
      content,
      created_at: now,
      updated_at: now,
    });

    richTextEngine.extractAndPreload(content);
    resurfaceThoughtInput.value = "";
    showToast("🌱 已为漫游旧知注入新生！");

    await loadData();
  } catch (err: any) {
    showToast("追加失败: " + (err?.message || err));
  } finally {
    isResurfaceSubmitting.value = false;
  }
};

const handleResurfaceJumpToCard = () => {
  if (!resurfaceData.value) return;
  const targetId = resurfaceData.value.card.id;
  isResurfaceModalOpen.value = false;
  quoteLinksEngine.jumpToQuote(targetId);
};


// ----------------- 专注模式幽灵勘误系统 (Ghost Typo Correction) -----------------
const isFocusEditingQuote = ref(false);
const focusEditingQuoteContent = ref("");
const focusEditingQuoteSource = ref("");

const startFocusEditQuote = () => {
  if (!focusQuote.value) return;
  focusEditingQuoteContent.value = focusQuote.value.content;
  focusEditingQuoteSource.value = focusQuote.value.source || "";
  isFocusEditingQuote.value = true;
};

const cancelFocusEditQuote = () => {
  isFocusEditingQuote.value = false;
  focusEditingQuoteContent.value = "";
  focusEditingQuoteSource.value = "";
};

const saveFocusEditQuote = async () => {
  if (!focusQuote.value || isContentEmpty(focusEditingQuoteContent.value)) return;
  const targetId = focusQuote.value.id;
  const newContent = focusEditingQuoteContent.value.trim();
  const newSource = focusEditingQuoteSource.value.trim() || null;

  // 1. 原地乐观更新专注卡片
  focusQuote.value.content = newContent;
  focusQuote.value.source = newSource;
  isFocusEditingQuote.value = false;

  // 2. 同步全局主列表与检索字典
  const card = quotes.value.find((q) => q.id === targetId);
  if (card) {
    card.content = newContent;
    card.source = newSource;
  }
  if (quoteLinksEngine.quoteLookupMap.value[targetId]) {
    quoteLinksEngine.quoteLookupMap.value[targetId].content = newContent;
    quoteLinksEngine.quoteLookupMap.value[targetId].source = newSource;
  }

  richTextEngine.extractAndPreload(newContent);
  showToast("✓ 原句错别字已修正");

  // 3. 异步持久化落盘
  try {
    await invoke("update_quote", {
      quoteId: targetId,
      content: newContent,
      source: newSource,
      isQuestion: focusQuote.value.is_question === 1,
      entryType: focusQuote.value.is_question, // 完整传递三态类型(0摘录/1问题/2感悟)，杜绝类型篡改
    });
    await loadData();
  } catch (err: any) {
    showToast("勘误保存失败: " + (err?.message || err));
  }
};

const focusEditingThoughtId = ref<string | null>(null);
const focusEditingThoughtText = ref("");

const startFocusEditThought = (th: Thought) => {
  focusEditingThoughtId.value = th.id;
  focusEditingThoughtText.value = th.content;
};

const cancelFocusEditThought = () => {
  focusEditingThoughtId.value = null;
  focusEditingThoughtText.value = "";
};

const saveFocusEditThought = async () => {
  if (!focusEditingThoughtId.value || isContentEmpty(focusEditingThoughtText.value) || !focusQuote.value) return;
  const targetThoughtId = focusEditingThoughtId.value;
  const newContent = focusEditingThoughtText.value.trim();

  // 1. 原地乐观更新思考
  const th = focusQuote.value.thoughts.find((t) => t.id === targetThoughtId);
  if (th) {
    th.content = newContent;
    th.updated_at = Date.now();
  }
  focusEditingThoughtId.value = null;

  // 2. 同步主列表
  for (const q of quotes.value) {
    const item = q.thoughts.find((t) => t.id === targetThoughtId);
    if (item) {
      item.content = newContent;
      item.updated_at = Date.now();
      break;
    }
  }

  richTextEngine.extractAndPreload(newContent);
  showToast("✓ 思考错别字已修正");

  // 3. 异步持久化落盘
  try {
    await invoke("update_thought", {
      thoughtId: targetThoughtId,
      content: newContent,
    });
    await loadData();
  } catch (err: any) {
    showToast("勘误保存失败: " + (err?.message || err));
  }
};


// ----------------- 数据导入引擎 -----------------
const isImporting = ref(false);
const importFileInputRef = ref<HTMLInputElement | null>(null);

const triggerImportFile = () => {
  importFileInputRef.value?.click();
};

const handleImportFileInputChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    const jsonStr = event.target?.result as string;
    if (!jsonStr) return;
    isImporting.value = true;
    try {
      const stats = await invoke<{
        imported_quotes: number;
        skipped_quotes: number;
        imported_thoughts: number;
        imported_tags: number;
      }>("import_backup", { jsonStr });

      showToast(`✓ 成功导入 ${stats.imported_quotes} 篇手记，${stats.imported_thoughts} 层年轮！`);
      await loadData();
      } catch (err: any) {
      showToast("导入失败: " + (err?.message || err));
    } finally {
      isImporting.value = false;
      target.value = "";
    }
  };
  reader.readAsText(file);
};

</script>

<template>
  <div 
    class="h-full w-full flex flex-col overflow-hidden select-none bg-[#F4F6F3] text-[#0F172A] relative"
    :class="currentFontSize === 'compact' ? 'text-sm' : (currentFontSize === 'large' ? 'text-lg' : 'text-base')"
    style="font-family: var(--font-custom);"
  >
    <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="handleFileInputChange" />
    <input ref="importFileInputRef" type="file" accept=".json,application/json" class="hidden" @change="handleImportFileInputChange" />

    <!-- 1. 锁屏界面 (清新微光盾) -->
    <div 
      v-if="securityEngine.isAppLocked.value" 
      class="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 bg-[#F4F6F3]"
    >
      <div 
        class="w-full max-w-sm rounded-[32px] p-8 bg-white border border-emerald-950/[0.08] shadow-2xl flex flex-col items-center text-center gap-5"
        :class="{ 'animate-shake': securityEngine.isUnlockFailed.value }"
      >
        <div class="w-16 h-16 rounded-full p-[3px] bg-gradient-to-tr from-emerald-400 via-teal-400 to-amber-300 shadow-md flex items-center justify-center animate-pulse">
          <div class="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden p-2">
            <img src="/logo.png" alt="Logo" class="w-full h-full object-contain pointer-events-none select-none" />
          </div>
        </div>
        <div>
          <h2 class="text-xl font-bold tracking-tight text-[#0F172A]">ThoughtRings</h2>
          <p class="text-xs text-slate-500 mt-1">防窥锁屏保护中，请输入密码开启年轮</p>
        </div>
        <form @submit.prevent="securityEngine.handleUnlockApp" class="w-full flex flex-col gap-3">
          <input 
            type="password"
            v-model="securityEngine.unlockPasswordInput.value"
            placeholder="输入锁屏密码..."
            autofocus
            class="w-full text-center text-sm px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 focus:outline-none transition-all shadow-inner"
          />
          <button 
            type="submit"
            class="w-full text-sm font-semibold py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 transition active:scale-95 cursor-pointer shadow-lg shadow-emerald-500/20"
          >
            解锁手记
          </button>
        </form>
      </div>
    </div>

        <!-- 2. 顶栏导航 (抗挤压、绝对防折行高弹性岛) -->
    <header class="h-[58px] shrink-0 z-30 px-3.5 sm:px-6 border-b border-emerald-950/[0.06] bg-white flex items-center justify-between gap-2 sm:gap-4 select-none">
      
      <!-- 左侧：品牌 Logo 与名称 (自适应缩容) -->
      <div class="flex items-center gap-2 sm:gap-2.5 shrink-0">
        <div class="w-8 h-8 rounded-xl p-[2px] bg-gradient-to-tr from-emerald-400 via-teal-400 to-amber-300 shadow-2xs flex items-center justify-center shrink-0">
          <div class="w-full h-full rounded-xl bg-white flex items-center justify-center overflow-hidden p-0.5">
            <img src="/logo.png" alt="Logo" class="w-full h-full object-contain pointer-events-none select-none" />
          </div>
        </div>
        <div class="flex items-center whitespace-nowrap">
          <span class="font-extrabold text-sm sm:text-base tracking-tight bg-gradient-to-r from-slate-900 to-emerald-900 bg-clip-text text-transparent">ThoughtRings</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100/80 text-emerald-800 font-mono font-bold ml-1.5 hidden min-[900px]:inline">v1.0</span>
        </div>
      </div>

      <!-- 中间：核心胶囊导航 (强制单行不折叠，紧凑呼吸感) -->
      <nav class="flex items-center p-1 rounded-full border border-emerald-950/[0.06] bg-slate-100/90 shadow-inner shrink-0">
        <button 
          type="button"
          @click="currentTab = 'capture'"
          class="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
          :class="currentTab === 'capture' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <span>✍️ 记录</span>
          <span class="text-[10.5px] opacity-40 font-mono hidden min-[1020px]:inline">{{ modifierKey }}1</span>
        </button>

        <button 
          type="button"
          @click="currentTab = 'archive'"
          class="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
          :class="currentTab === 'archive' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <span>📜 年轮</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-emerald-100 text-emerald-700 font-mono">
            {{ libraryTotalCount }}
          </span>
          <span class="text-[10.5px] opacity-40 font-mono hidden min-[1020px]:inline">{{ modifierKey }}2</span>
        </button>

        <button 
          type="button"
          @click="currentTab = 'pinned'"
          class="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
          :class="currentTab === 'pinned' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <span>🌟 常看</span>
          <span 
            v-if="pinnedQuoteIds.length > 0"
            class="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-amber-100 text-amber-800 font-mono"
          >
            {{ pinnedQuoteIds.length }}
          </span>
          <span class="text-[10.5px] opacity-40 font-mono hidden min-[1020px]:inline">{{ modifierKey }}3</span>
        </button>

        <button 
          type="button"
          @click="currentTab = 'trends'"
          class="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
          :class="currentTab === 'trends' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
        >
          <span>📈 脉动</span>
          <span class="text-[10.5px] opacity-40 font-mono hidden min-[1020px]:inline">{{ modifierKey }}4</span>
        </button>
      </nav>

      <!-- 右侧：动作按钮组 (紧凑胶囊，图标与文字紧密协同) -->
      <div class="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <button 
          type="button"
          @click="isBackupModalOpen = true"
          title="数据备份与资产安全中心"
          class="px-2.5 sm:px-3 py-1.5 rounded-full border border-emerald-950/[0.08] bg-white hover:bg-emerald-50 hover:border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
        >
          <span>📦</span>
          <span>备份</span>
        </button>
        <button 
          type="button"
          @click="isLogModalOpen = true"
          title="运行日志"
          class="px-2.5 sm:px-3 py-1.5 rounded-full border border-emerald-950/[0.08] bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
        >
          <span>日志</span>
        </button>
        <button 
          v-if="securityEngine.securityConfig.value.is_locked"
          type="button"
          @click="securityEngine.lockAppNow"
          :title="`锁定 (${modifierKey}+L)`"
          class="px-2.5 sm:px-3 py-1.5 rounded-full border border-emerald-950/[0.08] bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
        >
          <span>锁定</span>
        </button>
        <button 
          type="button"
          @click="isSettingsOpen = true"
          class="px-2.5 sm:px-3 py-1.5 rounded-full border border-emerald-950/[0.08] bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
        >
          <span>偏好</span>
          <span class="text-[10px] opacity-60">⚙</span>
        </button>
      </div>
    </header>

    <!-- 3. 主记录工作台 (单栏心流手记台 · 渐进式年轮萌发) -->
    <section v-if="currentTab === 'capture'" class="flex-1 min-h-0 w-full px-4 sm:px-6 py-3 sm:py-4 overflow-hidden flex flex-col max-w-4xl mx-auto">
      <div class="flex-1 min-h-0 w-full flex flex-col rounded-3xl bg-white border border-emerald-950/[0.08] shadow-sm overflow-hidden focus-within:border-emerald-500/80 focus-within:ring-2 focus-within:ring-emerald-400/20 transition-all">
        
        <!-- 1. 模式选择与快捷操作栏 -->
        <div class="shrink-0 h-11 px-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
          <!-- 模式切换分段器 -->
          <div class="flex items-center p-0.5 rounded-xl bg-slate-200/60 border border-slate-200/80">
            <button 
              type="button"
              @click="entryType = 0"
              class="px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
              :class="entryType === 0 ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              📖 摘录
            </button>
            <button 
              type="button"
              @click="entryType = 2"
              class="px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
              :class="entryType === 2 ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              <span>💡 感悟</span>
            </button>
            <button 
              type="button"
              @click="entryType = 1"
              class="px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
              :class="entryType === 1 ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              <span>❓ 问题</span>
            </button>
          </div>

          <!-- 右侧轻量存图与粘贴 -->
          <div class="flex items-center gap-1.5">
            <button 
              @click="triggerSelectImage"
              title="存入本地图片"
              class="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs"
            >
              <span>📷 存图</span>
            </button>
            <button 
              @click="smartPasteButtonAction" 
              title="粘贴截图或文本"
              class="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs"
            >
              <span>📋 粘贴</span>
            </button>
          </div>
        </div>

        <!-- 2. 排版工具栏 -->
        <div class="shrink-0 px-3.5 py-1.5 bg-slate-50/40 border-b border-slate-100 flex items-center gap-1 overflow-x-auto stable-scroll select-none">
          <button type="button" @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()" title="H1 标题" class="px-1.5 h-6 rounded-md hover:bg-slate-200/70 text-xs font-bold text-slate-700 cursor-pointer">H1</button>
          <button type="button" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()" title="H2 标题" class="px-1.5 h-6 rounded-md hover:bg-slate-200/70 text-xs font-bold text-slate-700 cursor-pointer">H2</button>
          <span class="w-[1px] h-3.5 bg-slate-200 mx-0.5"></span>

          <button type="button" @click="editor?.chain().focus().toggleBold().run()" title="加粗" class="w-6 h-6 rounded-md hover:bg-slate-200/70 text-xs font-bold text-slate-700 flex items-center justify-center cursor-pointer">B</button>
          <button type="button" @click="editor?.chain().focus().toggleItalic().run()" title="斜体" class="w-6 h-6 rounded-md hover:bg-slate-200/70 text-xs italic text-slate-700 flex items-center justify-center cursor-pointer">I</button>
          <button type="button" @click="editor?.chain().focus().toggleUnderline().run()" title="下划线" class="w-6 h-6 rounded-md hover:bg-slate-200/70 text-xs underline font-medium text-slate-700 flex items-center justify-center cursor-pointer">U</button>
          <button type="button" @click="editor?.chain().focus().toggleStrike().run()" title="删除线" class="w-6 h-6 rounded-md hover:bg-slate-200/70 text-xs line-through text-slate-700 flex items-center justify-center cursor-pointer">S</button>
          <span class="w-[1px] h-3.5 bg-slate-200 mx-0.5"></span>

          <!-- 彩虹高亮荧光笔 -->
          <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#FEF08A' }).run()" title="荧光黄" class="w-3.5 h-3.5 rounded-full bg-amber-300 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
          <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#A7F3D0' }).run()" title="青草绿" class="w-3.5 h-3.5 rounded-full bg-emerald-400 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
          <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#BAE6FD' }).run()" title="晴空蓝" class="w-3.5 h-3.5 rounded-full bg-sky-400 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
          <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#FDA4AF' }).run()" title="樱花粉" class="w-3.5 h-3.5 rounded-full bg-rose-300 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
          <span class="w-[1px] h-3.5 bg-slate-200 mx-0.5"></span>

          <!-- 打勾清单 -->
          <button type="button" @click="editor?.chain().focus().toggleTaskList().run()" title="打勾清单" class="px-2 h-6 rounded-md hover:bg-emerald-100/70 text-xs font-bold text-emerald-800 flex items-center gap-1 cursor-pointer">
            <span>☑ 清单</span>
          </button>
          <button type="button" @click="editor?.chain().focus().toggleBlockquote().run()" title="引用块" class="w-6 h-6 rounded-md hover:bg-slate-200/70 text-xs text-slate-700 flex items-center justify-center cursor-pointer">❞</button>
        </div>

        <!-- 3. 主画布书写区 (宽广通透的心流视野) -->
        <div class="flex-1 min-h-0 relative p-5 sm:p-6 bg-white overflow-y-auto stable-scroll">
          <editor-content 
            :editor="editor" 
            class="tiptap-container w-full h-full text-base sm:text-[17px] leading-[1.85] text-[#0F172A] font-serif"
          />
        </div>

        <!-- 4. 出处背景输入行（高质感典雅输入槽） -->
        <div class="shrink-0 px-5 py-2.5 bg-gradient-to-b from-[#FAFBF9] to-[#F4F6F3]/60 border-t border-emerald-950/[0.06] flex items-center gap-3">
          <div class="flex-1 flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-white border border-slate-200/90 hover:border-emerald-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-400/20 shadow-2xs transition-all duration-150 group">
            <!-- 动态三态徽章 -->
            <span 
              class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-[11px] font-bold tracking-tight shrink-0 select-none shadow-2xs border transition-colors"
              :class="entryType === 2 
                ? 'bg-indigo-50 text-indigo-800 border-indigo-200/80' 
                : (entryType === 1 
                  ? 'bg-amber-50 text-amber-800 border-amber-200/80' 
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200/80')"
            >
              <span>{{ entryType === 2 ? '💡 场景契机' : (entryType === 1 ? '❓ 背景线索' : '📚 文献出处') }}</span>
            </span>

            <!-- 清爽输入本体 -->
            <input 
              type="text"
              v-model="inputSource"
              :placeholder="entryType === 2 
                ? '记录萌发场景（如：深夜散步、与朋友讨论、晨跑顿悟...）' 
                : (entryType === 1 
                  ? '记录问题背景或领域（如：认知神经科学 / 组织管理 / 个人成长...）' 
                  : '书名、作者、篇名或页码（如：《置身事内》P120、播客第12期...）')" 
              class="flex-1 text-xs text-[#0F172A] placeholder-slate-400 bg-transparent focus:outline-none font-serif leading-relaxed"
            />

            <!-- 快捷清空 -->
            <button 
              v-if="inputSource"
              type="button"
              @click="inputSource = ''"
              title="清空出处"
              class="text-slate-300 hover:text-slate-600 text-xs font-bold px-1 transition cursor-pointer"
            >✕</button>
          </div>

          <!-- 右侧最近出处快捷胶囊池 -->
          <div v-if="recentSources.length > 0 && !inputSource" class="hidden md:flex items-center gap-1.5 shrink-0">
            <span class="text-[10px] text-slate-400 font-mono">历史:</span>
            <button 
              v-for="s in recentSources.slice(0, 3)" 
              :key="s"
              type="button"
              @click="inputSource = s"
              class="text-[11px] px-2.5 py-1 rounded-xl bg-white hover:bg-emerald-50 hover:text-emerald-900 hover:border-emerald-300 text-slate-600 transition-all cursor-pointer border border-slate-200 shadow-2xs truncate max-w-[125px] active:scale-95"
              :title="s"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <!-- 5. 渐进式年轮萌发槽 (默认收起为一个雅致的微胶囊，点击平滑展开) -->
        <div class="shrink-0 px-5 py-2 bg-[#F8FAF7] border-t border-emerald-950/[0.05] flex flex-col gap-2">
          
          <!-- 折叠触发按钮 (无思考时呈现) -->
          <div v-if="!isThoughtExpanded" class="flex items-center justify-between">
            <button 
              type="button" 
              @click="isThoughtExpanded = true"
              class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200/80 transition-all cursor-pointer group shadow-2xs select-none"
            >
              <span class="w-3.5 h-3.5 rounded-full bg-emerald-200 group-hover:bg-emerald-300 flex items-center justify-center text-[10px] font-bold text-emerald-900">+</span>
              <span>附带当下思考 (思维年轮)</span>
              <span class="text-[10px] text-slate-400 font-mono font-normal">可选</span>
            </button>
            <span class="text-[10.5px] font-mono text-slate-400 hidden sm:inline">日后随时可在年轮流中追加新演进</span>
          </div>

          <!-- 展开后的伴随年轮编辑框 -->
          <div v-else class="flex flex-col gap-2 pt-1 animate-fade-in">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-emerald-900 flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>🌱 第一层思维年轮 (记录第一直觉、反思或解题假设)</span>
              </span>
              <button 
                type="button"
                @click="isThoughtExpanded = false; inputThought = ''; thoughtEditor?.commands.clearContent();"
                class="text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                收起并清除 ✕
              </button>
            </div>

            <div class="h-28 rounded-2xl bg-white border border-emerald-300/80 p-3 overflow-y-auto stable-scroll focus-within:ring-2 focus-within:ring-emerald-400/20 shadow-inner transition-all">
              <editor-content 
                :editor="thoughtEditor" 
                class="tiptap-container w-full h-full text-xs sm:text-sm leading-relaxed text-[#0F172A] font-sans"
              />
            </div>
          </div>

        </div>

        <!-- 6. 底栏操作中枢：分类标签 + 立即收录大按钮 (闭环动线，一气呵成) -->
        <div class="shrink-0 px-5 py-3 bg-white border-t border-slate-100 flex items-center justify-between gap-4">
          
          <!-- 标签选择与快速贴标签区 -->
          <div class="flex-1 min-w-0 flex items-center gap-2">
            <!-- 标签库弹窗按钮 -->
            <button 
              type="button"
              @click="tagsEngine.openTagPickerModal(null)" 
              class="h-8 px-3 rounded-xl border border-slate-200 hover:border-emerald-300 bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 shadow-2xs"
            >
              <span>🏷️ 标签</span>
              <span class="font-mono text-[10.5px] opacity-60">({{ tagsEngine.tagStats.value.length }})</span>
            </button>

            <!-- 已挂载标签胶囊流与即时输入框 -->
            <div class="flex-1 min-h-[34px] px-2.5 py-0.5 rounded-xl border border-slate-200/80 bg-slate-50/70 flex flex-wrap items-center gap-1.5 focus-within:bg-white focus-within:border-emerald-500 transition-all">
              <span 
                v-for="(tag, idx) in tagsEngine.attachedTags.value" 
                :key="tag"
                class="text-xs px-2.5 py-0.5 rounded-full border flex items-center gap-1 shadow-2xs font-semibold"
                :style="{ backgroundColor: tagsEngine.getTagColor(tag).bg, borderColor: tagsEngine.getTagColor(tag).border, color: tagsEngine.getTagColor(tag).text }"
              >
                <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: tagsEngine.getTagColor(tag).dot }"></span>
                <span>{{ tagsEngine.formatHierarchyTagName(tag) }}</span>
                <button @click="tagsEngine.removeAttachedTag(idx)" class="opacity-50 hover:opacity-100 cursor-pointer ml-0.5">×</button>
              </span>

              <div class="relative flex-1 min-w-[100px] flex items-center">
                <input 
                  type="text"
                  v-model="tagsEngine.tagInputText.value"
                  @keydown="tagsEngine.handleTagInputKeydown" 
                  @blur="tagsEngine.pushTag(tagsEngine.tagInputText.value)"
                  placeholder="贴标签..." 
                  class="bg-transparent text-xs w-full focus:outline-none text-[#0F172A] placeholder-[#94A3B8]"
                />

                <!-- 联想提示框 -->
                <div 
                  v-if="tagsEngine.tagSuggestions.value.length > 0"
                  class="absolute left-0 bottom-full mb-2 w-56 p-1.5 rounded-2xl bg-white border border-emerald-950/[0.12] shadow-xl z-50 flex flex-col gap-0.5"
                  @mousedown.prevent
                >
                  <button
                    v-for="s in tagsEngine.tagSuggestions.value"
                    :key="s.id"
                    type="button"
                    @click="tagsEngine.pushTag(s.name)"
                    class="w-full text-left px-2 py-1 rounded-xl text-xs hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 flex items-center justify-between transition cursor-pointer"
                  >
                    <span class="truncate font-semibold font-mono">#{{ tagsEngine.formatHierarchyTagName(s.name) }}</span>
                    <span class="text-[10px] opacity-60 font-mono">({{ s.count }})</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 常用标签前 3 个快捷点选 -->
            <div v-if="tagsEngine.frequentTags.value.length > 0" class="hidden lg:flex items-center gap-1 shrink-0">
              <button 
                v-for="ft in tagsEngine.frequentTags.value.slice(0, 3)"
                :key="ft"
                @click="tagsEngine.toggleAttachTag(ft)"
                class="text-[10.5px] px-2 py-1 rounded-lg border transition cursor-pointer font-medium max-w-[90px] truncate"
                :style="tagsEngine.attachedTags.value.includes(ft)
                  ? { backgroundColor: tagsEngine.getTagColor(ft).bg, borderColor: tagsEngine.getTagColor(ft).border, color: tagsEngine.getTagColor(ft).text }
                  : { backgroundColor: '#F8FAFC', borderColor: 'rgba(15,23,42,0.08)', color: '#64748B' }"
              >
                {{ tagsEngine.attachedTags.value.includes(ft) ? '✓' : '+' }} {{ tagsEngine.formatHierarchyTagName(ft) }}
              </button>
            </div>
          </div>

          <!-- 保存提交大按钮 (与左侧编辑完全连贯) -->
          <button 
            type="button"
            @click="handleCreateQuote"
            :disabled="isSubmitting || isContentEmpty(inputQuote)"
            class="h-9 px-6 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-md text-white disabled:opacity-40 cursor-pointer active:scale-95 flex items-center justify-center gap-2 shrink-0"
            :class="entryType === 2 ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-indigo-500/25' : (entryType === 1 ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-orange-500/25' : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/25')" 
          >
            <span>{{ isSubmitting ? '存入中...' : (entryType === 2 ? '立项原生感悟 ↵' : (entryType === 1 ? '立项待解之问 ↵' : '珍藏入年轮 ↵')) }}</span>
          </button>

        </div>

      </div>
    </section>

    <!-- 4. 过往年轮流视图 (水滴晶亮时间轴 - 纯净独占) -->
    <div v-else-if="currentTab === 'archive'" class="flex-1 min-h-0 w-full px-6 sm:px-8 py-4 sm:py-5 flex overflow-hidden max-w-7xl mx-auto">
      <Transition name="sidebar-dock">
        <div v-if="timelineEngine.isSidebarOpen.value" class="w-68 mr-5 h-full shrink-0 overflow-hidden">
          <aside class="w-[17rem] h-full flex flex-col bg-white rounded-3xl p-5 border border-emerald-950/[0.08] shadow-sm overflow-hidden select-none">
            <div class="shrink-0 flex items-center pb-3 mb-3.5 border-b border-slate-100">
              <div class="flex-1 grid grid-cols-2 p-1 rounded-xl bg-slate-100">
                <button 
                  @click="timelineEngine.sidebarMode.value = 'tags'"
                  class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                  :class="timelineEngine.sidebarMode.value === 'tags' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-500'"
                >
                  <span>🏷️</span><span>标签</span>
                </button>
                <button 
                  @click="timelineEngine.sidebarMode.value = 'timeline'"
                  class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                  :class="timelineEngine.sidebarMode.value === 'timeline' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-500'"
                >
                  <span>📅</span><span>时间</span>
                </button>
              </div>
              <button @click="timelineEngine.toggleSidebar" title="收起侧栏" class="ml-2.5 h-[34px] px-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs cursor-pointer">
                ◨
              </button>
            </div>

            <!-- 模式 A：标签层级树 (高密度大规模支撑架构) -->
            <template v-if="timelineEngine.sidebarMode.value === 'tags'">
              <!-- 1. 顶栏操作区 -->
              <div class="shrink-0 flex items-center justify-between mb-2 px-1">
                <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">层级标签树</span>
                <button @click="tagsEngine.isTagManagerOpen.value = true" class="text-xs font-bold text-emerald-700 hover:underline cursor-pointer">
                  管理 ({{ tagsEngine.tagStats.value.length }})
                </button>
              </div>

              <!-- 2. 即时搜索与紧凑工具栏 -->
              <div class="shrink-0 flex flex-col gap-1.5 mb-2.5">
                <div class="relative flex items-center">
                  <span class="absolute left-2.5 text-[11px] text-slate-400 pointer-events-none">🔍</span>
                  <input 
                    type="text" 
                    v-model="tagsEngine.tagTreeSearchQuery.value"
                    placeholder="过滤标签分类..."
                    class="w-full text-xs pl-7 pr-6 py-1.5 rounded-xl border border-slate-200 bg-slate-50/80 focus:bg-white focus:border-emerald-500 focus:outline-none transition-all placeholder:text-slate-400"
                  />
                  <button 
                    v-if="tagsEngine.tagTreeSearchQuery.value"
                    @click="tagsEngine.tagTreeSearchQuery.value = ''"
                    class="absolute right-2 text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div class="flex items-center justify-between px-0.5 text-[11px] text-slate-500">
                  <div class="flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200/60">
                    <button 
                      @click="tagsEngine.tagTreeSortBy.value = 'count'" 
                      class="px-2 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer"
                      :class="tagsEngine.tagTreeSortBy.value === 'count' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500'"
                      title="按使用热度排序"
                    >
                      🔥 热度
                    </button>
                    <button 
                      @click="tagsEngine.tagTreeSortBy.value = 'name'" 
                      class="px-2 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer"
                      :class="tagsEngine.tagTreeSortBy.value === 'name' ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500'"
                      title="按首字母拼音排序"
                    >
                      🔤 字母
                    </button>
                  </div>

                  <div class="flex items-center gap-1">
                    <button 
                      @click="tagsEngine.expandAllTagNodes()" 
                      class="px-1.5 py-0.5 rounded hover:bg-slate-100 text-[10px] text-slate-600 font-semibold cursor-pointer"
                      title="展开全部节点"
                    >
                      ⊞ 展开
                    </button>
                    <button 
                      @click="tagsEngine.collapseAllTagNodes()" 
                      class="px-1.5 py-0.5 rounded hover:bg-slate-100 text-[10px] text-slate-600 font-semibold cursor-pointer"
                      title="收起全部节点"
                    >
                      ⊟ 收起
                    </button>
                  </div>
                </div>
              </div>



              <!-- 3. 全局重置项 -->
              <div 
                @click="tagsEngine.selectedTag.value = null; loadData();"
                class="shrink-0 flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-xs mb-2 transition select-none"
                :class="tagsEngine.selectedTag.value === null ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'hover:bg-slate-100 text-slate-700'"
              >
                <div class="flex items-center gap-2">
                  <span>📂</span>
                  <span>全部条目</span>
                </div>
                <span class="font-mono text-[11px] opacity-75">{{ libraryTotalCount }}</span>
              </div>

              <!-- 4. 任意深度流式层级投影列表 -->
              <div class="flex-1 min-h-0 stable-scroll flex flex-col gap-0.5 text-xs pr-1 overflow-y-auto select-none">
                <div 
                  v-if="tagsEngine.flattenedTagTree.value.length === 0" 
                  class="py-8 text-center text-slate-400 text-xs flex flex-col items-center gap-1"
                >
                  <span>🍃</span>
                  <span>未匹配到标签</span>
                </div>

                <div 
                  v-for="row in tagsEngine.flattenedTagTree.value" 
                  :key="row.fullPath"
                  @click="tagsEngine.selectedTag.value = row.fullPath; loadData();"
                  class="group relative flex items-center justify-between py-1.5 pr-2 rounded-xl cursor-pointer transition-colors duration-100"
                  :class="tagsEngine.selectedTag.value === row.fullPath ? 'font-bold shadow-2xs' : 'hover:bg-slate-100/90 text-slate-700'"
                  :style="tagsEngine.selectedTag.value === row.fullPath 
                    ? { backgroundColor: tagsEngine.getTagColor(row.name).bg, color: tagsEngine.getTagColor(row.name).text, borderLeft: `3px solid ${tagsEngine.getTagColor(row.name).dot}` } 
                    : { paddingLeft: `${Math.max(6, row.depth * 14 + 6)}px` }"
                >
                  <!-- 层级缩进引导线 (深度 > 0 时显示) -->
                  <span 
                    v-if="row.depth > 0 && tagsEngine.selectedTag.value !== row.fullPath" 
                    class="absolute top-0 bottom-0 w-[1px] bg-slate-200/80 pointer-events-none"
                    :style="{ left: `${row.depth * 14 - 3}px` }"
                  ></span>

                  <!-- 节点核心内容区 -->
                  <div class="flex items-center gap-1.5 min-w-0 flex-1">
                    <!-- 折叠展开触发器 -->
                    <button 
                      v-if="row.hasChildren"
                      type="button"
                      @click.stop="tagsEngine.toggleTagNodeExpand(row.fullPath)"
                      class="w-4 h-4 shrink-0 flex items-center justify-center rounded hover:bg-black/10 text-[9px] font-bold text-slate-500 transition-transform"
                    >
                      {{ row.isExpanded ? '▾' : '▸' }}
                    </button>
                    <span 
                      v-else 
                      class="w-2 h-2 shrink-0 rounded-full mx-1"
                      :style="{ backgroundColor: tagsEngine.getTagColor(row.name).dot }"
                    ></span>

                    <span 
                      class="truncate text-xs tracking-tight"
                      :class="{ 'underline decoration-emerald-500 decoration-2 font-bold': row.isMatched }"
                    >
                      {{ row.name }}
                    </span>
                    <button
                      type="button"
                      @click.stop="quickAddSidebarSubtag(row.fullPath)"
                      title="添加子标签"
                      class="opacity-0 group-hover:opacity-100 shrink-0 w-4 h-4 flex items-center justify-center rounded-full hover:bg-emerald-200/70 text-emerald-800 text-xs font-bold transition-opacity cursor-pointer"
                    >+</button>
                  </div>

                  <!-- 数量角标 -->
                  <span class="font-mono text-[10.5px] opacity-60 ml-1 shrink-0">
                    {{ row.totalCount }}
                  </span>
                </div>
              </div>
            </template>

            <!-- 模式 B：时间轴透镜 -->
            <template v-else>
              <div class="shrink-0 flex items-center justify-between mb-2 px-1">
                <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">时间轴透镜</span>
                <button v-if="timelineEngine.selectedTimeRange.value" @click="timelineEngine.selectTimeFilter(null)" class="text-xs font-bold text-rose-600 hover:underline cursor-pointer">
                  清除筛选
                </button>
              </div>



              <div class="grid grid-cols-2 gap-1.5 mb-3">
                <button 
                  v-for="preset in timelineEngine.quickTimePresets.value" 
                  :key="preset.label"
                  @click="timelineEngine.selectTimeFilter(preset)"
                  class="py-1.5 px-2 rounded-xl text-xs font-semibold border transition cursor-pointer text-center truncate"
                  :class="timelineEngine.selectedTimeRange.value?.label === preset.label ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200/80'"
                >
                  {{ preset.label }}
                </button>
              </div>

              <div class="shrink-0 pb-1.5 border-b border-slate-100 mb-2 text-[11px] font-bold text-slate-400 px-1 flex items-center justify-between">
                <span>月 / 日 归档手风琴</span>
              </div>

              <div class="flex-1 min-h-0 stable-scroll flex flex-col gap-1 text-xs pr-1">
                <template v-for="m in timelineEngine.timelineArchiveGroups.value" :key="m.key">
                  <div 
                    class="flex items-center justify-between px-2.5 py-1.5 rounded-xl cursor-pointer transition select-none border"
                    :class="timelineEngine.selectedTimeRange.value?.label === m.label ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'text-slate-700 hover:bg-slate-100 border-transparent'"
                  >
                    <div class="flex items-center gap-1.5 min-w-0 flex-1">
                      <button @click.stop="timelineEngine.toggleMonthTimelineExpand(m.key)" class="w-4 h-4 flex items-center justify-center rounded hover:bg-black/5 text-[9px]">
                        {{ timelineEngine.isMonthTimelineExpanded(m.key) ? '▾' : '▸' }}
                      </button>
                      <span @click="timelineEngine.selectTimeFilter(m)" class="truncate">{{ m.label }}</span>
                    </div>
                    <span @click="timelineEngine.selectTimeFilter(m)" class="font-mono text-[11px] opacity-60">{{ m.totalCount }}</span>
                  </div>

                  <div v-if="timelineEngine.isMonthTimelineExpanded(m.key) && m.days.length > 0" class="flex flex-col gap-0.5 ml-3 pl-2.5 border-l border-slate-200 my-0.5">
                    <div 
                      v-for="d in m.days" 
                      :key="d.key"
                      @click="timelineEngine.selectTimeFilter(d)"
                      class="flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition text-[11px]"
                      :class="timelineEngine.selectedTimeRange.value?.label === d.label ? 'bg-emerald-600 text-white font-bold shadow-2xs' : 'text-slate-600 hover:bg-slate-100'"
                    >
                      <span class="truncate">{{ d.label }} ({{ d.dayOfWeek }})</span>
                      <span class="font-mono text-[10px] opacity-70">{{ d.totalCount }}</span>
                    </div>
                  </div>
                </template>
              </div>
            </template>
          </aside>
        </div>
      </Transition>

      <!-- 主卡片流 -->
      <main class="flex-1 min-h-0 h-full flex flex-col min-w-0 overflow-hidden">
        <!-- 一体化中央控制中枢 (Unified Control Deck) -->
        <div class="shrink-0 flex flex-col gap-2 mb-3.5 select-none">
          <!-- 上层主控栏：目录收放 + 闪电搜索 + 分类透镜 -->
          <div class="flex items-center gap-2.5">
            <!-- 目录收放快捷按钮 -->
            <button 
              v-if="!timelineEngine.isSidebarOpen.value" 
              type="button"
              @click="timelineEngine.toggleSidebar" 
              class="h-10 px-3.5 rounded-2xl border border-emerald-950/[0.08] bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs transition active:scale-95 shrink-0"
              title="展开标签与时间侧栏"
            >
              <span class="text-xs">◧</span>
              <span class="hidden sm:inline">分类目录</span>
            </button>

            <!-- 搜索框 (随打随搜，左带放大镜，右带一键清空) -->
            <div class="relative flex-1 flex items-center min-w-[180px]">
              <span class="absolute left-3.5 text-xs text-slate-400 pointer-events-none">🔍</span>
              <input 
                type="text" 
                v-model="searchQuery" 
                placeholder="搜索原句、思考年轮、出处..." 
                class="w-full text-xs sm:text-sm pl-9 pr-8 py-2 rounded-2xl border border-emerald-950/[0.08] bg-white text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all shadow-2xs"
              />
              <button 
                v-if="searchQuery"
                type="button"
                @click="clearSearchQuery"
                title="清空搜索词"
                class="absolute right-2.5 w-4 h-4 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center text-[9px] font-bold cursor-pointer transition"
              >
                ✕
              </button>
            </div>

            <!-- 分类分段选择器 (高阶微光分段，绝不与下层复读) -->
            <div class="flex items-center p-1 rounded-2xl bg-white border border-emerald-950/[0.08] shadow-2xs shrink-0">
              <button 
                type="button" 
                @click="selectedEntryTypeFilter = 'all'"
                class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                :class="selectedEntryTypeFilter === 'all' ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
              >
                全部
              </button>
              <button 
                type="button" 
                @click="selectedEntryTypeFilter = 'quote'"
                class="px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                :class="selectedEntryTypeFilter === 'quote' ? 'bg-emerald-100 text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
              >
                <span>📖</span><span>摘录</span>
              </button>
              <button 
                type="button" 
                @click="selectedEntryTypeFilter = 'insight'"
                class="px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                :class="selectedEntryTypeFilter === 'insight' ? 'bg-indigo-100 text-indigo-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
              >
                <span>💡</span><span>感悟</span>
              </button>
              <button 
                type="button" 
                @click="selectedEntryTypeFilter = 'question'"
                class="px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                :class="selectedEntryTypeFilter === 'question' ? 'bg-amber-100 text-amber-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
              >
                <span>❓</span><span>问题</span>
              </button>
              <button 
                type="button" 
                @click="selectedEntryTypeFilter = 'has_thought'"
                class="px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                :class="selectedEntryTypeFilter === 'has_thought' ? 'bg-emerald-700 text-white shadow-2xs font-extrabold' : 'text-slate-500 hover:text-slate-900'"
                title="只看已有思维年轮/延伸认知的深度手记"
              >
                <span>🌱</span><span>深入思考</span>
              </button>
            </div>
          </div>

          <!-- 下层辅助约束条 (仅在选择了标签或时间等额外约束时平滑展示) -->
          <div 
            v-if="hasActiveConstraints" 
            class="flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-100/70 border border-slate-200/50 text-xs text-slate-600 animate-fade-in"
          >
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-[11px] font-bold text-slate-400 font-mono">叠加条件:</span>

              <!-- 仅显示标签约束 -->
              <span 
                v-if="tagsEngine.selectedTag.value" 
                class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-semibold shadow-2xs"
                :style="{ backgroundColor: tagsEngine.getTagColor(tagsEngine.selectedTag.value).bg, borderColor: tagsEngine.getTagColor(tagsEngine.selectedTag.value).border, color: tagsEngine.getTagColor(tagsEngine.selectedTag.value).text }"
              >
                <span>🏷️</span>
                <span class="truncate max-w-[140px]">#{{ tagsEngine.formatHierarchyTagName(tagsEngine.selectedTag.value) }}</span>
                <button @click="tagsEngine.selectedTag.value = null" title="移除该标签约束" class="opacity-50 hover:opacity-100 font-bold ml-0.5 cursor-pointer">✕</button>
              </span>

              <!-- 仅显示时间范围约束 -->
              <span 
                v-if="timelineEngine.selectedTimeRange.value" 
                class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-900 border border-teal-200 text-xs font-semibold shadow-2xs"
              >
                <span>📅</span>
                <span>{{ timelineEngine.selectedTimeRange.value.label }}</span>
                <button @click="timelineEngine.selectedTimeRange.value = null" title="移除时间范围约束" class="opacity-50 hover:opacity-100 font-bold ml-0.5 cursor-pointer">✕</button>
              </span>

              <span class="text-[11px] font-mono text-slate-400">
                (实时命中 {{ displayedQuotes.length }} 篇)
              </span>
            </div>

            <!-- 一键清除全部额外约束 -->
            <button 
              type="button" 
              @click="resetAllConstraints"
              class="text-[11px] font-semibold text-rose-600 hover:text-rose-700 hover:underline px-1 cursor-pointer shrink-0 ml-2"
            >
              清空附加过滤 ✕
            </button>
          </div>
        </div>

        <div 
          :ref="(el) => { 
            archiveContainerRef = el as HTMLElement; 
            if (el) {
              virtualScrollEngine.scrollContainerRef.value = el as HTMLElement;
              virtualScrollEngine.syncViewport();
            }
          }"
          @scroll="handleArchiveScroll"
          class="flex-1 min-h-0 stable-scroll flex flex-col pr-1 pb-24 overflow-y-auto"
          @click="handleRichContainerClick"
        >
          <!-- 真正的空库 (全库 0 篇) -->
          <TulipDecor v-if="libraryTotalCount === 0" type="empty" />

          <!-- 筛选无果 (全库有数据但当前分类未命中) -> 温和安抚卡片，彻底消除恐慌 -->
          <div 
            v-else-if="displayedQuotes.length === 0" 
            class="flex flex-col items-center justify-center py-16 px-6 text-center select-none animate-fade-in"
          >
            <div class="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-2xl mb-3 shadow-2xs">
              🍃
            </div>
            <h3 class="text-sm font-bold text-slate-800 tracking-tight mb-1">
              当前分类透镜下暂无手记
            </h3>
            <p class="text-xs text-slate-500 max-w-sm leading-relaxed mb-4">
              请放心，你的数据安全无虞（知识库中现存 <strong class="text-emerald-700 font-mono font-bold">{{ libraryTotalCount }}</strong> 篇手记），只是当前「{{ selectedEntryTypeFilter === 'question' ? '❓ 待解之问' : (selectedEntryTypeFilter === 'insight' ? '💡 原生感悟' : (selectedEntryTypeFilter === 'has_thought' ? '🌱 深入思考' : '📖 客观摘录')) }}」透镜下暂无条目。
            </p>
            <button 
              type="button"
              @click="selectedEntryTypeFilter = 'all'" 
              class="px-5 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <span>↺</span>
              <span>查看全部手记 ({{ libraryTotalCount }} 篇)</span>
            </button>
          </div>

          <!-- 顶部虚拟占位 -->
          <div 
            v-if="virtualScrollEngine.virtualState.value.isVirtualized && virtualScrollEngine.virtualState.value.topSpacer > 0"
            :style="{ height: virtualScrollEngine.virtualState.value.topSpacer + 'px', flexShrink: 0 }"
          ></div>

          <div class="flex flex-col gap-6 w-full">
            <article 
              v-for="card in virtualScrollEngine.virtualState.value.visibleItems" 
              :key="card.id"
              :id="'quote_card_' + card.id"
              :data-virtual-key="card.id"
              :ref="(el) => virtualScrollEngine.registerItemElement(card.id, el as HTMLElement)"
              @click="handleCardClick(card.id)"
              @mouseleave="handleCardMouseLeave(card.id)"
              class="relative soft-card p-5 sm:p-6 flex flex-col gap-3 transition-all duration-150 min-w-0"
              :class="[
                quoteLinksEngine.highlightedQuoteId.value === card.id ? 'card-target-arrival' : '',
                activeActionCardId === card.id ? 'ring-2 ring-emerald-500/40 shadow-md bg-white' : 'hover:border-emerald-500/30'
              ]"
            >
              <!-- 维度一：专属同心年轮物理印章 (右上角微光展现时光厚度) -->
              <div 
                class="absolute right-6 top-5 z-10 flex items-center gap-2 select-none"
                :class="{ 'opacity-0 pointer-events-none': activeActionCardId === card.id }"
              >
                <div 
                  v-if="isCardPinned(card.id)"
                  class="flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 border border-amber-300 shadow-2xs text-xs select-none pointer-events-none"
                  title="已固定至常看"
                >
                  <span class="text-xs leading-none">🌟</span>
                </div>
                <TreeRingStamp 
                  :rings-count="(card.thoughts || []).length" 
                  :created-at="card.created_at" 
                  :size="30" 
                />
              </div>

              <!-- 悬浮操作胶囊 -->
              <div 
                v-if="(activeActionCardId === card.id || editingQuoteId === card.id) && editingThoughtId !== card.id && !editingThoughtId && activeAppendQuoteId !== card.id"
                class="absolute right-5 top-5 z-20 flex items-center gap-1.5 p-1 rounded-full bg-white/95 border border-emerald-950/[0.1] shadow-xl select-none animate-fade-in"
                @click.stop
              >
                <button @click.stop="openFocusMode(card)" title="专注模式" class="h-7 px-3 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center gap-1 shadow-xs">
                  <span>🎯 专注</span>
                </button>
                <button @click.stop="copyQuoteSummary(card)" title="复制摘要" class="h-7 px-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1">
                  <span>📋 复制</span>
                </button>
                <button @click.stop="togglePinCard(card.id)" class="h-7 px-2.5 rounded-full text-xs font-bold shadow-2xs" :class="isCardPinned(card.id) ? 'bg-amber-200 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-600'">
                  <span>🌟 {{ isCardPinned(card.id) ? '已置顶' : '置顶' }}</span>
                </button>
                <button v-if="editingQuoteId !== card.id" @click.stop="startEditQuote(card)" class="h-7 w-7 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center hover:bg-slate-200">
                  ✏️
                </button>
                <button @click.stop="requestDeleteQuote(card.id)" class="h-7 rounded-full text-xs font-bold flex items-center justify-center px-2" :class="pendingDeleteQuoteId === card.id ? 'bg-rose-600 text-white px-2.5' : 'text-slate-400 hover:text-rose-600'">
                  <span>🗑️ {{ pendingDeleteQuoteId === card.id ? '确定?' : '' }}</span>
                </button>
              </div>

              <!-- 原句展示 -->
              <!-- 编辑原句 (含全套排版工具栏与出处) -->
              <div v-if="editingQuoteId === card.id" @click.stop class="flex flex-col gap-2.5 pt-1 animate-fade-in">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200">
                    <button 
                      type="button"
                      @click="editingQuoteIsQuestion = false; editingEntryType = 0" 
                      class="px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer" 
                      :class="editingEntryType === 0 ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500'"
                    >
                      📖 摘录
                    </button>
                    <button 
                      type="button"
                      @click="editingQuoteIsQuestion = false; editingEntryType = 2" 
                      class="px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1" 
                      :class="editingEntryType === 2 ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-500'"
                    >
                      💡 感悟
                    </button>
                    <button 
                      type="button"
                      @click="editingQuoteIsQuestion = true; editingEntryType = 1" 
                      class="px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1" 
                      :class="editingEntryType === 1 ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-500'"
                    >
                      ❓ 问题
                    </button>
                  </div>
                  <span class="text-[11px] font-mono text-slate-400">支持高亮与引用</span>
                </div>

                

                <div class="w-full">
                  <TiptapEditor @quote-ref="openQuoteRefPicker" 
                    v-model="editingQuoteContent"
                    :show-zen-trigger="true"
                    @open-zen="openZenEditForQuote(card)"
                    :show-headings="true"
                    min-height="110px"
                    placeholder="修改原句内容..."
                  />
                </div>

                <div class="flex items-center gap-2 px-1">
                  <span class="text-xs text-slate-500 font-bold shrink-0">文献出处:</span>
                  <input 
                    type="text" 
                    v-model="editingQuoteSource" 
                    placeholder="如：《置身事内》P120..." 
                    class="flex-1 text-xs px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none" 
                  />
                </div>

                <div class="flex justify-end gap-2 pt-1 border-t border-slate-100">
                  <button type="button" @click="cancelEditQuote" class="text-xs px-3 py-1 text-slate-500 hover:text-slate-800 cursor-pointer">取消</button>
                  <button type="button" @click="saveEditQuote" class="text-xs font-bold px-4 py-1.5 rounded-xl bg-emerald-600 text-white shadow-xs cursor-pointer active:scale-95">保存修改</button>
                </div>
              </div>

              <div v-else class="relative pl-4 border-l-[3.5px] rounded-l-xs py-1 mb-1" :style="{ borderColor: card.is_question === 1 ? '#F97316' : (card.is_question === 2 ? '#6366F1' : '#10B981') }">
                <div v-if="card.is_question !== 0" class="flex items-center gap-2 mb-2.5">
                  <button v-if="card.is_question === 1" @click="handleToggleResolved(card.id)" class="px-3 py-0.5 rounded-full text-[11px] font-bold border shadow-2xs cursor-pointer" :style="card.is_resolved ? { backgroundColor: '#DCFCE7', color: '#15803D', borderColor: '#86EFAC' } : { backgroundColor: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A' }">
                    {{ card.is_resolved ? '✓ 已参透' : '⏳ 探索中' }}
                  </button>
                  <span v-else-if="card.is_question === 2" class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border shadow-2xs bg-indigo-50 text-indigo-700 border-indigo-200 flex items-center gap-1">
                    <span>💡</span><span>原生感悟</span>
                  </span>
                  <time class="text-xs font-mono text-slate-400">{{ formatDate(card.created_at) }}</time>
                </div>
                <time v-else class="text-xs font-mono text-slate-400 block mb-2.5">{{ formatDate(card.created_at) }}</time>

                <div 
                  class="rich-rendered text-[15px] leading-[28px] text-[#0F172A] font-sans font-normal"
                  :class="expandedQuoteTexts[card.id] ? '' : (card.content.length > 240 ? 'clean-quote-collapsed' : '')"
                  v-html="richTextEngine.renderRichText(card.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently, searchQuery)"
                ></div>

                <div v-if="card.content.length > 240" class="pt-1">
                  <button 
                    @click.stop="toggleQuoteExpand(card.id)"
                    class="inline-flex items-center gap-1.5 text-xs px-3 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition active:scale-95 cursor-pointer shadow-2xs select-none"
                  >
                    <span>{{ expandedQuoteTexts[card.id] ? '▴ 收起全文' : '▾ 展开全文' }}</span>
                  </button>
                </div>

                <div v-if="card.source" class="mt-3 text-xs italic text-slate-600 font-serif">—— <span v-html="richTextEngine.highlightText(card.source, searchQuery)"></span></div>
              </div>

              <!-- 卡片标签与被引回响胶囊 -->
              <div class="flex flex-wrap items-center gap-2 pt-1 pb-1">
                <!-- 反向链接 (温润翡翠色系) -->
                <button 
                  v-if="knowledgeBase.getBacklinkCount(card.id) > 0"
                  type="button"
                  @click.stop="toggleBacklinks(card.id)"
                  class="text-xs px-3 py-1 rounded-full border transition-all duration-150 cursor-pointer font-bold flex items-center gap-1.5 shadow-2xs active:scale-95 select-none"
                  :class="expandedBacklinkCardIds[card.id] ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs' : 'bg-emerald-50 hover:bg-emerald-100/90 text-emerald-900 border-emerald-300/80'"
                  title="查看引用此句的手记与年轮"
                >
                  <span class="text-xs">🔗</span>
                  <span>{{ knowledgeBase.getBacklinkCount(card.id) }} {{ TERMS.backlinks.badgeSuffix }}</span>
                  <span class="text-[9px] opacity-60">{{ expandedBacklinkCardIds[card.id] ? '▲' : '▼' }}</span>
                </button>
                <span 
                  v-for="tag in card.tags" 
                  :key="tag"
                  class="text-xs px-3 py-1 rounded-full border font-semibold flex items-center gap-1.5 shadow-2xs transition hover:opacity-90 select-none"
                  :style="{ backgroundColor: tagsEngine.getTagColor(tag).bg, borderColor: tagsEngine.getTagColor(tag).border, color: tagsEngine.getTagColor(tag).text }"
                >
                  <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: tagsEngine.getTagColor(tag).dot }"></span>
                  <span @click.stop="tagsEngine.selectedTag.value = tag; loadData();" class="cursor-pointer hover:underline">{{ tagsEngine.formatHierarchyTagName(tag) }}</span>
                  <button @click.stop="tagsEngine.removeTagFromCard(card.id, tag)" class="opacity-40 hover:opacity-100 hover:text-rose-600 cursor-pointer ml-0.5">×</button>
                </span>
                <button 
                  @click.stop="tagsEngine.openTagPickerModal(card.id)"
                  class="text-xs px-3 py-1 rounded-full border border-dashed border-emerald-950/[0.18] bg-slate-50 hover:bg-emerald-50 text-slate-600 hover:text-emerald-800 cursor-pointer flex items-center gap-1 shadow-2xs font-semibold"
                >
                  <span>+ 贴标签</span>
                </button>
              </div>

              <!-- 知识脉络回响高密度流式面板 (极简原木活页设计，消除所有负面标签) -->
              <div 
                v-if="expandedBacklinkCardIds[card.id]"
                class="my-2 p-3.5 rounded-2xl bg-[#F8FAF7] border border-emerald-950/[0.07] shadow-inner flex flex-col gap-2.5 animate-fade-in"
                @click.stop
              >
                <!-- 优雅顶栏 -->
                <div class="flex items-center justify-between text-xs pb-2 border-b border-emerald-950/[0.05]">
                  <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span class="font-bold text-slate-700 tracking-tight text-xs">{{ TERMS.backlinks.drawerTitle }}</span>
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100/80 text-emerald-800 font-bold">
                      {{ knowledgeBase.getBacklinkCount(card.id) }} {{ TERMS.backlinks.drawerCountSuffix }}
                    </span>
                  </div>
                  <button 
                    type="button"
                    @click="expandedBacklinkCardIds[card.id] = false" 
                    class="text-slate-400 hover:text-slate-700 text-xs px-2 py-0.5 rounded-lg hover:bg-slate-200/50 transition cursor-pointer"
                  >
                    收起 ✕
                  </button>
                </div>

                <!-- 回响条目流 (高度封顶，精细间距) -->
                <div class="max-h-60 overflow-y-auto stable-scroll pr-1 flex flex-col gap-2">
                  <div 
                    v-for="item in knowledgeBase.getBacklinks(card.id)" 
                    :key="item.source_quote_id + (item.source_thought_id || '')"
                    @click="quoteLinksEngine.jumpToQuote(item.source_quote_id, card.id)"
                    class="p-2.5 rounded-xl bg-white border border-slate-200/60 hover:border-emerald-300 hover:bg-emerald-50/20 hover:shadow-xs transition-all duration-150 flex flex-col gap-1.5 cursor-pointer group"
                    title="点击跳转并唤醒原路回溯"
                  >
                    <!-- 条目元信息 (有出处展示书名，无出处自然留白，绝不出现'无出处') -->
                    <div class="flex items-center justify-between text-[11px]">
                      <div class="flex items-center gap-2 min-w-0">
                        <span 
                          class="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 border"
                          :class="item.is_question === 1 ? 'bg-amber-50 text-amber-900 border-amber-200' : (item.is_question === 2 ? 'bg-indigo-50 text-indigo-900 border-indigo-200' : 'bg-emerald-50 text-emerald-900 border-emerald-200')"
                        >
                          {{ item.is_question === 1 ? '待解之问' : (item.is_question === 2 ? '原生感悟' : '客观摘录') }}
                        </span>
                        <span v-if="item.quote_source" class="truncate font-serif text-slate-700 font-medium text-xs">
                          《{{ item.quote_source }}》
                        </span>
                      </div>
                      
                      <div class="flex items-center gap-2 shrink-0">
                        <span class="font-mono text-slate-400 text-[10.5px]">{{ formatShortDate(item.created_at) }}</span>
                        <span class="text-[11px] font-bold text-emerald-700 group-hover:text-emerald-900 flex items-center gap-0.5">
                          <span>{{ TERMS.backlinks.jumpActionText }}</span>
                          <span class="text-[9px]">➔</span>
                        </span>
                      </div>
                    </div>

                    <!-- 上下文摘要 (杂志引文线，自然流畅) -->
                    <div class="text-xs text-slate-600 font-serif leading-relaxed pl-2.5 border-l-2 border-emerald-200/80 group-hover:border-emerald-500 transition-colors line-clamp-2">
                      {{ item.context_snippet }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- 灵动年轮思考节点区 -->
              <div class="pt-4 border-t border-slate-100 flex flex-col gap-3.5">
                <div class="text-xs text-slate-500 flex items-center justify-between">
                  <span class="font-bold flex items-center gap-1.5 text-emerald-900">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>思维年轮 ({{ card.thoughts.length }} 层演进)</span>
                  </span>
                  <button v-if="card.thoughts.length > 2" @click="toggleCardThoughtsExpand(card.id)" class="text-xs text-emerald-700 font-semibold hover:underline">
                    {{ isCardThoughtsExpanded(card.id) ? '收起中间历史' : '全部展开' }}
                  </button>
                </div>

                <div v-if="card.thoughts.length > 0" class="relative timeline-stem-3d flex flex-col gap-4">
                  <template v-for="(t, index) in card.thoughts" :key="t.id">
                    <!-- 中间层级折叠槽 -->
                    <div 
                      v-if="!isCardThoughtsExpanded(card.id) && card.thoughts.length > 2 && index === 1"
                      @click.stop="toggleCardThoughtsExpand(card.id)"
                      class="relative my-0.5 group cursor-pointer select-none transition-all duration-200"
                    >
                      <div class="absolute -left-[28px] top-1/2 -translate-y-1/2 flex items-center justify-center z-10 w-4 h-4 pointer-events-none">
                        <div class="w-3.5 h-3.5 rounded-full flex items-center justify-center shadow-2xs border-2 border-white bg-gradient-to-tr from-emerald-500 to-teal-400 group-hover:scale-125 transition-transform">
                          <span class="w-1 h-1 rounded-full bg-white shadow-2xs"></span>
                        </div>
                      </div>

                      <div class="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-emerald-50/70 hover:bg-emerald-100/80 border border-dashed border-emerald-300 text-emerald-900 transition-all shadow-xs">
                        <div class="flex items-center gap-2.5">
                          <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-emerald-200/80 text-[11px] font-mono font-bold text-emerald-900 shadow-2xs">
                            +{{ card.thoughts.length - 2 }}
                          </span>
                          <span class="text-xs font-semibold">已收拢中间 {{ card.thoughts.length - 2 }} 层思考沉淀</span>
                        </div>
                        <div class="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                          <span>展开查看</span>
                          <span class="text-[10px]">▾</span>
                        </div>
                      </div>
                    </div>

                    <!-- 思考年轮卡片 -->
                    <div 
                      v-if="card.thoughts.length <= 2 || isCardThoughtsExpanded(card.id) || index === 0 || index === card.thoughts.length - 1"
                      class="relative ring-card-3d flex flex-col gap-2.5"
                    >
                      <div class="absolute -left-[28px] top-4 flex items-center justify-center z-10 w-4 h-4 pointer-events-none select-none">
                        <div 
                          class="rounded-full flex items-center justify-center shadow-xs"
                          :style="{
                            width: '14px',
                            height: '14px',
                            background: card.is_question === 1 ? 'radial-gradient(circle, #FEF3C7 30%, #F59E0B 100%)' : (card.is_question === 2 ? 'radial-gradient(circle, #E0E7FF 30%, #6366F1 100%)' : 'radial-gradient(circle, #D1FAE5 30%, #10B981 100%)'),
                            border: '2px solid #FFFFFF'
                          }"
                        >
                          <span class="w-1 h-1 rounded-full bg-white shadow-2xs"></span>
                        </div>
                      </div>

                      <div class="flex items-center justify-between text-xs text-slate-500 font-mono pb-1 border-b border-slate-100">
                        <div class="flex items-center gap-2">
                          <span class="font-bold text-slate-800">{{ formatShortDate(t.created_at) }}</span>
                          <span class="text-[10px] px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 font-sans font-semibold">
                            {{ getRingTimeSpan(card.created_at, t.created_at) }}
                          </span>
                        </div>
                        <div class="flex items-center gap-1.5 font-sans opacity-75 hover:opacity-100">
                          <button @click="startEditThought(t)" title="编辑思考" class="text-xs px-2 py-0.5 rounded hover:bg-slate-100 text-slate-600">✏️</button>
                          <button @click="requestDeleteThought(t.id)" title="删除思考" class="text-xs px-2 py-0.5 rounded hover:bg-rose-50" :class="pendingDeleteThoughtId === t.id ? 'text-rose-600 font-bold' : 'text-slate-400'">
                            {{ pendingDeleteThoughtId === t.id ? '确定?' : '🗑️' }}
                          </button>
                        </div>
                      </div>

                      <!-- 编辑既有思考 -->
                      <div v-if="editingThoughtId === t.id" @click.stop class="mt-1 flex flex-col rounded-2xl p-1 gap-2 animate-fade-in">
                        <div class="w-full">
                          <TiptapEditor @quote-ref="openQuoteRefPicker" 
                            v-model="editingThoughtText"
                        :show-zen-trigger="true"
                        @open-zen="openZenEditForThought(t)"
                            min-height="80px"
                            placeholder="修改认知演进..."
                            content-class="font-sans text-xs sm:text-sm leading-relaxed"
                          />
                        </div>
                        <div class="flex justify-end gap-2 pt-1.5 border-t border-slate-200">
                          <button @click="editingThoughtId = null" class="text-xs px-3 py-1 text-slate-500 hover:text-slate-800 cursor-pointer">取消</button>
                          <button @click="saveEditThought" class="text-xs px-4 py-1.5 rounded-xl bg-emerald-600 text-white font-bold shadow-xs cursor-pointer">保存修改</button>
                        </div>
                      </div>

                      <div v-else class="flex flex-col gap-1.5">
                        <div 
                          class="rich-rendered text-[15px] leading-[1.8] text-[#0F172A] font-sans font-normal break-all break-words [overflow-wrap:anywhere] min-w-0"
                          :class="expandedThoughtTexts[t.id] ? '' : (t.content.length > 140 ? 'clean-thought-collapsed' : '')"
                          v-html="richTextEngine.renderRichText(t.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently, searchQuery)"
                        ></div>
                        <div v-if="t.content.length > 140" class="pt-0.5">
                          <button 
                            @click="toggleThoughtExpand(t.id)"
                            class="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition cursor-pointer shadow-2xs"
                          >
                            <span>{{ expandedThoughtTexts[t.id] ? '▴ 收起认知' : '▾ 展开全文' }}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </template>
                </div>

                <!-- 追加认知 -->
                <div class="pt-1 select-text">
                  <!-- 编辑展开态 -->
                  <div 
                    v-if="activeAppendQuoteId === card.id" 
                    class="flex flex-col rounded-2xl bg-slate-50/90 p-3 gap-2.5 border border-emerald-200 shadow-sm animate-fade-in"
                    @click.stop
                  >
                    <div class="w-full">
                      <TiptapEditor 
                        @quote-ref="openQuoteRefPicker" 
                        v-model="appendThoughtContent"
                        min-height="80px"
                        placeholder="写下当下对此手记的新认知与思考..."
                        content-class="font-sans text-xs sm:text-sm leading-relaxed"
                      />
                    </div>

                    <div class="flex justify-between items-center pt-2 border-t border-slate-200">
                      <span class="text-[10.5px] font-mono text-slate-400">支持截图直接粘贴 (Ctrl+V)</span>
                      <div class="flex gap-2">
                        <button 
                          type="button" 
                          @click.stop="activeAppendQuoteId = null; appendThoughtContent = '';" 
                          class="h-8 px-4 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
                        >
                          取消
                        </button>
                        <button 
                          type="button" 
                          @click.stop="handleAppendThought(card.id)" 
                          :disabled="isContentEmpty(appendThoughtContent)" 
                          class="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-30 cursor-pointer shadow-xs transition active:scale-95"
                        >
                          追加年轮 ↵
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- 初始收拢按钮 -->
                  <button 
                    v-else 
                    type="button" 
                    @click.stop="activeAppendQuoteId = card.id; appendThoughtContent = '';" 
                    class="h-8 px-4 inline-flex items-center gap-2 rounded-full border border-dashed border-emerald-300 bg-emerald-50/60 hover:bg-emerald-100/80 hover:border-emerald-500 text-xs font-bold text-emerald-800 transition-all duration-150 active:scale-95 cursor-pointer shadow-2xs select-none group"
                  >
                    <span class="w-4 h-4 rounded-full bg-emerald-200 group-hover:bg-emerald-300 flex items-center justify-center text-[10px] font-bold text-emerald-900 transition-colors">+</span>
                    <span>追加认知年轮</span>
                    <span class="text-[10px] opacity-60 font-mono">Thought</span>
                  </button>
                </div>
              </div>
            </article>
          </div>

          <!-- 底部虚拟占位 -->
          <div 
            v-if="virtualScrollEngine.virtualState.value.isVirtualized && virtualScrollEngine.virtualState.value.bottomSpacer > 0"
            :style="{ height: virtualScrollEngine.virtualState.value.bottomSpacer + 'px', flexShrink: 0 }"
          ></div>
        </div>
      </main>
    </div>

    <!-- 4.2 常看聚焦看板 (纯净独占) -->
    <div v-else-if="currentTab === 'pinned'" class="flex-1 min-h-0 w-full px-6 sm:px-8 py-4 sm:py-5 flex flex-col overflow-hidden max-w-7xl mx-auto">
      <div class="shrink-0 flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-2xs animate-pulse"></span>
          <h2 class="text-sm font-bold text-[#0F172A] tracking-tight">常看聚焦看板</h2>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">
            当前置顶 {{ pinnedQuotesList.length }} 篇核心手记
          </span>
          <span class="text-[11px] font-mono text-slate-400 hidden sm:inline">
            (可上下按住 ⠿ 拖拽卡片自由排序)
          </span>
        </div>
      </div>

      <div class="flex-1 min-h-0 stable-scroll flex flex-col gap-6 pr-1 pb-24" @click="handleRichContainerClick">
        <div v-if="pinnedQuotesList.length === 0" class="flex-1 flex flex-col items-center justify-center py-20 text-center select-none">
          <div class="w-16 h-16 rounded-3xl bg-amber-100 flex items-center justify-center text-3xl mb-3 shadow-inner">🌟</div>
          <h3 class="text-sm font-bold text-[#0F172A] mb-1">暂无置顶的常看年轮</h3>
          <p class="text-xs text-slate-500 mb-4">在年轮卡片上点击「🌟 置顶」即可收录在此常驻回顾。</p>
        </div>
        <article 
          v-for="(card, pIdx) in pinnedQuotesList" 
          :key="'pinned_' + card.id"
          draggable="true"
          @dragstart="handlePinnedDragStart($event, pIdx)"
          @dragover="handlePinnedDragOver($event, pIdx)"
          @dragleave="handlePinnedDragLeave($event, pIdx)"
          @drop="handlePinnedDrop($event, pIdx)"
          @dragend="handlePinnedDragEnd"
          @click="handleCardClick(card.id)"
          @mouseleave="handleCardMouseLeave(card.id)"
          class="relative soft-card p-5 sm:p-6 flex flex-col gap-3 transition-all duration-150 min-w-0 border-amber-200/60 select-text"
          :class="[
            draggingPinnedIndex === pIdx ? 'opacity-30 scale-[0.98] border-dashed border-amber-500 bg-amber-50/20' : '',
            dragOverPinnedIndex === pIdx && draggingPinnedIndex !== pIdx ? 'ring-2 ring-amber-500/80 shadow-lg -translate-y-1' : ''
          ]"
        >
          <!-- 优雅拖拽把手 (常驻左上角微型指示，悬停时翡翠/琥珀微光) -->
          <div 
            class="absolute left-3.5 top-3.5 z-10 flex items-center justify-center w-6 h-6 rounded-lg text-slate-300 hover:text-amber-700 hover:bg-amber-100/70 transition-all cursor-grab active:cursor-grabbing select-none"
            title="按住上下拖拽调整常看顺序"
          >
            <span class="text-xs font-mono leading-none tracking-tighter">⠿</span>
          </div>
          <!-- 右上角快捷常看角标 (可直接点击取消置顶) -->
          <button 
            v-if="activeActionCardId !== card.id"
            @click.stop="togglePinCard(card.id)"
            class="absolute right-6 top-6 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 hover:bg-rose-100 border border-amber-300 hover:border-rose-300 shadow-2xs text-xs transition-all duration-150 cursor-pointer active:scale-90 group select-none"
            title="点击取消常看置顶"
          >
            <span class="group-hover:hidden text-xs">🌟</span>
            <span class="hidden group-hover:inline text-rose-600 font-bold text-xs">✕</span>
          </button>

          <!-- 悬浮/激活操作胶囊 -->
          <div 
            v-if="activeActionCardId === card.id"
            class="absolute right-5 top-5 z-20 flex items-center gap-1.5 p-1 rounded-full bg-white/95 border border-amber-300/80 shadow-xl select-none animate-fade-in"
            @click.stop
          >
            <button @click.stop="openFocusMode(card)" title="专注模式" class="h-7 px-3 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer active:scale-95">
              <span>🎯 专注</span>
            </button>
            <button @click.stop="quoteLinksEngine.jumpToQuote(card.id)" title="在年轮中定位此卡片" class="h-7 px-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer active:scale-95">
              <span>📜 定位</span>
            </button>
            <button @click.stop="copyQuoteSummary(card)" title="复制摘要" class="h-7 px-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer active:scale-95">
              <span>📋 复制</span>
            </button>
            <button @click.stop="togglePinCard(card.id)" title="移出常看" class="h-7 px-3 rounded-full text-xs font-bold shadow-2xs bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 flex items-center gap-1 transition-colors cursor-pointer active:scale-95">
              <span>✕ 取消置顶</span>
            </button>
          </div>

          <div class="relative pl-4 border-l-[3.5px] py-1 mb-1" :style="{ borderColor: card.is_question === 1 ? '#F97316' : (card.is_question === 2 ? '#6366F1' : '#10B981') }">
            <time class="text-xs font-mono text-slate-400 block mb-2.5">{{ formatDate(card.created_at) }}</time>
            <div 
              class="rich-rendered text-[15px] leading-[28px] text-[#0F172A] font-sans font-normal"
              v-html="richTextEngine.renderRichText(card.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently)"
            ></div>
            <div v-if="card.source" class="mt-3 text-xs italic text-slate-600 font-serif">—— {{ card.source }}</div>
          </div>

          <div class="flex flex-wrap items-center gap-2 pt-1 pb-1">
            <span 
              v-for="tag in card.tags" 
              :key="tag"
              class="text-xs px-3 py-1 rounded-full border font-semibold flex items-center gap-1.5 shadow-2xs"
              :style="{ backgroundColor: tagsEngine.getTagColor(tag).bg, borderColor: tagsEngine.getTagColor(tag).border, color: tagsEngine.getTagColor(tag).text }"
            >
              <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: tagsEngine.getTagColor(tag).dot }"></span>
              <span>{{ tagsEngine.formatHierarchyTagName(tag) }}</span>
            </span>
            <button @click.stop="tagsEngine.openTagPickerModal(card.id)" class="text-xs px-3 py-1 rounded-full border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-600">
              + 贴标签
            </button>
          </div>
        </article>

      </div>
    </div>

        <!-- 4.3 认知脉动与激增看板 (纯净独占) -->
    <TagTrendsView 
      v-else-if="currentTab === 'trends'"
      :quotes="quotes"
      :get-tag-dot-color="(name) => tagsEngine.getTagColor(name).dot"
      @jump-to-quote="(id) => { currentTab = 'archive'; quoteLinksEngine.jumpToQuote(id); }"
      @filter-tag-in-archive="(name) => { tagsEngine.selectedTag.value = name; currentTab = 'archive'; loadData(); }"
    />

    <!-- 5. 沉浸式深度心流书房 (🎯 专注模式 · 含悬浮幽灵勘误) -->
    <Teleport to="body">
      <div 
        v-if="focusQuote"
        class="fixed inset-0 z-50 flex flex-col bg-[#F6F8F5] animate-fade-in select-text overflow-hidden"
        @click="handleRichContainerClick"
      >
        <!-- 沉浸式顶栏 -->
        <header class="h-16 shrink-0 px-6 sm:px-10 border-b border-emerald-950/[0.06] bg-white flex items-center justify-between select-none">
          <div class="flex items-center gap-3">
            <span class="w-2.5 h-2.5 rounded-full" :class="focusQuote.is_question ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse'"></span>
            <div class="flex items-center gap-2">
              <span class="text-xs font-extrabold tracking-wider uppercase text-emerald-950 font-semibold">
                {{ focusQuote.is_question === 1 ? '待解之问 · 沉浸探究' : (focusQuote.is_question === 2 ? '原生感悟 · 深度沉淀' : '客观原句 · 沉浸精读') }}
              </span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-600">
                收录于 {{ formatDate(focusQuote.created_at) }}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <span class="text-[11px] font-mono text-slate-400 hidden sm:inline">按 Esc 退出专注</span>
            <button 
              type="button"
              @click="closeFocusMode" 
              class="px-5 py-1.5 rounded-full bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer shadow-md transition active:scale-95 flex items-center gap-1.5"
            >
              <span>✕</span>
              <span>退出心流</span>
            </button>
          </div>
        </header>

        <!-- 居中卷轴内容区 -->
        <main class="focus-scroll-viewport flex-1 min-h-0 stable-scroll px-5 sm:px-8 py-8 sm:py-12">
          <div class="w-full max-w-3xl mx-auto flex flex-col gap-8 pb-32">
            
            <!-- 原句大字报核心卡片 (支持原句与出处幽灵勘误) -->
            <article class="focus-card-optimized p-8 sm:p-12 rounded-[36px] bg-white border border-emerald-950/[0.08] shadow-card flex flex-col gap-6 relative overflow-hidden group">
              
              <!-- 顶部状态行与悬浮勘误按钮 -->
              <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <span class="text-xs font-mono font-bold text-emerald-800 flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full" :class="focusQuote.is_question ? 'bg-amber-500' : 'bg-emerald-500'"></span>
                  <span>{{ focusQuote.is_question === 1 ? '核心议题' : (focusQuote.is_question === 2 ? '独家洞见' : '典藏原句') }}</span>
                </span>
                
                <div class="flex items-center gap-3">
                  <!-- 雅致常驻勘误按钮：低调显眼，悬停翡翠微光响应 -->
                  <button 
                    v-if="!isFocusEditingQuote" 
                    type="button"
                    @click="startFocusEditQuote" 
                    title="修改原句错别字或出处" 
                    class="text-xs px-3 py-1 rounded-full border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-600 hover:text-emerald-800 font-semibold flex items-center gap-1.5 cursor-pointer transition-all duration-150 shadow-2xs hover:shadow-xs hover:-translate-y-0.5 active:scale-95 select-none"
                  >
                    <span class="text-xs">✏️</span>
                    <span>勘误原句</span>
                  </button>
                </div>
              </div>

              <!-- 原句勘误编辑态 -->
              <div v-if="isFocusEditingQuote" class="flex flex-col gap-3 py-1 animate-fade-in">
                <div class="w-full">
                  <TiptapEditor @quote-ref="openQuoteRefPicker" 
                    v-model="focusEditingQuoteContent"
                    :show-headings="true"
                    min-height="110px"
                    placeholder="勘误原句错字..."
                  />
                </div>
                
                <div class="flex items-center gap-2">
                  <span class="text-xs text-slate-500 font-bold shrink-0">出处校准:</span>
                  <input 
                    type="text" 
                    v-model="focusEditingQuoteSource" 
                    placeholder="如：《置身事内》P120..." 
                    class="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none"
                  />
                </div>

                <div class="flex justify-end gap-2 pt-1 border-t border-slate-100">
                  <button type="button" @click="cancelFocusEditQuote" class="text-xs px-3.5 py-1.5 text-slate-500 hover:text-slate-800 cursor-pointer">取消</button>
                  <button type="button" @click="saveFocusEditQuote" class="text-xs font-bold px-4 py-1.5 rounded-xl bg-emerald-600 text-white shadow-xs cursor-pointer active:scale-95">✓ 完成勘误</button>
                </div>
              </div>

              <!-- 正常心流阅读态 (大号典雅衬线墨字) -->
              <template v-else>
                <div 
                  class="rich-rendered text-2xl sm:text-[28px] md:text-[32px] leading-[2.1] text-[#0F172A] font-serif tracking-normal" 
                  v-html="richTextEngine.renderRichText(focusQuote.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently)"
                ></div>

                <div v-if="focusQuote.source" class="mt-2 text-sm italic text-slate-500 font-serif border-t border-slate-100/80 pt-4 flex items-center justify-between gap-4">
                  <span class="truncate min-w-0">—— {{ focusQuote.source }}</span>
                  <span class="text-[11px] font-mono text-slate-400 font-sans not-italic shrink-0 whitespace-nowrap">时光沉淀 {{ Math.max(0, Math.floor((Date.now() - focusQuote.created_at) / 86400000)) }} 天</span>
                </div>
              </template>
            </article>

            <!-- 专注模式反向链接脉络回响 (图谱驱动) -->
            <section 
              v-if="knowledgeBase.getBacklinkCount(focusQuote.id) > 0"
              class="p-5 rounded-3xl bg-sky-50/80 border border-sky-200/80 flex flex-col gap-3"
            >
              <div class="flex items-center justify-between text-xs font-bold text-sky-950">
                <span class="flex items-center gap-1.5">
                  <span>🔗</span>
                  <span>此句在全库中的知识回响 ({{ knowledgeBase.getBacklinkCount(focusQuote.id) }} 处引用)：</span>
                </span>
                <button 
                  type="button"
                  @click="toggleBacklinks(focusQuote.id)" 
                  class="text-xs text-sky-700 hover:underline cursor-pointer"
                >
                  {{ expandedBacklinkCardIds[focusQuote.id] ? '收起回响 ▴' : '展开回响明细 ▾' }}
                </button>
              </div>

              <div v-if="expandedBacklinkCardIds[focusQuote.id]" class="flex flex-col gap-2 pt-1 animate-fade-in">
                <div 
                  v-for="item in knowledgeBase.getBacklinks(focusQuote.id)" 
                  :key="'focus_bl_' + item.source_quote_id + (item.source_thought_id || '')"
                  class="p-3 rounded-2xl bg-white border border-sky-100 shadow-2xs flex flex-col gap-1.5 text-xs"
                >
                  <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span class="font-bold text-slate-700">{{ item.quote_source || '独立摘录' }}</span>
                    <span>{{ formatDate(item.created_at) }}</span>
                  </div>
                  <p class="text-slate-700 leading-relaxed font-sans">{{ item.context_snippet }}</p>
                  <div class="flex justify-end">
                    <button 
                      type="button" 
                      @click="closeFocusMode(); quoteLinksEngine.jumpToQuote(item.source_quote_id, focusQuote.id);" 
                      class="text-[11px] font-bold text-sky-700 hover:text-sky-950 hover:underline cursor-pointer"
                    >
                      跳转至该卡片 ➔
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <!-- 既有年轮生长链 (支持每条年轮错字悬浮微勘误) -->
            <section v-if="focusQuote.thoughts && focusQuote.thoughts.length > 0" class="flex flex-col gap-3">
              <div class="flex items-center justify-between px-2 text-xs text-slate-500">
                <span class="font-bold flex items-center gap-1.5 text-emerald-900">
                  <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>过往思维年轮 ({{ focusQuote.thoughts.length }} 层演进)：</span>
                </span>
              </div>

              <div class="flex flex-col gap-3 pl-4 border-l-2 border-emerald-300/80 ml-3 my-1">
                <div 
                  v-for="t in focusQuote.thoughts" 
                  :key="'focus_th_' + t.id"
                  class="p-5 rounded-3xl bg-white border border-emerald-950/[0.06] shadow-2xs flex flex-col gap-2 group transition-all"
                >
                  <div class="flex items-center justify-between text-xs font-mono text-slate-400 pb-1 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-slate-700">{{ formatShortDate(t.created_at) }}</span>
                      <span class="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[10px] font-sans font-semibold">
                        {{ getRingTimeSpan(focusQuote.created_at, t.created_at) }}
                      </span>
                    </div>

                                        <!-- 雅致年轮勘误按钮：悬停翡翠微光响应 -->
                    <button 
                      v-if="focusEditingThoughtId !== t.id" 
                      type="button"
                      @click="startFocusEditThought(t)" 
                      title="修改思考错别字" 
                      class="text-[11px] px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-600 hover:text-emerald-800 font-semibold flex items-center gap-1 cursor-pointer transition-all duration-150 shadow-2xs hover:shadow-xs active:scale-95 select-none"
                    >
                      <span class="text-[10px]">✏️</span>
                      <span>勘误</span>
                    </button>
                  </div>

                  <!-- 思考年轮勘误态 -->
                  <div v-if="focusEditingThoughtId === t.id" class="flex flex-col gap-2 pt-1 animate-fade-in">
                    <div class="w-full">
                      <TiptapEditor @quote-ref="openQuoteRefPicker" 
                        v-model="focusEditingThoughtText"
                        min-height="80px"
                        placeholder="勘误思考错字..."
                        content-class="font-sans text-sm sm:text-base leading-relaxed"
                      />
                    </div>
                    
                    <div class="flex justify-end gap-2">
                      <button type="button" @click="cancelFocusEditThought" class="text-xs px-3 py-1 text-slate-500 hover:text-slate-800 cursor-pointer">取消</button>
                      <button type="button" @click="saveFocusEditThought" class="text-xs font-bold px-3.5 py-1 rounded-xl bg-emerald-600 text-white shadow-xs cursor-pointer active:scale-95">✓ 完成勘误</button>
                    </div>
                  </div>

                  <!-- 思考正常呈现 -->
                  <div 
                    v-else
                    class="rich-rendered text-sm sm:text-base leading-relaxed text-[#0F172A] font-sans"
                    v-html="richTextEngine.renderRichText(t.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently)"
                  ></div>
                </div>
              </div>
            </section>

            <!-- 深度心流新芽续写台 -->
            <section class="p-6 sm:p-8 rounded-[32px] bg-white border border-emerald-950/[0.08] shadow-sm flex flex-col gap-3.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <span>🌱</span>
                  <span>心流顿悟 · 延伸新认知：</span>
                </span>
                
              </div>

              <div class="w-full">
                <TiptapEditor @quote-ref="openQuoteRefPicker" 
                  v-model="focusThoughtInput"
                  min-height="100px"
                  placeholder="在这一刻，文字与你的心灵共振出了什么新认知？..."
                  content-class="font-sans text-sm sm:text-base leading-relaxed"
                />
              </div>

              <div class="flex justify-between items-center pt-1">
                <span class="text-[11px] font-mono text-slate-400">将作为最新的年轮节点生长在外围</span>
                <button 
                  type="button"
                  @click="handleAppendThoughtInFocus" 
                  :disabled="isContentEmpty(focusThoughtInput)" 
                  class="px-6 py-2.5 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold disabled:opacity-30 cursor-pointer shadow-md shadow-emerald-600/20 transition active:scale-95"
                >
                  🌱 延伸思维年轮
                </button>
              </div>
            </section>

          </div>
        </main>
      </div>
    </Teleport>

    <!-- 5.5 全局全屏心流沉浸编辑台 (True Zen Mode Modal) -->
    <Teleport to="body">
      <div 
        v-if="zenEditState.isOpen"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 bg-slate-950/70 backdrop-blur-xs animate-fade-in select-none"
        @click.self="cancelZenEdit"
        @keydown.ctrl.enter="saveZenEdit"
        @keydown.meta.enter="saveZenEdit"
      >
        <div class="w-full max-w-4xl h-[82vh] bg-white rounded-[28px] border border-emerald-950/[0.08] shadow-2xl flex flex-col overflow-hidden animate-pop select-text">
          
          <!-- 弹窗顶栏 -->
          <div class="shrink-0 px-6 py-3.5 border-b border-slate-100 flex items-center justify-between select-none">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-center text-sm shadow-2xs font-bold">
                ✏️
              </div>
              <div>
                <h2 class="text-sm font-extrabold text-[#0F172A] tracking-tight">{{ zenEditState.title }}</h2>
                <p class="text-[10.5px] text-slate-400 font-mono">沉浸模式 · 全宽视野深度推敲</p>
              </div>
            </div>

            <button 
              type="button"
              @click="cancelZenEdit"
              class="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-800 flex items-center justify-center text-xs transition cursor-pointer"
            >
              ✕
            </button>
          </div>

          <!-- 全尺寸所见即所得编辑器 -->
          <div class="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
            <TiptapEditor
              ref="zenEditorRef"
              :key="`zen_${zenEditState.type}_${zenEditState.id}`"
              v-model="zenEditState.content"
              :show-headings="true"
              :hide-quote-ref="false"
              min-height="100%"
              max-height="100%"
              content-class="font-serif text-base sm:text-[17px] leading-[2.0]"
              @quote-ref="openQuoteRefPicker"
            />
          </div>

          <!-- 弹窗底栏操作：取消与保存 -->
          <div class="shrink-0 px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between select-none">
            <span class="text-[11px] font-mono text-slate-400">支持加粗、荧光高亮、清单与图片粘贴</span>
            <div class="flex items-center gap-2.5">
              <button 
                type="button" 
                @click="cancelZenEdit"
                class="px-4 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                取消
              </button>
              <button 
                type="button" 
                @click="saveZenEdit"
                class="px-6 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md active:scale-95 cursor-pointer transition"
              >
                ✓ 保存修改
              </button>
            </div>
          </div>

        </div>
      </div>
    </Teleport>

    <!-- 6. 标签管理 Modal (全新双栏知识脉络工作台) -->
    <Teleport to="body">
      <TagManagerModal 
        v-if="tagsEngine.isTagManagerOpen.value"
        :tag-stats="tagsEngine.tagStats.value"
        :quotes="quotes"
        :empty-tags-count="tagsEngine.emptyTagsCount.value"
        :get-tag-dot-color="(name) => tagsEngine.getTagColor(name).dot"
        :format-hierarchy-name="tagsEngine.formatHierarchyTagName"
        :initial-parent="tagManagerQuickAddParent"
        @close="tagsEngine.isTagManagerOpen.value = false; tagManagerQuickAddParent = null;"
        @create-tag="(name) => tagsEngine.handleCreateTagFromManager(name)"
        @rename-tag="(oldN, newN) => { tagsEngine.renamingTagOld.value = oldN; tagsEngine.renamingTagNew.value = newN; tagsEngine.saveRenameTag(); }"
        @merge-tag="(src, tgt) => { tagsEngine.mergingSourceTag.value = src; tagsEngine.mergingTargetTag.value = tgt; tagsEngine.executeMergeTag(); }"
        @delete-tag="(name) => tagsEngine.handleDeleteTag(name)"
        @prune-empty="tagsEngine.pruneEmptyTags()"
        @filter-tag="(name) => { tagsEngine.selectedTag.value = name; tagsEngine.isTagManagerOpen.value = false; loadData(); }"
      />
    </Teleport>

    <!-- 7. 标签选择器 Modal (精致间距与显式创建版) -->
    <Teleport to="body">
      <div 
        v-if="tagsEngine.isTagPickerModalOpen.value"
        class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 animate-fade-in"
        @click.self="tagsEngine.isTagPickerModalOpen.value = false; loadData();"
      >
        <div class="w-full max-w-2xl sm:max-w-[720px] soft-modal p-6 sm:p-7 flex flex-col gap-4 max-h-[84vh] overflow-hidden shadow-2xl animate-pop border border-emerald-950/[0.08] bg-white">
          
          <!-- 弹窗标题 -->
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <div class="flex items-center gap-2">
              <span class="text-base">🏷️</span>
              <h2 class="text-sm font-bold text-[#0F172A]">选择或创建标签</h2>
              <span class="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                {{ tagsEngine.tagStats.value.length }} 个
              </span>
            </div>
            <button 
              type="button"
              @click="tagsEngine.isTagPickerModalOpen.value = false; loadData();" 
              class="text-sm text-slate-400 hover:text-slate-800 cursor-pointer px-1.5 py-0.5 rounded-lg hover:bg-slate-100 transition"
            >
              ✕
            </button>
          </div>

          <!-- 搜索与创建栏 -->
          <div class="flex items-center gap-2">
            <input 
              type="text"
              v-model="tagsEngine.tagPickerSearchQuery.value"
              @keydown.enter="tagsEngine.handleCreateNewTagInPicker"
              placeholder="搜索标签，或输入新名称按回车..."
              class="flex-1 text-xs px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[#0F172A] focus:bg-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20"
              autofocus
            />
            <button 
              v-if="tagsEngine.tagPickerSearchQuery.value.trim()"
              type="button"
              @click="tagsEngine.handleCreateNewTagInPicker"
              class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer active:scale-95 whitespace-nowrap transition-all flex items-center gap-1 shrink-0"
            >
              <span>+ 创建</span>
            </button>
          </div>

          <!-- 当没有匹配到已有标签时，醒目的创建提示卡片 -->
          <div 
            v-if="tagsEngine.tagPickerSearchQuery.value.trim() && tagsEngine.filteredTagsForPicker.value.length === 0"
            @click="tagsEngine.handleCreateNewTagInPicker"
            class="p-3.5 rounded-2xl bg-emerald-50/90 hover:bg-emerald-100 border border-emerald-300 text-emerald-950 cursor-pointer flex items-center justify-between transition-all active:scale-98 shadow-2xs select-none"
          >
            <div class="flex items-center gap-2 text-xs">
              <span class="text-sm">✨</span>
              <span>未找到该标签，点击立即创建并贴上：<strong class="font-bold underline text-emerald-900">#{{ tagsEngine.normalizeTagName(tagsEngine.tagPickerSearchQuery.value) }}</strong></span>
            </div>
            <span class="text-xs font-bold px-3 py-1 bg-emerald-600 text-white rounded-lg shadow-xs shrink-0">+ 新建</span>
          </div>

          <!-- 标签分类列表区 (舒适的分类标题间距与药丸尺寸) -->
          <div class="flex-1 stable-scroll flex flex-col gap-4 pr-1 overflow-y-auto pt-1">
            <div 
              v-for="[groupName, tagsInGroup] in tagsEngine.groupedTagsForPicker.value" 
              :key="groupName" 
              class="flex flex-col gap-2"
            >
              <!-- 分类标题 (带适度呼吸留白) -->
              <div class="text-[11.5px] font-bold text-slate-400 tracking-wider flex items-center gap-1.5 px-0.5">
                <span class="text-[11px] opacity-75">📁</span>
                <span>{{ groupName }}</span>
              </div>

              <!-- 标签按钮网格 (放宽间距，舒适比例) -->
              <div class="flex flex-wrap gap-2">
                <button 
                  v-for="t in tagsInGroup" 
                  :key="t.id"
                  type="button"
                  @click.stop="tagsEngine.handleSelectTagFromPicker(t.name)"
                  class="h-8 px-3.5 rounded-full border text-xs inline-flex items-center gap-2 cursor-pointer shadow-2xs select-none transition-colors duration-100 shrink-0"
                  :style="tagsEngine.isTagSelectedInPicker(t.name) 
                    ? { backgroundColor: tagsEngine.getTagColor(t.name).bg, borderColor: tagsEngine.getTagColor(t.name).border, color: tagsEngine.getTagColor(t.name).text, fontWeight: 600 } 
                    : { backgroundColor: '#F8FAFC', borderColor: 'rgba(15,23,42,0.12)', color: '#475569', fontWeight: 500 }"
                >
                  <span class="truncate max-w-[170px] pointer-events-none">{{ tagsEngine.formatHierarchyTagName(t.name) }}</span>
                  
                  <!-- 雅致的翡翠小圆对勾徽章 (未选中时定宽透明，尺寸 1px 不变，绝不跳动) -->
                  <span 
                    class="w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold transition-all duration-150 pointer-events-none"
                    :class="tagsEngine.isTagSelectedInPicker(t.name) ? 'bg-emerald-600 text-white shadow-2xs' : 'opacity-0 scale-75'"
                  >
                    ✓
                  </span>
                </button>
              </div>
            </div>
          </div>

          <!-- 底部关闭按钮 -->
          <div class="pt-3 flex justify-end border-t border-slate-100">
            <button 
              type="button"
              @click="tagsEngine.isTagPickerModalOpen.value = false; loadData();" 
              class="px-6 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-black text-white cursor-pointer shadow-sm transition active:scale-95"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 8. 诊断日志与偏好设置 Modal -->
    <Teleport to="body">
      <!-- 8.5 全量数据备份与资产中心 Modal -->
      <div 
        v-if="isBackupModalOpen"
        class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-xs animate-fade-in"
        @click.self="isBackupModalOpen = false"
      >
        <div class="w-full max-w-lg soft-modal p-6 sm:p-7 flex flex-col gap-5 max-h-[88vh] overflow-y-auto stable-scroll shadow-2xl animate-pop border border-emerald-950/[0.08] bg-white select-none">
          
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-sm">
                📦
              </div>
              <div>
                <h2 class="text-sm font-extrabold text-[#0F172A] tracking-tight">手记数据资产与备份中心</h2>
                <p class="text-[11px] text-slate-400 font-mono">
                  {{ lastBackupTime ? `上次备份：${lastBackupTime}` : '暂无备份记录，建议及时留存' }}
                </p>
              </div>
            </div>
            <button type="button" @click="isBackupModalOpen = false" class="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-sm text-slate-400 hover:text-slate-800 cursor-pointer transition">✕</button>
          </div>

          <!-- 状态指标卡 -->
          <div class="grid grid-cols-2 gap-3">
            <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-0.5">
              <span class="text-[10.5px] font-bold text-slate-400">已收录手记</span>
              <span class="text-xl font-extrabold text-slate-800 font-mono">{{ libraryTotalCount }} 篇</span>
            </div>
            <div class="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex flex-col gap-0.5">
              <span class="text-[10.5px] font-bold text-emerald-800">存储引擎状态</span>
              <span class="text-xs font-extrabold text-emerald-950 font-mono mt-1">SQLite WAL 极速引擎</span>
            </div>
          </div>

          <!-- 备份行动区 -->
          <div class="flex flex-col gap-2.5">
            <span class="text-xs font-bold text-slate-700">导出数据快照 (离线留存)</span>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button 
                type="button" 
                @click="handleTriggerJsonBackup"
                :disabled="isExporting"
                class="p-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-left transition cursor-pointer shadow-2xs group flex flex-col gap-1 active:scale-98"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-800 group-hover:text-emerald-950 flex items-center gap-1.5">
                    <span>📦</span><span>JSON 完整备份</span>
                  </span>
                  <span class="text-[10px] text-emerald-800 font-bold font-mono">推荐</span>
                </div>
                <span class="text-[10.5px] text-slate-500 leading-relaxed">包含所有原句、年轮与标签关系的完整结构化快照。</span>
              </button>

              <button 
                type="button" 
                @click="handleExportMarkdownVault"
                class="p-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-left transition cursor-pointer shadow-2xs group flex flex-col gap-1 active:scale-98"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-800 group-hover:text-emerald-950 flex items-center gap-1.5">
                    <span>📝</span><span>Markdown 知识库</span>
                  </span>
                  <span class="text-[10px] text-slate-400 font-mono">通用</span>
                </div>
                <span class="text-[10.5px] text-slate-500 leading-relaxed">带 YAML 头信息的纯文本文档，无缝导入 Obsidian / Logseq。</span>
              </button>

              <button 
                type="button" 
                @click="handleCreateDbSnapshot"
                :disabled="isCreatingSnapshot"
                class="p-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-left transition cursor-pointer shadow-2xs group flex flex-col gap-1 active:scale-98"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-800 group-hover:text-emerald-950 flex items-center gap-1.5">
                    <span>💾</span><span>SQLite 热快照</span>
                  </span>
                  <span class="text-[10px] text-slate-400 font-mono">底层</span>
                </div>
                <span class="text-[10.5px] text-slate-500 leading-relaxed">零停机在 backups 目录克隆完整原始数据库副本。</span>
              </button>

              <button 
                type="button" 
                @click="handleOpenDataFolder"
                class="p-3.5 rounded-2xl border border-slate-200 bg-white hover:bg-slate-100 text-left transition cursor-pointer shadow-2xs group flex flex-col gap-1 active:scale-98"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>📂</span><span>打开存储目录</span>
                  </span>
                  <span class="text-[10px] text-slate-400 font-mono">文件</span>
                </div>
                <span class="text-[10.5px] text-slate-500 leading-relaxed">直接查看 .db 文件与 images/ 截图附件存储文件夹。</span>
              </button>
            </div>
          </div>

          <!-- 恢复与导入区 -->
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs font-bold text-slate-800">从已有备份恢复</span>
              <span class="text-[11px] text-slate-500">导入此前导出的 JSON 备份文件，自动智能合并并增量去重。</span>
            </div>
            <button 
              type="button" 
              @click="triggerImportFile" 
              :disabled="isImporting"
              class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer transition active:scale-95 shadow-xs whitespace-nowrap"
            >
              <span>{{ isImporting ? '导入中...' : '导入备份' }}</span>
            </button>
          </div>

          <div class="pt-2 flex justify-end border-t border-slate-100">
            <button type="button" @click="isBackupModalOpen = false" class="px-6 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white cursor-pointer hover:bg-black transition active:scale-95 shadow-xs">完成</button>
          </div>

        </div>
      </div>

      <!-- 诊断日志 Modal -->
      <div 
        v-if="isLogModalOpen"
        class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 animate-fade-in"
        @click.self="isLogModalOpen = false"
      >
        <div class="w-full max-w-2xl soft-modal p-6 flex flex-col gap-3.5 max-h-[85vh] overflow-hidden shadow-2xl animate-pop">
          <div class="flex items-center justify-between pb-2 border-b border-slate-100">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 class="text-sm font-bold text-[#0F172A] font-mono">运行诊断终端</h2>
            </div>
            <div class="flex items-center gap-2">
              <button @click="clearLogs" class="text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer">清空</button>
              <button @click="isLogModalOpen = false" class="text-sm text-slate-400 hover:text-slate-800 cursor-pointer px-1">✕</button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto stable-scroll bg-slate-950 text-slate-200 font-mono text-xs p-4 rounded-2xl flex flex-col gap-1.5 select-text">
            <div v-if="logs.length === 0" class="text-slate-500 py-12 text-center">暂无诊断事件</div>
            <div v-for="log in logs" :key="log.id" class="leading-relaxed flex items-start gap-2">
              <span class="text-slate-500 shrink-0">{{ log.time }}</span>
              <span class="px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 uppercase" :class="log.level === 'error' ? 'bg-rose-900 text-rose-300' : 'bg-emerald-900 text-emerald-300'">{{ log.tag }}</span>
              <span class="break-all">{{ log.msg }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 手记偏好设置 Modal (UI规范统一 + 字体列表高度坍塌根治版) -->
      <div 
        v-if="isSettingsOpen"
        class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 animate-fade-in"
        @click.self="isSettingsOpen = false"
      >
        <div class="w-full max-w-md soft-modal p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto stable-scroll shadow-2xl animate-pop">
          <!-- 弹窗顶栏 -->
          <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <div class="flex items-center gap-2">
              <span class="text-base">⚙️</span>
              <h2 class="text-sm font-bold text-[#0F172A] tracking-tight">手记偏好设置</h2>
            </div>
            <button 
              type="button"
              @click="isSettingsOpen = false" 
              class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer text-xs"
            >
              ✕
            </button>
          </div>

          <!-- 本地系统字体配置 (shrink-0 h-8 彻底杜绝压扁) -->
          <div class="flex flex-col gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>🔤</span>
                <span>本地系统字体</span>
              </span>
              <button 
                type="button"
                @click="scanLocalFonts" 
                class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 hover:bg-emerald-50 text-emerald-800 transition active:scale-95 shadow-2xs cursor-pointer"
              >
                {{ isScanningFonts ? '扫描中...' : '重新扫描' }}
              </button>
            </div>

            <!-- 搜索框 -->
            <input 
              type="text" 
              v-model="fontSearchFilter" 
              placeholder="搜索字体名称..." 
              class="h-9 text-xs px-3.5 rounded-xl border border-slate-200 bg-white text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all" 
            />

            <!-- 字体滚动列表 -->
            <div class="max-h-48 overflow-y-auto stable-scroll rounded-xl border border-slate-200 bg-white p-1.5 flex flex-col gap-1">
              <div 
                @click="applyFontFamily('system-ui')" 
                class="shrink-0 h-8 px-3 rounded-lg text-xs cursor-pointer flex items-center justify-between transition-all"
                :class="currentFontFamily === 'system-ui' ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200/80 shadow-2xs' : 'text-slate-700 hover:bg-slate-50 border border-transparent'"
              >
                <span>默认系统字体 (system-ui)</span>
                <span v-if="currentFontFamily === 'system-ui'" class="text-emerald-600 font-bold text-xs">✓</span>
              </div>

              <div 
                v-for="f in filteredSystemFonts" 
                :key="f" 
                @click="applyFontFamily(f)" 
                class="shrink-0 h-8 px-3 rounded-lg text-xs cursor-pointer flex items-center justify-between transition-all"
                :class="currentFontFamily === f ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200/80 shadow-2xs' : 'text-slate-700 hover:bg-slate-50 border border-transparent'"
              >
                <span class="truncate">{{ f }}</span>
                <span v-if="currentFontFamily === f" class="text-emerald-600 font-bold text-xs">✓</span>
              </div>
            </div>
          </div>

          <!-- 资产与数据存储 (规范按钮阵列) -->
          <div class="flex flex-col gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>📦</span>
                <span>资产与数据存储</span>
              </span>
              <span class="text-[10px] text-slate-400 font-mono">本地无痕持久化</span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
              <button 
                type="button"
                @click="handleExportBackup" 
                :disabled="isExporting" 
                class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200/90 shadow-2xs hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-900 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                title="导出完整 JSON 结构化快照"
              >
                <span>📦</span><span>{{ isExporting ? '导出中...' : 'JSON备份' }}</span>
              </button>
              <button 
                type="button"
                @click="handleExportMarkdownVault" 
                class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-emerald-800 border border-emerald-300/80 shadow-2xs hover:bg-emerald-50 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1"
                title="导出标准 CommonMark + YAML Frontmatter 知识库文件"
              >
                <span>📝</span><span>MD知识库</span>
              </button>
              <button 
                type="button"
                @click="triggerImportFile" 
                :disabled="isImporting" 
                class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200/90 shadow-2xs hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-900 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <span>📥</span><span>{{ isImporting ? '导入中...' : '导入备份' }}</span>
              </button>
              <button 
                type="button"
                @click="handleCleanOrphanImages" 
                :disabled="isCleaningImages" 
                class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200/90 shadow-2xs hover:border-rose-300 hover:bg-rose-50/50 hover:text-rose-700 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <span>🧹</span><span>{{ isCleaningImages ? '清理中...' : '清理冗余' }}</span>
              </button>
            </div>
          </div>

          <!-- 防窥锁屏保护 -->
          <div class="flex flex-col gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>🛡️</span>
                <span>防窥锁屏保护 (PBKDF2)</span>
              </span>
              <span 
                class="text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold border transition-colors"
                :class="securityEngine.securityConfig.value.is_locked ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-200/70 text-slate-500 border-slate-300/50'"
              >
                {{ securityEngine.securityConfig.value.is_locked ? '已开启' : '未开启' }}
              </span>
            </div>
            
            <div v-if="!securityEngine.securityConfig.value.is_locked" class="flex flex-col gap-2 pt-0.5">
              <input 
                type="password" 
                v-model="securityEngine.newPasswordInput.value" 
                placeholder="设置新锁屏密码..." 
                class="h-9 text-xs px-3.5 rounded-xl border border-slate-200 bg-white text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all" 
              />
              <input 
                type="password" 
                v-model="securityEngine.confirmPasswordInput.value" 
                placeholder="确认新密码..." 
                class="h-9 text-xs px-3.5 rounded-xl border border-slate-200 bg-white text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all" 
              />
              <button 
                type="button"
                @click="securityEngine.handleSetPassword" 
                class="h-9 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
              >
                <span>🔒</span>
                <span>开启锁屏保护</span>
              </button>
            </div>

            <div v-else class="flex items-center justify-between pt-1">
              <button 
                type="button"
                @click="securityEngine.lockAppNow(); isSettingsOpen = false;" 
                class="h-8 px-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold shadow-2xs cursor-pointer active:scale-95 transition-all"
              >
                立即锁屏
              </button>
              <button 
                type="button"
                @click="securityEngine.handleDisablePassword" 
                class="text-xs text-rose-600 hover:text-rose-700 font-semibold hover:underline cursor-pointer px-1"
              >
                解除密码锁
              </button>
            </div>
          </div>

          <!-- 弹窗底栏 -->
          <div class="pt-3 flex items-center justify-between border-t border-slate-100">
            <span class="text-[11px] text-slate-400 font-mono">配置变更即刻生效</span>
            <button 
              type="button"
              @click="isSettingsOpen = false" 
              class="px-6 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-black text-white cursor-pointer shadow-sm active:scale-95 transition-all"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 9. 引用选择弹窗 -->
    <Teleport to="body">
      <div 
        v-if="isQuoteRefPickerOpen" 
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-xs animate-fade-in select-none"
        @click.self="isQuoteRefPickerOpen = false"
      >
        <div class="w-full max-w-xl bg-white rounded-[28px] border border-emerald-950/[0.08] shadow-2xl flex flex-col max-h-[82vh] overflow-hidden animate-pop">
          
          <!-- 1. 精致顶栏 -->
          <div class="shrink-0 px-6 pt-5 pb-3.5 flex items-center justify-between border-b border-slate-100">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center text-sm shadow-2xs">
                🔗
              </div>
              <div>
                <h2 class="text-sm font-extrabold text-[#0F172A] tracking-tight">引用既有客观摘录</h2>
                <p class="text-[10.5px] text-slate-400 font-mono">点击卡片即可在当前光标处嵌入双链知识胶囊</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60">
                {{ availableQuoteList.length }} 篇可选
              </span>
              <button 
                type="button" 
                @click="isQuoteRefPickerOpen = false" 
                class="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center text-xs transition cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- 2. 搜索框工具栏 (彻底解决穿模遮挡) -->
          <div class="shrink-0 px-6 pt-3.5 pb-2 bg-white">
            <div class="relative flex items-center">
              <span class="absolute left-3.5 text-xs text-slate-400 pointer-events-none">🔍</span>
              <input 
                type="text" 
                v-model="quoteRefSearchQuery" 
                placeholder="搜索摘录正文或文献出处..." 
                class="w-full text-xs pl-9 pr-8 py-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 text-[#0F172A] placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all shadow-inner" 
                autofocus
              />
              <button 
                v-if="quoteRefSearchQuery"
                type="button"
                @click="quoteRefSearchQuery = ''"
                class="absolute right-3 w-4 h-4 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-[10px] cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- 3. 卡片展示列表 (高对比、防溢出、微阴影、清洗 HTML) -->
          <div class="flex-1 min-h-0 stable-scroll overflow-y-auto px-6 py-2 flex flex-col gap-2.5">
            
            <!-- 空状态 -->
            <div v-if="availableQuoteList.length === 0" class="py-14 flex flex-col items-center justify-center text-slate-400 gap-1.5 select-none">
              <span class="text-2xl">🍃</span>
              <span class="text-xs font-semibold">未找到匹配的客观原句</span>
            </div>

            <!-- 卡片实体 -->
            <div 
              v-for="q in availableQuoteList" 
              :key="q.id" 
              @click="insertQuoteRefLink(q.id)" 
              class="p-4 rounded-2xl border border-slate-200/80 bg-white hover:bg-emerald-50/40 hover:border-emerald-300 hover:shadow-sm transition-all duration-150 cursor-pointer group flex flex-col gap-2.5 select-none active:scale-[0.99]"
            >
              <!-- 原句正文 (清洗 HTML，两行截断优雅呈现) -->
              <p class="text-xs leading-[1.8] text-slate-800 font-serif line-clamp-2">
                “{{ (q.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim() }}”
              </p>

              <!-- 底栏元数据与操作按钮 -->
              <div class="flex items-center justify-between pt-1 border-t border-slate-100/80 text-[11px]">
                <div class="flex items-center gap-1.5 text-slate-500 truncate max-w-[280px]">
                  <span class="text-[10px]">📖</span>
                  <span class="truncate font-semibold font-serif">
                    {{ q.source ? q.source : '独立摘录' }}
                  </span>
                </div>

                <!-- 胶囊操作按钮 -->
                <div class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-100 group-hover:bg-emerald-600 text-slate-600 group-hover:text-white font-bold text-[10.5px] transition-all duration-150 shadow-2xs">
                  <span>+ 嵌入引用</span>
                  <span class="text-[9px] opacity-75">↵</span>
                </div>
              </div>
            </div>

          </div>

          <!-- 4. 底栏关闭栏 -->
          <div class="shrink-0 px-6 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-xs text-slate-400">
            <span class="text-[11px] font-mono">按 Esc 键关闭窗口</span>
            <button 
              type="button"
              @click="isQuoteRefPickerOpen = false" 
              class="px-5 py-1.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer transition active:scale-95 shadow-xs"
            >
              关闭
            </button>
          </div>

        </div>
      </div>

      <div v-if="quoteLinksEngine.viewingQuoteRef.value" class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 animate-fade-in" @click.self="quoteLinksEngine.viewingQuoteRef.value = null">
        <div class="w-full max-w-lg soft-modal p-6 flex flex-col gap-4 shadow-2xl animate-pop">
          <div class="flex items-center justify-between pb-2 border-b border-slate-100">
            <span class="text-xs font-bold font-mono text-emerald-800">引用的客观原句</span>
            <button @click="quoteLinksEngine.viewingQuoteRef.value = null" class="text-sm text-slate-400 hover:text-slate-800">✕</button>
          </div>
          <div 
            class="rich-rendered text-sm leading-[28px] text-[#0F172A] font-serif max-h-60 overflow-y-auto stable-scroll" 
            v-html="richTextEngine.renderRichText(quoteLinksEngine.viewingQuoteRef.value.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently)"
          ></div>
          <div v-if="quoteLinksEngine.viewingQuoteRef.value.source" class="text-xs italic text-slate-500 font-serif border-t border-slate-100 pt-2">—— {{ quoteLinksEngine.viewingQuoteRef.value.source }}</div>
          <div class="pt-2 flex justify-end">
            <button @click="quoteLinksEngine.viewingQuoteRef.value = null" class="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white">关闭</button>
          </div>
        </div>
      </div>

      <!-- 专业图片高能交互灯箱 (支持滚轮缩放、硬件加速任意拖拽、旋转与复位) -->
      <ImageLightboxModal 
        v-if="richTextEngine.previewModalImage.value"
        :src="richTextEngine.previewModalImage.value"
        @close="richTextEngine.previewModalImage.value = null"
      />

      <!-- 连续引用链路悬浮跳回导航栏 -->
      <Transition name="desktop-hud">
        <div 
          v-if="quoteLinksEngine.activeNavBack.value"
          class="fixed bottom-10 inset-x-0 mx-auto w-fit z-[90] px-5 py-2.5 rounded-full shadow-2xl border border-emerald-300 bg-white text-emerald-950 text-xs font-semibold flex items-center gap-3 select-none animate-pop"
        >
          <span class="flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] shrink-0 font-mono font-bold">
              {{ quoteLinksEngine.navStack.value.length > 1 ? quoteLinksEngine.navStack.value.length : '📍' }}
            </span>
            <span class="text-slate-500 shrink-0">
              {{ quoteLinksEngine.navStack.value.length > 1 ? '连续引用链路，来自：' : '查阅引用，源自：' }}
            </span>
            <strong class="max-w-[170px] truncate text-emerald-950 font-bold">{{ quoteLinksEngine.activeNavBack.value.sourceTitle }}</strong>
          </span>

          <button @click="quoteLinksEngine.jumpBackToSource" class="px-4 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-xs transition active:scale-95 flex items-center gap-1">
            <span>↩</span><span>{{ quoteLinksEngine.navStack.value.length > 1 ? `上一步 (${quoteLinksEngine.navStack.value.length})` : '跳回' }}</span>
          </button>
          <button v-if="quoteLinksEngine.navStack.value.length > 1" @click="quoteLinksEngine.jumpBackToRoot" class="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer">
            <span>⏪ 起点</span>
          </button>
          <button @click="quoteLinksEngine.clearNavStack" class="text-slate-400 hover:text-slate-800 cursor-pointer text-xs ml-0.5 p-0.5">✕</button>
        </div>
      </Transition>
    </Teleport>

    
    <!-- 11. 灵感漫游与年轮闪回画布 Modal -->
    <Teleport to="body">
      <div 
        v-if="isResurfaceModalOpen && resurfaceData"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 animate-fade-in"
        @click.self="isResurfaceModalOpen = false"
      >
        <div class="w-full max-w-2xl soft-modal p-6 sm:p-8 flex flex-col gap-5 max-h-[88vh] overflow-y-auto stable-scroll shadow-2xl animate-pop border border-emerald-400/30 bg-[#F4F6F3]">
          
          <!-- 弹窗顶栏：闪回标签与时间胶囊 -->
          <div class="flex items-center justify-between pb-3 border-b border-emerald-950/[0.08]">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xs">
                <span>🧭</span>
                <span>{{ resurfaceData.reason_tag }}</span>
              </span>
              <span class="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                +{{ resurfaceData.days_ago }} 天时光沉淀
              </span>
            </div>

            <div class="flex items-center gap-2">
              <button 
                @click="openResurfaceModal"
                :disabled="isResurfaceLoading"
                class="px-3 py-1.5 rounded-full border border-emerald-950/[0.08] bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer transition shadow-2xs active:scale-95"
                title="换一条漫游"
              >
                <span>🎲</span><span>换一篇</span>
              </button>
              <button @click="isResurfaceModalOpen = false" class="text-slate-400 hover:text-slate-800 text-sm font-bold cursor-pointer px-1">✕</button>
            </div>
          </div>

          <!-- 引导发问横幅 (时光之问) -->
          <div class="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-amber-500/10 border border-emerald-500/20 flex items-start gap-3">
            <span class="text-xl shrink-0 select-none">💬</span>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm sm:text-[15px] font-extrabold text-emerald-950 leading-relaxed">
                {{ resurfaceData.prompt_title }}
              </h3>
              <p class="text-xs text-slate-500 mt-1">
                旧日所思如树木初芯，当下顿悟是新萌之轮。此刻回望，是否有了新的答案？
              </p>
            </div>
          </div>

          <!-- 原句/问题本体展示卡片 -->
          <div class="p-5 sm:p-6 rounded-3xl bg-white border border-emerald-950/[0.08] shadow-sm flex flex-col gap-3">
            <div class="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span class="w-2 h-2 rounded-full" :class="resurfaceData.card.is_question ? 'bg-amber-500' : 'bg-emerald-500'"></span>
              <span>{{ resurfaceData.card.is_question ? '待解之问' : '客观原句' }} · 收录于 {{ formatDate(resurfaceData.card.created_at) }}</span>
            </div>

            <div 
              class="rich-rendered text-base sm:text-[17px] leading-[1.8] text-[#0F172A] font-serif"
              v-html="richTextEngine.renderRichText(resurfaceData.card.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently)"
            ></div>

            <div v-if="resurfaceData.card.source" class="text-xs italic text-slate-500 font-serif border-t border-slate-100 pt-2.5">
              —— {{ resurfaceData.card.source }}
            </div>
          </div>

          <!-- 既有年轮简览 (如果已有思考) -->
          <div v-if="resurfaceData.card.thoughts.length > 0" class="flex flex-col gap-2">
            <span class="text-xs font-bold text-slate-500 flex items-center gap-1.5 px-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>过往已生长 {{ resurfaceData.card.thoughts.length }} 层年轮：</span>
            </span>
            <div class="flex flex-col gap-2 pl-3 border-l-2 border-emerald-200 my-1">
              <div 
                v-for="th in resurfaceData.card.thoughts" 
                :key="th.id"
                class="p-3 rounded-2xl bg-white/70 border border-slate-200/80 text-xs leading-relaxed text-slate-700"
              >
                <div class="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                  <span>{{ formatShortDate(th.created_at) }}</span>
                  <span class="text-emerald-800 font-sans font-semibold">{{ getRingTimeSpan(resurfaceData.card.created_at, th.created_at) }}</span>
                </div>
                <div class="rich-rendered text-xs" v-html="richTextEngine.renderRichText(th.content, quoteLinksEngine.quoteLookupMap.value, quotes, quoteLinksEngine.fetchAllQuotesSilently)"></div>
              </div>
            </div>
          </div>

          <!-- 当下体悟追加区 (续写年轮) -->
          <div class="p-4 rounded-3xl bg-white border border-emerald-950/[0.08] shadow-sm flex flex-col gap-2.5">
            <span class="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
              <span>🌱</span>
              <span>写下跨越时空的当下新认知：</span>
            </span>

            <div class="w-full">
              <TiptapEditor @quote-ref="openQuoteRefPicker" 
                v-model="resurfaceThoughtInput"
                min-height="80px"
                placeholder="时光流转，写下跨越时空的当下新认知..."
                content-class="font-sans text-xs sm:text-sm leading-relaxed"
              />
            </div>

            <div class="flex items-center justify-between pt-1">
              <span class="text-[10px] text-slate-400 font-mono">写入后将自动计算时光跨度增量</span>
              <button 
                @click="handleResurfaceAppendThought"
                :disabled="isResurfaceSubmitting || isContentEmpty(resurfaceThoughtInput)"
                class="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold disabled:opacity-30 cursor-pointer shadow-md shadow-emerald-500/20 transition active:scale-95"
              >
                {{ isResurfaceSubmitting ? '生长中...' : '萌发新芽 · 续写年轮' }}
              </button>
            </div>
          </div>

          <!-- 底部完成与跳转按钮 -->
          <div class="pt-2 flex items-center justify-between border-t border-emerald-950/[0.08]">
            <button 
              @click="handleResurfaceJumpToCard"
              class="text-xs px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <span>📜 在年轮主轴中定位此卡片 ➔</span>
            </button>
            <button @click="isResurfaceModalOpen = false" class="px-6 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white cursor-pointer shadow-sm hover:bg-black">
              完成漫游
            </button>
          </div>

        </div>
      </div>
    </Teleport>

    <!-- 10. 灵动 Toast 提示 -->
    <div 
      v-if="toastMessage"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-5 py-2 rounded-full shadow-xl border border-emerald-400/30 bg-slate-900 text-white text-xs font-bold flex items-center gap-2.5 animate-pop"
    >
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
      <span>{{ toastMessage }}</span>
      <button 
        v-if="hasUndoHistory"
        type="button"
        @click="executeUndo();"
        class="ml-1 px-2.5 py-0.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold cursor-pointer active:scale-95 transition"
      >
        撤销 ({{ undoStack.length }})
      </button>
    </div>
  </div>
</template>
