<template>
  <div 
    v-if="state.isOpen"
    class="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 bg-slate-950/70 backdrop-blur-xs animate-fade-in select-none"
    @click.self="emit('cancel')"
    @keydown.ctrl.enter="emit('save')"
    @keydown.meta.enter="emit('save')"
  >
    <div class="w-full max-w-4xl h-[82vh] bg-white rounded-[28px] border border-emerald-950/[0.08] shadow-2xl flex flex-col overflow-hidden animate-pop select-text">
      
      <div class="shrink-0 px-6 py-3.5 border-b border-slate-100 flex items-center justify-between select-none">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-center text-sm shadow-2xs font-bold">
            ✏️
          </div>
          <div>
            <h2 class="text-sm font-extrabold text-[#0F172A] tracking-tight">{{ state.title }}</h2>
            <p class="text-[10.5px] text-slate-400 font-mono">沉浸模式 · 全宽视野深度推敲</p>
          </div>
        </div>

        <button 
          type="button"
          @click="emit('cancel')"
          class="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-800 flex items-center justify-center text-xs transition cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div class="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
        <TiptapEditor
          ref="editorRef"
          :key="`zen_${state.type}_${state.id}`"
          v-model="state.content"
          :show-headings="true"
          :hide-quote-ref="false"
          min-height="100%"
          max-height="100%"
          content-class="font-serif text-base sm:text-[17px] leading-[2.0]"
          @quote-ref="emit('quote-ref', $event)"
        />
      </div>

      <div class="shrink-0 px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between select-none">
        <span class="text-[11px] font-mono text-slate-400">支持加粗、荧光高亮、清单与图片粘贴 (Ctrl+Enter 保存)</span>
        <div class="flex items-center gap-2.5">
          <button 
            type="button" 
            @click="emit('cancel')"
            class="px-4 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            取消
          </button>
          <button 
            type="button" 
            @click="emit('save')"
            class="px-6 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md active:scale-95 cursor-pointer transition"
          >
            ✓ 保存修改
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TiptapEditor from '../TiptapEditor.vue';

const props = defineProps<{
  state: {
    isOpen: boolean;
    type: 'quote' | 'thought';
    id: string;
    title: string;
    content: string;
  };
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'save'): void;
  (e: 'quote-ref', editorInstance: any): void;
}>();

const editorRef = ref<any>(null);

defineExpose({
  getHTML: () => editorRef.value?.editor?.getHTML() || props.state.content
});
</script>
