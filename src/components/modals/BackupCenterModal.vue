<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-xs animate-fade-in"
    @click.self="emit('update:modelValue', false)"
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
        <button type="button" @click="emit('update:modelValue', false)" class="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-sm text-slate-400 hover:text-slate-800 cursor-pointer transition">✕</button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-0.5">
          <span class="text-[10.5px] font-bold text-slate-400">已收录手记</span>
          <span class="text-xl font-extrabold text-slate-800 font-mono">{{ totalQuotes }} 篇</span>
        </div>
        <div class="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex flex-col gap-0.5">
          <span class="text-[10.5px] font-bold text-emerald-800">存储引擎状态</span>
          <span class="text-xs font-extrabold text-emerald-950 font-mono mt-1">SQLite WAL 极速引擎</span>
        </div>
      </div>

      <div class="flex flex-col gap-2.5">
        <span class="text-xs font-bold text-slate-700">导出数据快照 (离线留存)</span>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button 
            type="button" 
            @click="emit('trigger-json-backup')"
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
            @click="emit('export-markdown')"
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
            @click="emit('create-snapshot')"
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
            @click="emit('open-folder')"
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

      <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
        <div class="flex flex-col gap-0.5">
          <span class="text-xs font-bold text-slate-800">从已有备份恢复</span>
          <span class="text-[11px] text-slate-500">导入此前导出的 JSON 备份文件，自动智能合并并增量去重。</span>
        </div>
        <button 
          type="button" 
          @click="emit('trigger-import')" 
          :disabled="isImporting"
          class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer transition active:scale-95 shadow-xs whitespace-nowrap"
        >
          <span>{{ isImporting ? '导入中...' : '导入备份' }}</span>
        </button>
      </div>

      <div class="pt-2 flex justify-end border-t border-slate-100">
        <button type="button" @click="emit('update:modelValue', false)" class="px-6 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white cursor-pointer hover:bg-black transition active:scale-95 shadow-xs">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  totalQuotes: number;
  lastBackupTime: string | null;
  isExporting: boolean;
  isCreatingSnapshot: boolean;
  isImporting: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'trigger-json-backup'): void;
  (e: 'export-markdown'): void;
  (e: 'create-snapshot'): void;
  (e: 'open-folder'): void;
  (e: 'trigger-import'): void;
}>();
</script>
