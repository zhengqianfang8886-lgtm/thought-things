<template>
  <div 
    class="tiptap-editor-box flex flex-col w-full bg-white rounded-2xl border border-slate-200/90 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-400/20 transition-all duration-150 overflow-hidden shadow-2xs"
    @click.stop
  >
    <!-- 统一排版工具栏 -->
    <div v-if="!hideToolbar" class="shrink-0 px-3 py-1.5 bg-slate-50/80 border-b border-slate-100 flex items-center gap-1 overflow-x-auto stable-scroll select-none">
      <button v-if="showHeadings" type="button" @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()" title="H1 标题" class="px-1.5 h-6 rounded hover:bg-slate-200/70 text-xs font-bold text-slate-700 cursor-pointer">H1</button>
      <button v-if="showHeadings" type="button" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()" title="二级标题" class="px-1.5 h-6 rounded hover:bg-slate-200/70 text-xs font-bold text-slate-700 cursor-pointer">H2</button>
      <span v-if="showHeadings" class="w-[1px] h-3.5 bg-slate-200 mx-0.5"></span>

      <button type="button" @click="editor?.chain().focus().toggleBold().run()" title="加粗" class="w-6 h-6 rounded hover:bg-slate-200/70 text-xs font-bold text-slate-700 flex items-center justify-center cursor-pointer">B</button>
      <button type="button" @click="editor?.chain().focus().toggleItalic().run()" title="斜体" class="w-6 h-6 rounded hover:bg-slate-200/70 text-xs italic text-slate-700 flex items-center justify-center cursor-pointer">I</button>
      <button type="button" @click="editor?.chain().focus().toggleUnderline().run()" title="下划线" class="w-6 h-6 rounded hover:bg-slate-200/70 text-xs underline font-medium text-slate-700 flex items-center justify-center cursor-pointer">U</button>
      <button type="button" @click="editor?.chain().focus().toggleStrike().run()" title="删除线" class="w-6 h-6 rounded hover:bg-slate-200/70 text-xs line-through text-slate-700 flex items-center justify-center cursor-pointer">S</button>
      <span class="w-[1px] h-3.5 bg-slate-200 mx-0.5"></span>

      <!-- 彩虹高亮荧光笔 -->
      <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#FEF08A' }).run()" title="荧光黄" class="w-3.5 h-3.5 rounded-full bg-amber-300 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
      <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#A7F3D0' }).run()" title="青草绿" class="w-3.5 h-3.5 rounded-full bg-emerald-400 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
      <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#BAE6FD' }).run()" title="晴空蓝" class="w-3.5 h-3.5 rounded-full bg-sky-400 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
      <button type="button" @click="editor?.chain().focus().toggleHighlight({ color: '#FDA4AF' }).run()" title="樱花粉" class="w-3.5 h-3.5 rounded-full bg-rose-300 hover:scale-110 cursor-pointer shadow-2xs mx-0.5"></button>
      <span class="w-[1px] h-3.5 bg-slate-200 mx-0.5"></span>

      <!-- 打勾清单 -->
      <button type="button" @click="editor?.chain().focus().toggleTaskList().run()" title="打勾清单" class="px-2 h-6 rounded hover:bg-emerald-100/80 text-xs font-bold text-emerald-800 flex items-center gap-1 cursor-pointer">
        <span>☑ 清单</span>
      </button>
      <button type="button" @click="editor?.chain().focus().toggleBlockquote().run()" title="引用块" class="w-6 h-6 rounded hover:bg-slate-200/70 text-xs text-slate-700 flex items-center justify-center cursor-pointer">❞</button>

      <!-- 右侧：引用 + 触发全局沉浸全屏按钮 -->
      <div class="ml-auto flex items-center gap-1.5 shrink-0">
        <slot name="extra"></slot>
        
        <button 
          v-if="!hideQuoteRef"
          type="button"
          @click="onQuoteRefClick"
          title="在文字中引用既有客观摘录"
          class="px-2.5 h-6 rounded-full bg-emerald-50 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-800 border border-emerald-200 flex items-center gap-1 cursor-pointer shadow-2xs transition active:scale-95 shrink-0 select-none"
        >
          <span>🔗 引用</span>
        </button>

        <!-- 呼唤真·全局沉浸编辑模态台 -->
        <button
          v-if="showZenTrigger"
          type="button"
          @click="emit('open-zen')"
          title="打开大屏沉浸全屏编辑"
          class="px-2 h-6 rounded-md hover:bg-slate-200/70 text-slate-500 hover:text-slate-900 text-[11px] font-mono flex items-center gap-1 cursor-pointer transition"
        >
          <span>⤢ 沉浸</span>
        </button>
      </div>
    </div>

    <!-- 自适应弹性高度编辑画布 (行内随字数向上撑开，长文本丝滑内滚，带右下角拉高手柄) -->
    <div 
      class="flex-1 min-h-0 overflow-y-auto stable-scroll p-3.5 bg-white resize-y"
      :style="{ 
        minHeight: minHeight || '110px',
        maxHeight: maxHeight || '450px'
      }"
    >
      <editor-content 
        :editor="editor" 
        class="tiptap-container w-full h-full text-[#0F172A]" 
        :class="contentClass || 'font-serif text-base sm:text-[16.5px] leading-[1.85]'" 
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { QuoteRefExtension } from '../extensions/QuoteRefExtension';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  hideToolbar?: boolean;
  hideQuoteRef?: boolean;
  showHeadings?: boolean;
  showZenTrigger?: boolean;
  contentClass?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'quote-ref', editorInstance: any): void;
  (e: 'open-zen'): void;
}>();

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    Underline,
    QuoteRefExtension,
    StarterKit.configure({ heading: { levels: [1, 2] } }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: () => props.placeholder || '在此输入内容...',
    }),
  ],
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getHTML());
  },
});

const onQuoteRefClick = () => {
  emit('quote-ref', editor.value);
};

watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    const isSame = editor.value.getHTML() === val;
    if (!isSame) {
      editor.value.commands.setContent(val || '', { emitUpdate: false });
    }
  }
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});

defineExpose({
  editor,
  insertContent: (content: string) => {
    editor.value?.chain().focus().insertContent(content).run();
  },
  clear: () => {
    editor.value?.commands.clearContent();
  }
});
</script>
