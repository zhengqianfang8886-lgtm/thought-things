import { ref, computed, type Ref } from "vue";
import { invoke } from "../ipc-bridge";
import type { TagStat, TagNode, TagColorStyle, QuoteDetail, FlatTagRow } from "../types";

export function useTags(
  quotes: Ref<QuoteDetail[]>,
  loadData: () => Promise<void>,
  showToast: (msg: string) => void
) {
  const tagStats = ref<TagStat[]>([]);
  const selectedTag = ref<string | null>(null);
  const tagColorCache = new Map<string, TagColorStyle>();

  const isTagManagerOpen = ref(false);
  const tagManagerSearchQuery = ref("");
  const newTagInput = ref("");
  const renamingTagOld = ref<string | null>(null);
  const renamingTagNew = ref("");
  const pendingDeleteTagName = ref<string | null>(null);
  let deleteTagTimer: number | null = null;
  const expandedTagNodes = ref<Record<string, boolean>>({});

  const isTagPickerModalOpen = ref(false);
  const tagPickerSearchQuery = ref("");
  const targetQuoteIdForPicker = ref<string | null>(null);

  const attachedTags = ref<string[]>([]);
  const tagInputText = ref("");

  const normalizeTagName = (raw: string): string => {
    return raw
      .replace(/^#+/, "")
      .replace(/／/g, "/")
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("/");
  };

  const formatHierarchyTagName = (name: string): string => {
    return normalizeTagName(name).split("/").join(" / ");
  };

  const getTagColor = (tagName: string): TagColorStyle => {
    const clean = normalizeTagName(tagName);
    if (!clean) return { bg: "#F3F4F6", text: "#4B5563", border: "#E5E7EB", dot: "#9CA3AF" };
    if (tagColorCache.has(clean)) return tagColorCache.get(clean)!;

    let hash = 2166136261;
    for (let i = 0; i < clean.length; i++) {
      hash ^= clean.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const goldenAngle = 137.50776405003785;
    const hue = Math.abs(Math.round((Math.abs(hash) * goldenAngle) % 360));
    const color: TagColorStyle = {
      bg: `hsl(${hue}, 80%, 96%)`,
      border: `hsl(${hue}, 55%, 82%)`,
      text: `hsl(${hue}, 85%, 24%)`,
      dot: `hsl(${hue}, 85%, 48%)`,
    };
    tagColorCache.set(clean, color);
    return color;
  };

  const toggleAttachTag = (rawName: string) => {
    const clean = normalizeTagName(rawName);
    if (!clean) return;
    const idx = attachedTags.value.indexOf(clean);
    if (idx >= 0) attachedTags.value.splice(idx, 1);
    else attachedTags.value.push(clean);
  };

  const pushTag = (rawName: string) => {
    const clean = normalizeTagName(rawName);
    if (clean && !attachedTags.value.includes(clean)) attachedTags.value.push(clean);
    tagInputText.value = "";
  };

  const handleTagInputKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      pushTag(tagInputText.value);
    } else if (e.key === " " && !tagInputText.value.endsWith(" ")) {
      e.preventDefault();
      pushTag(tagInputText.value);
    } else if (e.key === "Backspace" && !tagInputText.value && attachedTags.value.length > 0) {
      attachedTags.value.pop();
    }
  };

  const removeAttachedTag = (index: number) => {
    attachedTags.value.splice(index, 1);
  };

  const frequentTags = computed(() => tagStats.value.slice(0, 6).map((t) => t.name));

  const tagTreeSearchQuery = ref("");
  const tagTreeSortBy = ref<"count" | "name">("count");
  const selectedRootDomain = ref<string | null>(null);

  // 1. 自动提取所有顶级根分类（Root Domains），附带该分类下的总数
  const rootTagDomains = computed(() => {
    const map = new Map<string, number>();
    tagStats.value.forEach((stat) => {
      const parts = normalizeTagName(stat.name).split("/");
      if (parts.length > 1) {
        const root = parts[0];
        map.set(root, (map.get(root) || 0) + stat.count);
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  });

  const toggleRootDomain = (domain: string) => {
    if (selectedRootDomain.value === domain) {
      selectedRootDomain.value = null;
    } else {
      selectedRootDomain.value = domain;
    }
  };

  // 2. 录入端打字即时下拉联想（前缀/包含模糊匹配）
  const tagSuggestions = computed(() => {
    const raw = tagInputText.value.trim().toLowerCase();
    if (!raw) return [];
    const clean = normalizeTagName(raw).toLowerCase();
    return tagStats.value
      .filter((t) => {
        const nameLower = t.name.toLowerCase();
        return nameLower.includes(clean) && !attachedTags.value.map(normalizeTagName).includes(t.name);
      })
      .slice(0, 6);
  });

  const isTagNodeExpanded = (fullPath: string): boolean => {
    if (expandedTagNodes.value[fullPath] !== undefined) {
      return expandedTagNodes.value[fullPath];
    }
    // 优化：默认展开所有层级节点，让子标签一目了然
    return true;
  };

  const toggleTagNodeExpand = (fullPath: string) => {
    expandedTagNodes.value[fullPath] = !isTagNodeExpanded(fullPath);
  };

  const expandAllTagNodes = () => {
    const all: Record<string, boolean> = {};
    tagStats.value.forEach((stat) => {
      const parts = normalizeTagName(stat.name).split("/").filter(Boolean);
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        all[acc] = true;
      }
    });
    expandedTagNodes.value = all;
  };

  const collapseAllTagNodes = () => {
    const all: Record<string, boolean> = {};
    tagStats.value.forEach((stat) => {
      const parts = normalizeTagName(stat.name).split("/").filter(Boolean);
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        all[acc] = false;
      }
    });
    expandedTagNodes.value = all;
  };

  // 高性能一维流式投影树：支持无限深度与搜索透视
  const flattenedTagTree = computed<FlatTagRow[]>(() => {
    const q = tagTreeSearchQuery.value.trim().toLowerCase();
    const sortBy = tagTreeSortBy.value;

    interface InternalNode {
      name: string;
      fullPath: string;
      count: number;
      totalCount: number;
      children: Map<string, InternalNode>;
    }

    const root: InternalNode = { name: "root", fullPath: "", count: 0, totalCount: 0, children: new Map() };
    tagStats.value.forEach((stat) => {
      const parts = normalizeTagName(stat.name).split("/").filter(Boolean);
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

    const calcTotal = (node: InternalNode): number => {
      let sum = node.count;
      for (const child of node.children.values()) sum += calcTotal(child);
      node.totalCount = sum;
      return sum;
    };
    for (const node of root.children.values()) calcTotal(node);

    // 搜索唤醒与路径保留
    const matchedPaths = new Set<string>();
    const visibleBranchPaths = new Set<string>();

    if (q) {
      const findMatches = (node: InternalNode): boolean => {
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
    const traverse = (node: InternalNode, depth: number) => {
      // 根域收敛过滤：若选中了根领域，第 0 层仅遍历该领域分支
      if (depth === 0 && selectedRootDomain.value && node.name === "root") {
        const targetChild = node.children.get(selectedRootDomain.value);
        if (targetChild) {
          const hasChildren = targetChild.children.size > 0;
          rows.push({
            name: targetChild.name,
            fullPath: targetChild.fullPath,
            depth: 0,
            count: targetChild.count,
            totalCount: targetChild.totalCount,
            hasChildren,
            isExpanded: true,
            isMatched: false,
          });
          if (hasChildren) traverse(targetChild, 1);
        }
        return;
      }
      const childrenList = Array.from(node.children.values());
      if (sortBy === "count") {
        childrenList.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name, "zh-CN"));
      } else {
        childrenList.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      }

      for (const child of childrenList) {
        if (q && !visibleBranchPaths.has(child.fullPath)) continue;

        const hasChildren = child.children.size > 0;
        const expanded = q ? (visibleBranchPaths.has(child.fullPath) && hasChildren) : isTagNodeExpanded(child.fullPath);

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

  const filteredTagsForManager = computed(() => {
    const q = tagManagerSearchQuery.value.trim().toLowerCase();
    if (!q) return tagStats.value;
    return tagStats.value.filter((t) => t.name.toLowerCase().includes(q));
  });

  const handleCreateTagFromManager = async (nameOverride?: string) => {
    const clean = normalizeTagName(nameOverride !== undefined ? nameOverride : newTagInput.value);
    if (!clean) return;
    try {
      await invoke("add_tag_to_quote", { quoteId: "", tagName: clean }).catch(() => {});
      newTagInput.value = "";
      await loadData();
      showToast(`✓ 已创建标签: ${clean}`);
    } catch {
      await loadData();
    }
  };

  const startCreateSubtag = (parentPath: string) => {
    newTagInput.value = `${normalizeTagName(parentPath)}/`;
    const el = document.getElementById("managerNewTagInput");
    el?.focus();
  };

  const mergingSourceTag = ref<string | null>(null);
  const mergingTargetTag = ref("");

  const startMergeTag = (name: string) => {
    mergingSourceTag.value = name;
    mergingTargetTag.value = "";
    renamingTagOld.value = null;
  };

  const cancelMergeTag = () => {
    mergingSourceTag.value = null;
    mergingTargetTag.value = "";
  };

  const executeMergeTag = async () => {
    if (!mergingSourceTag.value || !mergingTargetTag.value.trim()) return;
    const src = normalizeTagName(mergingSourceTag.value);
    const tgt = normalizeTagName(mergingTargetTag.value);
    if (src === tgt) {
      showToast("源标签与目标标签相同");
      return;
    }

    try {
      const res = await invoke<{ affected_count: number }>("merge_tags", {
        sourceTag: src,
        targetTag: tgt,
      });

      if (selectedTag.value === src) selectedTag.value = tgt;
      cancelMergeTag();
      await loadData();
      showToast(`✓ 已将 ${res.affected_count} 篇手记合并至 #${formatHierarchyTagName(tgt)}`);
    } catch (err: any) {
      showToast("合并失败: " + (err?.message || err));
    }
  };

  const pruneEmptyTags = async () => {
    try {
      const res = await invoke<{ deleted_count: number }>("prune_empty_tags");
      await loadData();
      if (res.deleted_count > 0) {
        showToast(`✓ 已清理 ${res.deleted_count} 个闲置标签`);
      } else {
        showToast("暂无闲置空标签");
      }
    } catch (err: any) {
      showToast("清理失败: " + (err?.message || err));
    }
  };

  const emptyTagsCount = computed(() => {
    return tagStats.value.filter((t) => t.count === 0).length;
  });

  const startRenameTag = (name: string) => {
    renamingTagOld.value = name;
    renamingTagNew.value = name;
    mergingSourceTag.value = null;
  };

  const saveRenameTag = async () => {
    if (
      !renamingTagOld.value ||
      !renamingTagNew.value.trim() ||
      renamingTagOld.value === renamingTagNew.value.trim()
    ) {
      renamingTagOld.value = null;
      return;
    }
    try {
      const cleanNew = normalizeTagName(renamingTagNew.value);
      await invoke("rename_tag", { oldName: renamingTagOld.value.trim(), newName: cleanNew });
      if (selectedTag.value === renamingTagOld.value) selectedTag.value = cleanNew;
      renamingTagOld.value = null;
      await loadData();
      showToast("✓ 标签已重命名");
    } catch {
      showToast("重命名失败");
    }
  };

  const confirmOrDeleteTag = (tagName: string) => {
    if (pendingDeleteTagName.value === tagName) {
      if (deleteTagTimer) clearTimeout(deleteTagTimer);
      pendingDeleteTagName.value = null;
      handleDeleteTag(tagName);
    } else {
      pendingDeleteTagName.value = tagName;
      if (deleteTagTimer) clearTimeout(deleteTagTimer);
      deleteTagTimer = window.setTimeout(() => {
        pendingDeleteTagName.value = null;
      }, 3000);
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    try {
      await invoke("delete_tag", { tagName: tagName.trim() });
      if (selectedTag.value === tagName) selectedTag.value = null;
      await loadData();
      showToast("已删除标签");
    } catch {
      showToast("删除失败");
    }
  };

  const openTagPickerModal = (quoteId: string | null = null) => {
    targetQuoteIdForPicker.value = quoteId;
    tagPickerSearchQuery.value = "";
    isTagPickerModalOpen.value = true;
  };

  const filteredTagsForPicker = computed(() => {
    const q = tagPickerSearchQuery.value.trim().toLowerCase();
    if (!q) return tagStats.value;
    return tagStats.value.filter((t) => t.name.toLowerCase().includes(q));
  });

  const groupedTagsForPicker = computed(() => {
    const groups = new Map<string, TagStat[]>();
    filteredTagsForPicker.value.forEach((t) => {
      const parts = normalizeTagName(t.name).split("/");
      const rootName = parts.length > 1 ? parts[0] : "通用分类";
      if (!groups.has(rootName)) groups.set(rootName, []);
      groups.get(rootName)!.push(t);
    });
    // 关键防抖：在每个分类组内部，严格按字母/拼音固化排序，绝不因频次变动而在眼皮底下午夜狂奔！
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    }
    return groups;
  });

  const addTagToExistingCard = async (quoteId: string, tagName: string) => {
    const clean = normalizeTagName(tagName);
    if (!clean) return;

    // 前端内存 0ms 乐观添加
    const card = quotes.value.find((q) => q.id === quoteId);
    if (card && !card.tags.map(normalizeTagName).includes(clean)) {
      card.tags.push(clean);
    }
    // 异步静默持久化，不打扰当前弹窗界面
    try {
      await invoke("add_tag_to_quote", { quoteId, tagName: clean });
    } catch (err) {
      console.error(err);
    }
  };

  const removeTagFromCard = async (quoteId: string, tagName: string) => {
    const clean = normalizeTagName(tagName);
    const card = quotes.value.find((q) => q.id === quoteId);
    if (card) {
      const idx = card.tags.findIndex((t) => normalizeTagName(t) === clean);
      if (idx >= 0) card.tags.splice(idx, 1);
    }
    // 异步静默删除
    try {
      await invoke("remove_tag_from_quote", { quoteId, tagName: clean });
    } catch (err) {
      console.error(err);
    }
  };

  // 关键修复：支持双向开关切换（已勾选的点击即可取消勾选并移除）
  const handleSelectTagFromPicker = async (tagName: string) => {
    const clean = normalizeTagName(tagName);
    if (!clean) return;

    if (targetQuoteIdForPicker.value) {
      const quoteId = targetQuoteIdForPicker.value;
      const card = quotes.value.find((q) => q.id === quoteId);
      const isAlreadySelected = card ? card.tags.map(normalizeTagName).includes(clean) : false;

      if (isAlreadySelected) {
        // 已有该标签 -> 执行取消选择并移除
        await removeTagFromCard(quoteId, clean);
      } else {
        // 未有该标签 -> 执行添加
        await addTagToExistingCard(quoteId, clean);
      }
    } else {
      // 记录台草稿的标签切换
      toggleAttachTag(clean);
    }
  };

  const isTagSelectedInPicker = (tagName: string): boolean => {
    const clean = normalizeTagName(tagName);
    if (targetQuoteIdForPicker.value) {
      const card = quotes.value.find((q) => q.id === targetQuoteIdForPicker.value);
      return card ? card.tags.map(normalizeTagName).includes(clean) : false;
    }
    return attachedTags.value.map(normalizeTagName).includes(clean);
  };

  const handleCreateNewTagInPicker = async () => {
    const raw = tagPickerSearchQuery.value.trim();
    if (!raw) return;
    const clean = normalizeTagName(raw);
    if (!clean) return;

    try {
      const quoteId = targetQuoteIdForPicker.value;

      // 1. 异步写入数据库关联
      await invoke("add_tag_to_quote", {
        quoteId: quoteId || "",
        tagName: clean,
      });

      // 2. 【核心修复】立即在当前弹窗标签池 (tagStats) 中插入该标签，弹窗立即呈现！
      const existing = tagStats.value.find((t) => normalizeTagName(t.name) === clean);
      if (existing) {
        existing.count += 1;
      } else {
        tagStats.value.unshift({
          id: Date.now(),
          name: clean,
          count: 1,
        });
      }

      // 3. 自动完成勾选贴上
      if (quoteId) {
        const card = quotes.value.find((q) => q.id === quoteId);
        if (card && !card.tags.map(normalizeTagName).includes(clean)) {
          card.tags.push(clean);
        }
      } else {
        pushTag(clean);
      }

      showToast(`✓ 已创建并贴上标签: ${clean}`);
      tagPickerSearchQuery.value = "";

      // 4. 后台刷新最新全局统计
      tagStats.value = await invoke<TagStat[]>("get_tag_stats");
    } catch (err: any) {
      showToast("创建标签失败: " + (err?.message || err));
    }
  };

  return {
    tagStats,
    selectedTag,
    attachedTags,
    tagInputText,
    isTagManagerOpen,
    tagManagerSearchQuery,
    newTagInput,
    renamingTagOld,
    renamingTagNew,
    pendingDeleteTagName,
    expandedTagNodes,
    isTagPickerModalOpen,
    tagPickerSearchQuery,
    targetQuoteIdForPicker,
    frequentTags,
    filteredTagsForManager,
    filteredTagsForPicker,
    groupedTagsForPicker,
    normalizeTagName,
    formatHierarchyTagName,
    getTagColor,
    toggleAttachTag,
    pushTag,
    handleTagInputKeydown,
    removeAttachedTag,
    toggleTagNodeExpand,
    isTagNodeExpanded,
    tagTreeSearchQuery,
    tagTreeSortBy,
    flattenedTagTree,
    expandAllTagNodes,
    selectedRootDomain,
    rootTagDomains,
    toggleRootDomain,
    tagSuggestions,
    collapseAllTagNodes,
    handleCreateTagFromManager,
    startCreateSubtag,
    startRenameTag,
    saveRenameTag,
    mergingSourceTag,
    mergingTargetTag,
    startMergeTag,
    cancelMergeTag,
    executeMergeTag,
    pruneEmptyTags,
    emptyTagsCount,
    confirmOrDeleteTag,
    handleDeleteTag,
    openTagPickerModal,
    addTagToExistingCard,
    removeTagFromCard,
    handleSelectTagFromPicker,
    isTagSelectedInPicker,
    handleCreateNewTagInPicker,
  };
}
