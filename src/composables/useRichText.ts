import { ref, nextTick } from "vue";
import { invoke, convertFileSrc } from "../ipc-bridge";
import type { QuoteDetail } from "../types";

export function useRichText(showToast: (msg: string) => void) {
  const loadedImageMap = ref<Record<string, string>>({});
  const imageLoadingSet = new Set<string>();
  const previewModalImage = ref<string | null>(null);

  // 核心突破：构建严格的 60 容量上限 LRU 内存图片驱逐队列 (锁死内存开销在 60MB 以内)
  const MAX_IMAGE_CACHE_SIZE = 60;
  const lruAccessQueue: string[] = [];

  const touchLruKey = (filename: string) => {
    const idx = lruAccessQueue.indexOf(filename);
    if (idx >= 0) {
      lruAccessQueue.splice(idx, 1);
    }
    lruAccessQueue.push(filename);

    // 超过上限则驱逐最久未访问的图片，释放 Webview 堆内存
    while (lruAccessQueue.length > MAX_IMAGE_CACHE_SIZE) {
      const oldestKey = lruAccessQueue.shift();
      if (oldestKey && loadedImageMap.value[oldestKey]) {
        delete loadedImageMap.value[oldestKey];
      }
    }
  };

  // Base64-First 内存直通加载
  const resolveAndLoadImage = async (filename: string) => {
    if (!filename || imageLoadingSet.has(filename)) return;

    if (loadedImageMap.value[filename]) {
      touchLruKey(filename);
      return;
    }

    imageLoadingSet.add(filename);

    try {
      const b64 = await invoke<string>("get_image_base64", { filename });
      if (b64 && b64.startsWith("data:image/")) {
        loadedImageMap.value[filename] = b64;
        touchLruKey(filename);
        return;
      }
    } catch (e1) {
      // 后端直通失败走备用
    }

    try {
      const absPath = await invoke<string>("get_image_asset_path", { filename });
      loadedImageMap.value[filename] = convertFileSrc(absPath);
      touchLruKey(filename);
    } catch {
      loadedImageMap.value[filename] = "ERROR";
    } finally {
      imageLoadingSet.delete(filename);
    }
  };

  const extractAndPreload = (text: string) => {
    if (!text) return;
    const regex = /!\[.*?\]\(img:([a-zA-Z0-9_\-\.]+)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      resolveAndLoadImage(match[1]);
    }
  };

  const scanAllImages = (cards: QuoteDetail[]) => {
    for (const card of cards) {
      extractAndPreload(card.content);
      for (const th of card.thoughts) {
        extractAndPreload(th.content);
      }
    }
  };

  const insertImageIntoElement = (el: HTMLTextAreaElement, filename: string) => {
    resolveAndLoadImage(filename);
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = el.value || "";

    const prevChar = start > 0 ? current.charAt(start - 1) : "";
    const nextChar = end < current.length ? current.charAt(end) : "";

    let prefix = "";
    let suffix = "\n";
    if (current.length > 0) {
      if (prevChar && prevChar !== "\n") prefix = "\n";
      if (nextChar && nextChar !== "\n") suffix = "\n";
    }

    const placeholder = `${prefix}![图片](img:${filename})${suffix}`;
    const next = current.substring(0, start) + placeholder + current.substring(end);

    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    nextTick(() => {
      el.focus();
      el.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  };

  // 五级立体弹性图文粘贴管线
  const handleSmartPaste = async (e: ClipboardEvent) => {
    const el = e.target as HTMLTextAreaElement;
    if (!el || el.tagName !== "TEXTAREA") return;

    const clipboardData = e.clipboardData;
    let text = clipboardData ? clipboardData.getData("text") : "";
    const uriList = clipboardData ? clipboardData.getData("text/uri-list") : "";

    if (!text && uriList) {
      const firstLine = uriList.split("\n")[0].trim();
      if (firstLine.startsWith("file://")) text = decodeURIComponent(firstLine);
    }

    let imageFile: File | null = null;

    if (clipboardData && clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && item.type.startsWith("image/")) {
          imageFile = item.getAsFile();
          if (imageFile) break;
        }
      }
    }

    if (!imageFile && clipboardData && clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file.type && file.type.startsWith("image/")) {
          imageFile = file;
          break;
        }
      }
    }

    if (!imageFile && typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.read) {
      try {
        const clipItems = await navigator.clipboard.read();
        for (const cItem of clipItems) {
          const imgType = cItem.types.find((t) => t.startsWith("image/"));
          if (imgType) {
            const blob = await cItem.getType(imgType);
            imageFile = new File([blob], `clip.${imgType.split("/")[1] || "png"}`, { type: imgType });
            break;
          }
        }
      } catch {}
    }

    if (imageFile) {
      e.preventDefault();
      const ext = imageFile.type.split("/")[1] || "png";
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const b64 = ev.target?.result as string;
        if (b64) {
          try {
            const filename = await invoke<string>("save_image_base64", {
              base64Data: b64,
              extHint: ext,
            });
            insertImageIntoElement(el, filename);
            showToast("📷 截图已载入");
          } catch (err: any) {
            showToast("图片保存失败: " + (err?.message || err));
          }
        }
      };
      reader.readAsDataURL(imageFile);
      return;
    }

    let rawPath = text.trim();
    if (rawPath.startsWith("file://")) {
      rawPath = decodeURIComponent(rawPath.replace(/^file:\/\//, ""));
    }
    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(rawPath)) {
      e.preventDefault();
      try {
        const filename = await invoke<string>("save_image_from_file_path", { pathStr: rawPath });
        insertImageIntoElement(el, filename);
        showToast("📷 已导入本地图片");
        return;
      } catch {}
    }

    try {
      const directFilename = await invoke<string>("paste_clipboard_image");
      if (directFilename) {
        e.preventDefault();
        insertImageIntoElement(el, directFilename);
        showToast("📷 原生截图已截获载入");
        return;
      }
    } catch {}
  };

  // 原生高效 DOM 净化器：深度防御 XSS，剔除恶意脚本与危险内联事件，同时保留正常富文本标签
  const sanitizeHtml = (dirty: string): string => {
    if (typeof window === "undefined" || !window.DOMParser) return dirty;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(dirty, "text/html");
      const dangerousTags = ["script", "iframe", "object", "embed", "base", "meta", "form"];
      dangerousTags.forEach((t) => doc.querySelectorAll(t).forEach((el) => el.remove()));
      doc.querySelectorAll("*").forEach((el) => {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          const val = attr.value.trim().toLowerCase();
          if (
            name.startsWith("on") ||
            val.startsWith("javascript:") ||
            val.startsWith("data:text/html") ||
            val.startsWith("vbscript:")
          ) {
            el.removeAttribute(attr.name);
          }
        }
      });
      return doc.body.innerHTML;
    } catch {
      return dirty;
    }
  };

  // 智能安全高亮：精准匹配纯文本节点，保护 HTML 标签名与属性值不被破坏
  const highlightHtml = (html: string, keyword?: string): string => {
    if (!html || !keyword || !keyword.trim()) return html;
    const words = keyword
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (words.length === 0) return html;

    const regex = new RegExp(`(<[^>]+>)|(${words.join("|")})`, "gi");
    return html.replace(regex, (match, tag, textMatch) => {
      if (tag) return tag; // 标签本体原样返回，严禁插入高亮
      return `<mark class="search-highlight">${textMatch}</mark>`;
    });
  };

  const highlightText = (text: string | null | undefined, keyword?: string): string => {
    if (!text) return "";
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
    if (!keyword || !keyword.trim()) return escaped;
    return highlightHtml(escaped, keyword);
  };

  const escapeHtmlText = (s: string): string => {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const renderRichText = (
    text: string,
    quoteLookupMap: Record<string, QuoteDetail>,
    quotes: QuoteDetail[],
    fetchAllQuotesSilently: () => Promise<void>,
    highlightKeyword?: string
  ): string => {
    if (!text) return "";

    // 1. 智能识别：富文本执行白名单无害化过滤；纯文本转义实体并解析轻量 Markdown
    const isHtml = /<(p|strong|em|u|s|del|mark|ul|ol|li|input|blockquote|h1|h2|div|span)[>\s]/i.test(text);
    let output = text;

    if (isHtml) {
      output = sanitizeHtml(output);
    } else {
      // 兼容旧纯文本笔记：转义字符并解析老旧 Markdown 语法
      output = output
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

      output = output.replace(/^###\s+(.+)$/gm, '<h3 class="text-base font-bold text-[#0F172A] mt-2 mb-1">$1</h3>');
      output = output.replace(/^##\s+(.+)$/gm, '<h2 class="text-lg font-bold text-[#0F172A] mt-3 mb-1.5 tracking-tight">$1</h2>');
      output = output.replace(/^#\s+(.+)$/gm, '<h1 class="text-xl font-bold text-[#0F172A] mt-3 mb-2 tracking-tight">$1</h1>');
      output = output.replace(/==y(?:ellow)?:([^=]+)==/g, '<mark class="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-md mx-0.5 font-medium">$1</mark>');
      output = output.replace(/==g(?:reen)?:([^=]+)==/g, '<mark class="bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded-md mx-0.5 font-medium">$1</mark>');
      output = output.replace(/==b(?:lue)?:([^=]+)==/g, '<mark class="bg-sky-100 text-sky-900 px-1.5 py-0.5 rounded-md mx-0.5 font-medium">$1</mark>');
      output = output.replace(/==r(?:ed)?:([^=]+)==/g, '<mark class="bg-rose-100 text-rose-900 px-1.5 py-0.5 rounded-md mx-0.5 font-medium">$1</mark>');
      output = output.replace(/==([^=]+)==/g, '<mark class="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-md mx-0.5 font-medium">$1</mark>');
      output = output.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-[#0F172A]">$1</strong>');
      output = output.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');
      output = output.replace(/~~([^~]+)~~/g, '<del class="line-through text-slate-400 opacity-80">$1</del>');
      output = output.replace(/\n/g, "<br/>");
    }

    // 2. 解析【引用摘录】胶囊（支持 [quote:id] 与 [quote:id|标题]，兼容旧语法同时解决可读性问题）
    output = output.replace(/\[quote:([a-zA-Z0-9_\-\.]+)(?:\|([^\]]+))?\]/g, (_m, refQuoteId, customTitle) => {
      const targetQuote = quoteLookupMap[refQuoteId] || quotes.find((q) => q.id === refQuoteId);
      if (targetQuote) {
        const cleanContent = (targetQuote.content || '').replace(/<[^>]+>/g, '').trim();
        const displayTitle = escapeHtmlText(customTitle
          ? customTitle.trim()
          : (targetQuote.source
            ? `《${targetQuote.source}》`
            : (cleanContent.slice(0, 16) + (cleanContent.length > 16 ? '...' : ''))));
        return `<button type="button" class="quote-link-badge inline-flex items-center gap-1.5 px-2.5 py-0.5 my-0.5 rounded-full text-xs font-sans font-semibold bg-emerald-50/90 hover:bg-emerald-100 text-emerald-950 border border-emerald-300/80 transition-all cursor-pointer active:scale-95 shadow-2xs select-none align-middle hover:border-emerald-400" data-ref-quote-id="${refQuoteId}"><span class="text-[11px] text-emerald-700 leading-none">🔗</span><span class="tracking-tight font-medium">${displayTitle}</span></button>`;
      }
      // 目标手记已删除（断链容错处理）：保留历史标题，展示为典雅的灰色断链微徽章
      const fallbackTitle = escapeHtmlText(customTitle ? customTitle.trim() : "已删手记");
      return `<span class="quote-link-dangling inline-flex items-center gap-1 px-2 py-0.5 my-0.5 rounded-full text-[11px] font-sans bg-slate-100 text-slate-500 border border-dashed border-slate-300/80 select-none align-middle cursor-help" title="该关联原句已被删除，保留标题备查" data-dangling-id="${refQuoteId}"><span class="text-[10px] opacity-70">⛓️‍💥</span><span class="line-through decoration-slate-300">${fallbackTitle}</span><span class="text-[9.5px] opacity-75">(已删)</span></span>`;
    });

    // 3. 解析图片嵌入
    output = output.replace(/!\[(.*?)\]\(img:([a-zA-Z0-9_\-\.]+)\)/g, (_m, alt, filename) => {
      const src = loadedImageMap.value[filename];
      if (src && src !== "ERROR") {
        touchLruKey(filename);
        return `
          <div class="my-3 inline-flex max-w-full">
            <div class="relative max-w-full inline-block rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm bg-white cursor-zoom-in group hover:shadow-md transition preview-trigger" data-preview-img="${filename}">
              <img src="${src}" alt="${alt}" loading="lazy" class="max-h-96 max-w-full w-auto h-auto object-contain block select-none rounded-2xl pointer-events-none" />
            </div>
          </div>
        `;
      } else if (src === "ERROR") {
        return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 text-xs font-mono my-1 font-semibold"><span>⚠️</span><span>图片丢失 (${filename})</span></span>`;
      } else {
        return `
          <div class="my-2 block max-w-full">
            <div class="w-60 h-32 rounded-2xl border border-dashed border-emerald-950/15 bg-slate-100/70 flex items-center justify-center gap-2 text-xs font-mono text-slate-500 animate-pulse select-none">
              <span>🖼️</span><span>图片载入中...</span>
            </div>
          </div>
        `;
      }
    });

    if (highlightKeyword && highlightKeyword.trim()) {
      output = highlightHtml(output, highlightKeyword);
    }

    return output;
  };

  const applyRichFormat = (
    target: HTMLTextAreaElement | string | null,
    prefix: string,
    suffix: string = prefix,
    _placeholder: string = ""
  ) => {
    const el = typeof target === "string" ? (document.getElementById(target) as HTMLTextAreaElement) : target;
    if (!el) return;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = el.value || "";
    // 关键修复：未选中文本时绝不硬塞任何假字，保持空字符串并将光标置于标记正中
    const selected = current.substring(start, end);
    const next = current.substring(0, start) + prefix + selected + suffix + current.substring(end);

    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    nextTick(() => {
      el.focus();
      const targetCursor = start + prefix.length + selected.length;
      el.setSelectionRange(targetCursor, targetCursor);
    });
  };

  return {
    loadedImageMap,
    previewModalImage,
    resolveAndLoadImage,
    extractAndPreload,
    scanAllImages,
    renderRichText,
    applyRichFormat,
    insertImageIntoElement,
    handleSmartPaste,
    highlightHtml,
    highlightText,
  };
}
