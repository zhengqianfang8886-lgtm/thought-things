<template>
  <div 
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-xs animate-fade-in select-none"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-4xl h-[82vh] max-h-[720px] bg-white rounded-[28px] border border-emerald-950/[0.08] shadow-2xl flex flex-col overflow-hidden animate-pop">
      
      <!-- 顶栏：标题、体检指示徽标与快速关闭 -->
      <header class="h-14 shrink-0 px-6 border-b border-slate-100 flex items-center justify-between bg-white">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-sm">
            🏷️
          </div>
          <div>
            <h2 class="text-sm font-extrabold text-[#0F172A] tracking-tight">标签脉络与知识花园</h2>
            <p class="text-[10px] text-slate-400 font-mono">共 {{ tagStats.length }} 个脉络节点 · 覆盖 {{ totalQuoteRelations }} 条手记关联</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span 
            v-if="emptyTagsCount > 0" 
            class="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium"
          >
            发现 {{ emptyTagsCount }} 个闲置标签
          </span>
          <button 
            type="button"
            @click="emit('close')" 
            class="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer text-xs"
          >
            ✕
          </button>
        </div>
      </header>

      <!-- 双栏主体架构 -->
      <div class="flex-1 min-h-0 flex overflow-hidden">
        
        <!-- 左栏：结构树与检索过滤 (40% 宽) -->
        <section class="w-5/12 border-r border-slate-100 flex flex-col bg-slate-50/50 p-4 gap-3">
          
          <!-- 检索与新建工具条 -->
          <div class="flex flex-col gap-2">
            <div class="relative flex items-center">
              <span class="absolute left-3 text-xs text-slate-400">🔍</span>
              <input 
                type="text" 
                v-model="searchQuery" 
                placeholder="过滤标签分类或路径..." 
                class="w-full text-xs pl-8 pr-7 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all"
              />
              <button 
                v-if="searchQuery" 
                @click="searchQuery = ''" 
                class="absolute right-2.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >✕</button>
            </div>

            <!-- 三态查看视角 -->
            <div class="grid grid-cols-3 p-1 rounded-xl bg-slate-200/60 text-[11px] font-bold">
              <button 
                type="button" 
                @click="viewMode = 'tree'" 
                class="py-1 rounded-lg transition cursor-pointer text-center"
                :class="viewMode === 'tree' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500'"
              >
                🌲 层级树
              </button>
              <button 
                type="button" 
                @click="viewMode = 'flat'" 
                class="py-1 rounded-lg transition cursor-pointer text-center"
                :class="viewMode === 'flat' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500'"
              >
                🔥 热度榜
              </button>
              <button 
                type="button" 
                @click="viewMode = 'idle'" 
                class="py-1 rounded-lg transition cursor-pointer text-center flex items-center justify-center gap-1"
                :class="viewMode === 'idle' ? 'bg-white text-amber-900 shadow-2xs' : 'text-slate-500'"
              >
                <span>🧹 待整理</span>
                <span v-if="emptyTagsCount > 0" class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              </button>
            </div>
          </div>

          <!-- 新建标签行 -->
          <div class="flex items-center gap-1.5">
            <input 
              ref="newTagInputRef"
              type="text" 
              v-model="newTagName" 
              @keydown.enter="handleCreateTag"
              placeholder="+ 新建标签 (支持 父/子 格式)..." 
              class="flex-1 text-xs px-3 py-1.5 rounded-xl border border-slate-200 bg-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
            />
            <button 
              type="button" 
              @click="handleCreateTag" 
              :disabled="!newTagName.trim()"
              class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition shadow-2xs active:scale-95"
            >
              添加
            </button>
          </div>

          <!-- 标签流列表 -->
          <div class="flex-1 min-h-0 stable-scroll overflow-y-auto pr-1 flex flex-col gap-1 select-none">
            
            <!-- 空状态 -->
            <div v-if="displayTagList.length === 0" class="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-1">
              <span>🍃</span>
              <span>暂无匹配的标签</span>
            </div>

            <!-- 层级树模式渲染 -->
            <template v-if="viewMode === 'tree'">
              <div 
                v-for="row in flattenedTree" 
                :key="row.fullPath"
                @click="selectedTag = row.fullPath"
                class="group relative flex items-center justify-between py-1.5 pr-2 rounded-xl cursor-pointer transition-all duration-100"
                :class="selectedTag === row.fullPath ? 'bg-emerald-100/70 text-emerald-950 font-bold shadow-2xs' : 'hover:bg-white text-slate-700'"
                :style="{ paddingLeft: `${Math.max(8, row.depth * 14 + 8)}px` }"
              >
                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                  <button 
                    v-if="row.hasChildren"
                    type="button"
                    @click.stop="toggleNodeExpand(row.fullPath)"
                    class="w-4 h-4 shrink-0 flex items-center justify-center rounded hover:bg-black/10 text-[9px] text-slate-500"
                  >
                    {{ isNodeExpanded(row.fullPath) ? '▾' : '▸' }}
                  </button>
                  <span 
                    v-else 
                    class="w-2 h-2 shrink-0 rounded-full mx-1"
                    :style="{ backgroundColor: getTagDotColor(row.name) }"
                  ></span>

                  <span class="truncate text-xs tracking-tight">{{ row.name }}</span>
                  <button
                    type="button"
                    @click.stop="quickAddSubtag(row.fullPath)"
                    title="添加子标签"
                    class="opacity-0 group-hover:opacity-100 shrink-0 w-4 h-4 flex items-center justify-center rounded-full hover:bg-emerald-200/70 text-emerald-800 text-xs font-bold transition-opacity cursor-pointer"
                  >+</button>
                </div>

                <span class="font-mono text-[10.5px] opacity-60 ml-1 shrink-0">{{ row.totalCount }}</span>
              </div>
            </template>

            <!-- 平铺 / 闲置模式渲染 -->
            <template v-else>
              <div 
                v-for="item in displayTagList" 
                :key="item.name"
                @click="selectedTag = item.name"
                class="flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all text-xs"
                :class="selectedTag === item.name ? 'bg-emerald-100/70 text-emerald-950 font-bold shadow-2xs' : 'hover:bg-white text-slate-700'"
              >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: getTagDotColor(item.name) }"></span>
                  <span class="truncate font-mono">#{{ formatHierarchyName(item.name) }}</span>
                </div>
                <span class="font-mono text-[11px] opacity-60">{{ item.count }} 篇</span>
              </div>
            </template>
          </div>
        </section>

        <!-- 右栏：全息脉络操作台 (Inspector, 60% 宽) -->
        <main class="w-7/12 flex flex-col p-6 overflow-y-auto stable-scroll bg-white">
          
          <!-- 状态 A：已选择具体标签，显示工作台 -->
          <div v-if="activeTagStat" class="flex flex-col gap-5 animate-fade-in">
            
            <!-- 标签核心头部 -->
            <div class="flex items-start justify-between pb-4 border-b border-slate-100">
              <div class="flex flex-col gap-1.5 flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: getTagDotColor(activeTagStat.name) }"></span>
                  <span class="text-base font-extrabold text-[#0F172A] font-mono truncate">
                    #{{ activeTagStat.name }}
                  </span>
                  <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold font-mono">
                    {{ activeTagStat.count }} 篇手记引用
                  </span>
                </div>

                <!-- 层级重构面包屑 -->
                <div class="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                  <span class="text-slate-400">层级路径:</span>
                  <span 
                    v-for="(seg, idx) in tagPathSegments" 
                    :key="idx" 
                    class="inline-flex items-center gap-1"
                  >
                    <span class="px-2 py-0.5 rounded-md bg-slate-100 font-mono text-slate-700 font-semibold">{{ seg }}</span>
                    <span v-if="idx < tagPathSegments.length - 1" class="text-slate-300">/</span>
                  </span>
                </div>
              </div>

              <!-- 注销当前标签按钮 -->
              <button 
                type="button" 
                @click="handleDeleteActiveTag"
                class="px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition flex items-center gap-1"
                :class="isConfirmingDelete ? 'bg-rose-600 text-white border-rose-600 font-bold' : 'border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50'"
              >
                <span>🗑️</span>
                <span>{{ isConfirmingDelete ? '确定注销?' : '注销标签' }}</span>
              </button>
            </div>

            <!-- 操作卡片 1: 原位快速改名 / 调序 -->
            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-2.5">
              <div class="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>✏️ 重命名或移动层级</span>
                <span class="text-[10px] text-slate-400">修改斜杠即可变更挂载父级</span>
              </div>
              <div class="flex items-center gap-2">
                <input 
                  type="text" 
                  v-model="editTagNameInput" 
                  class="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20"
                />
                <button 
                  type="button" 
                  @click="handleSaveRename"
                  :disabled="!editTagNameInput.trim() || editTagNameInput.trim() === activeTagStat.name"
                  class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition shadow-2xs active:scale-95"
                >
                  保存
                </button>
              </div>
            </div>

            <!-- 操作卡片 2: 磁吸式快捷合并 (无需手打目标标签) -->
            <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-3">
              <div class="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>🔀 磁吸合并到其他标签</span>
                <span class="text-[10px] text-slate-400">手记将无缝转移，源标签自动注销</span>
              </div>

              <!-- 智能候选胶囊 -->
              <div v-if="suggestedMergeTargets.length > 0" class="flex flex-col gap-1.5">
                <span class="text-[11px] text-slate-400">根据语义推荐合并目标 (点击即选):</span>
                <div class="flex flex-wrap gap-1.5">
                  <button 
                    v-for="cand in suggestedMergeTargets" 
                    :key="cand.id"
                    type="button"
                    @click="mergeTargetInput = cand.name"
                    class="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-900 font-mono transition cursor-pointer"
                  >
                    #{{ cand.name }}
                  </button>
                </div>
              </div>

              <div class="flex items-center gap-2 pt-1">
                <input 
                  type="text" 
                  v-model="mergeTargetInput" 
                  placeholder="输入或选择目标标签名..."
                  class="flex-1 text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-400/20"
                />
                <button 
                  type="button" 
                  @click="handleExecuteMerge"
                  :disabled="!mergeTargetInput.trim() || mergeTargetInput.trim() === activeTagStat.name"
                  class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition shadow-2xs active:scale-95"
                >
                  执行合并 ➔
                </button>
              </div>
            </div>

            <!-- 操作卡片 3: 关联手记微缩视窗 (快速验证知识内容) -->
            <div class="flex flex-col gap-2 pt-1">
              <div class="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>📖 贴有此标签的手记示例 (前 3 篇)</span>
                <button @click="emit('filter-tag', activeTagStat.name)" class="text-xs text-emerald-700 hover:underline cursor-pointer">
                  在主视图查看全部 ➔
                </button>
              </div>

              <div v-if="relatedQuotesPreview.length === 0" class="p-4 rounded-xl bg-slate-50 text-slate-400 text-xs text-center">
                暂无关联手记
              </div>

              <div v-else class="flex flex-col gap-2">
                <div 
                  v-for="q in relatedQuotesPreview" 
                  :key="q.id"
                  class="p-3 rounded-xl border border-slate-200/70 bg-white text-xs text-slate-700 line-clamp-2 leading-relaxed font-serif"
                >
                  “{{ q.content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim() }}”
                </div>
              </div>
            </div>

          </div>

          <!-- 状态 B：未选择具体标签时，显示全库健康度体检仪表盘 -->
          <div v-else class="flex flex-col gap-6 py-6 animate-fade-in text-slate-700">
            <div class="flex flex-col gap-1">
              <h3 class="text-base font-extrabold text-slate-900">知识脉络健康度中心</h3>
              <p class="text-xs text-slate-500">定期修剪与合并标签，能让思维年轮在漫长岁月中历久弥新。</p>
            </div>

            <!-- 指标三宫格 -->
            <div class="grid grid-cols-3 gap-3">
              <div class="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex flex-col gap-1">
                <span class="text-[11px] text-emerald-800 font-bold">总标签数</span>
                <span class="text-2xl font-extrabold text-emerald-950 font-mono">{{ tagStats.length }}</span>
              </div>
              <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col gap-1">
                <span class="text-[11px] text-slate-500 font-bold">活跃引用</span>
                <span class="text-2xl font-extrabold text-slate-900 font-mono">{{ activeTagsCount }}</span>
              </div>
              <div class="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex flex-col gap-1">
                <span class="text-[11px] text-amber-800 font-bold">闲置孤立 (0篇)</span>
                <span class="text-2xl font-extrabold text-amber-950 font-mono">{{ emptyTagsCount }}</span>
              </div>
            </div>

            <!-- 快速清理闲置行动项 -->
            <div class="p-5 rounded-2xl border border-slate-200/90 bg-slate-50/60 flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-bold text-slate-800">一键清理闲置空标签</span>
                <span class="text-[11px] text-slate-500">注销所有未挂载任何手记的空标签，不会影响任何手记内容。</span>
              </div>
              <button 
                type="button" 
                @click="handlePruneAllEmpty"
                :disabled="emptyTagsCount === 0"
                class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-white text-xs font-bold cursor-pointer transition shadow-2xs active:scale-95 whitespace-nowrap"
              >
                清理 {{ emptyTagsCount }} 个闲置
              </button>
            </div>

            <div class="text-xs text-slate-400 text-center py-4">
              👈 在左侧选择任意标签，可对其进行原位重构、合并与手记溯源
            </div>
          </div>

        </main>
      </div>

      <!-- 底栏动作完成 -->
      <footer class="h-12 shrink-0 px-6 border-t border-slate-100 flex items-center justify-end bg-slate-50/80">
        <button 
          type="button" 
          @click="emit('close')" 
          class="px-6 py-1.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer transition active:scale-95 shadow-xs"
        >
          完成
        </button>
      </footer>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import type { TagStat, FlatTagRow, QuoteDetail } from '../../types';

const props = defineProps<{
  tagStats: TagStat[];
  quotes: QuoteDetail[];
  emptyTagsCount: number;
  getTagDotColor: (name: string) => string;
  formatHierarchyName: (name: string) => string;
  initialParent?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'create-tag', name: string): void;
  (e: 'rename-tag', oldName: string, newName: string): void;
  (e: 'merge-tag', sourceTag: string, targetTag: string): void;
  (e: 'delete-tag', tagName: string): void;
  (e: 'prune-empty'): void;
  (e: 'filter-tag', tagName: string): void;
}>();

const searchQuery = ref('');
const viewMode = ref<'tree' | 'flat' | 'idle'>('tree');
const selectedTag = ref<string | null>(null);
const newTagName = ref('');
const newTagInputRef = ref<HTMLInputElement | null>(null);

// 快捷创建子标签：预填父级路径并聚焦输入框，无需手动输入完整层级路径
const quickAddSubtag = (parentPath: string) => {
  viewMode.value = 'tree';
  newTagName.value = `${parentPath}/`;
  nextTick(() => newTagInputRef.value?.focus());
};

onMounted(() => {
  if (props.initialParent) {
    quickAddSubtag(props.initialParent);
  }
});

const editTagNameInput = ref('');
const mergeTargetInput = ref('');
const isConfirmingDelete = ref(false);
let deleteTimer: any = null;

// 本地自闭环层级树计算：默认展开、独立折叠、支持实时搜索高亮穿透
const expandedNodes = ref<Record<string, boolean>>({});

const isNodeExpanded = (fullPath: string) => {
  if (expandedNodes.value[fullPath] !== undefined) {
    return expandedNodes.value[fullPath];
  }
  return true; // 默认全部展开子标签
};

const toggleNodeExpand = (fullPath: string) => {
  const current = isNodeExpanded(fullPath);
  expandedNodes.value = {
    ...expandedNodes.value,
    [fullPath]: !current
  };
};

interface TagInternalNode {
  name: string;
  fullPath: string;
  count: number;
  totalCount: number;
  children: Map<string, TagInternalNode>;
}

const flattenedTree = computed<FlatTagRow[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const root: TagInternalNode = { name: "root", fullPath: "", count: 0, totalCount: 0, children: new Map() };

  props.tagStats.forEach((stat) => {
    const parts = stat.name.replace(/^#+/, "").replace(/／/g, "/").split("/").map(s => s.trim()).filter(Boolean);
    let current = root;
    let accumulated = "";
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: accumulated,
          count: 0,
          totalCount: 0,
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
      if (index === parts.length - 1) current.count += stat.count;
    });
  });

  const calcTotal = (node: TagInternalNode): number => {
    let sum = node.count;
    for (const child of node.children.values()) sum += calcTotal(child);
    node.totalCount = sum;
    return sum;
  };
  for (const node of root.children.values()) calcTotal(node);

  const matchedPaths = new Set<string>();
  const visibleBranchPaths = new Set<string>();

  if (q) {
    const findMatches = (node: TagInternalNode): boolean => {
      const matchSelf = node.name.toLowerCase().includes(q) || node.fullPath.toLowerCase().includes(q);
      let matchChild = false;
      for (const child of node.children.values()) {
        if (findMatches(child)) matchChild = true;
      }
      if (matchSelf) matchedPaths.add(node.fullPath);
      if (matchSelf || matchChild) {
        visibleBranchPaths.add(node.fullPath);
        return true;
      }
      return false;
    };
    for (const node of root.children.values()) findMatches(node);
  }

  const rows: FlatTagRow[] = [];
  const traverse = (node: TagInternalNode, depth: number) => {
    const childrenList = Array.from(node.children.values());
    childrenList.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name, "zh-CN"));

    for (const child of childrenList) {
      if (q && !visibleBranchPaths.has(child.fullPath)) continue;

      const hasChildren = child.children.size > 0;
      const expanded = q ? (visibleBranchPaths.has(child.fullPath) && hasChildren) : isNodeExpanded(child.fullPath);

      rows.push({
        name: child.name,
        fullPath: child.fullPath,
        depth,
        count: child.count,
        totalCount: child.totalCount,
        hasChildren,
        isExpanded: expanded,
        isMatched: q ? matchedPaths.has(child.fullPath) : false,
      });

      if (hasChildren && expanded) {
        traverse(child, depth + 1);
      }
    }
  };

  traverse(root, 0);
  return rows;
});

const activeTagStat = computed(() => {
  if (!selectedTag.value) return null;
  return props.tagStats.find(t => t.name === selectedTag.value) || null;
});

watch(activeTagStat, (stat) => {
  if (stat) {
    editTagNameInput.value = stat.name;
    mergeTargetInput.value = '';
    isConfirmingDelete.value = false;
  }
});

const tagPathSegments = computed(() => {
  if (!activeTagStat.value) return [];
  return activeTagStat.value.name.split('/');
});

const totalQuoteRelations = computed(() => {
  return props.tagStats.reduce((sum, item) => sum + item.count, 0);
});

const activeTagsCount = computed(() => {
  return props.tagStats.filter(t => t.count > 0).length;
});

const displayTagList = computed(() => {
  let list = props.tagStats;
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(t => t.name.toLowerCase().includes(q));
  }
  if (viewMode.value === 'idle') {
    return list.filter(t => t.count === 0);
  }
  if (viewMode.value === 'flat') {
    return [...list].sort((a, b) => b.count - a.count);
  }
  return list;
});

// 智能近义与合并候选推荐（基于字符交集与前缀）
const suggestedMergeTargets = computed(() => {
  if (!activeTagStat.value) return [];
  const current = activeTagStat.value.name.toLowerCase();
  return props.tagStats
    .filter(t => t.name !== activeTagStat.value!.name)
    .filter(t => {
      const other = t.name.toLowerCase();
      return other.includes(current) || current.includes(other) || other.split('/')[0] === current.split('/')[0];
    })
    .slice(0, 4);
});

// 当前标签所关联的前 3 条手记微缩预览
const relatedQuotesPreview = computed(() => {
  if (!activeTagStat.value) return [];
  const target = activeTagStat.value.name;
  return props.quotes
    .filter(q => (q.tags || []).some(t => t.replace(/^#+/, '') === target))
    .slice(0, 3);
});

const handleCreateTag = () => {
  if (!newTagName.value.trim()) return;
  emit('create-tag', newTagName.value.trim());
  selectedTag.value = newTagName.value.trim();
  newTagName.value = '';
};

const handleSaveRename = () => {
  if (!activeTagStat.value || !editTagNameInput.value.trim()) return;
  emit('rename-tag', activeTagStat.value.name, editTagNameInput.value.trim());
  selectedTag.value = editTagNameInput.value.trim();
};

const handleExecuteMerge = () => {
  if (!activeTagStat.value || !mergeTargetInput.value.trim()) return;
  emit('merge-tag', activeTagStat.value.name, mergeTargetInput.value.trim());
  selectedTag.value = mergeTargetInput.value.trim();
  mergeTargetInput.value = '';
};

const handleDeleteActiveTag = () => {
  if (!activeTagStat.value) return;
  const name = activeTagStat.value.name;
  if (isConfirmingDelete.value) {
    if (deleteTimer) clearTimeout(deleteTimer);
    isConfirmingDelete.value = false;
    emit('delete-tag', name);
    selectedTag.value = null;
  } else {
    isConfirmingDelete.value = true;
    deleteTimer = setTimeout(() => {
      isConfirmingDelete.value = false;
    }, 3000);
  }
};

const handlePruneAllEmpty = () => {
  emit('prune-empty');
  if (activeTagStat.value && activeTagStat.value.count === 0) {
    selectedTag.value = null;
  }
};
</script>
