<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 animate-fade-in"
    @click.self="emit('update:modelValue', false)"
  >
    <div class="w-full max-w-md soft-modal p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto stable-scroll shadow-2xl animate-pop">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <span class="text-base">⚙️</span>
          <h2 class="text-sm font-bold text-[#0F172A] tracking-tight">手记偏好设置</h2>
        </div>
        <button 
          type="button"
          @click="emit('update:modelValue', false)" 
          class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer text-xs"
        >
          ✕
        </button>
      </div>

      <!-- 全局阅读字号调节 -->
      <div class="flex flex-col gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>🔍</span>
            <span>手记阅读字号</span>
          </span>
          <span class="text-[10px] text-slate-400 font-mono">支持快捷键 Ctrl + / - / 0</span>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-0.5">
          <button 
            type="button" 
            @click="emit('set-font-size', 'compact')"
            class="h-9 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5"
            :class="currentFontSize === 'compact' ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'"
          >
            <span>紧凑</span>
            <span class="text-[10px] opacity-75">14px</span>
          </button>
          <button 
            type="button" 
            @click="emit('set-font-size', 'normal')"
            class="h-9 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5"
            :class="currentFontSize === 'normal' ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'"
          >
            <span>标准</span>
            <span class="text-[10px] opacity-75">15px</span>
          </button>
          <button 
            type="button" 
            @click="emit('set-font-size', 'large')"
            class="h-9 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5"
            :class="currentFontSize === 'large' ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'"
          >
            <span>大字</span>
            <span class="text-[10px] opacity-75">17px</span>
          </button>
        </div>
      </div>

      <!-- 本地系统字体配置 -->
      <div class="flex flex-col gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>🔤</span>
            <span>本地系统字体</span>
          </span>
          <button 
            type="button"
            @click="emit('scan-fonts')" 
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 hover:bg-emerald-50 text-emerald-800 transition active:scale-95 shadow-2xs cursor-pointer"
          >
            {{ isScanningFonts ? '扫描中...' : '重新扫描' }}
          </button>
        </div>

        <input 
          type="text" 
          v-model="fontSearch" 
          placeholder="搜索字体名称..." 
          class="h-9 text-xs px-3.5 rounded-xl border border-slate-200 bg-white text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/20 transition-all" 
        />

        <div class="max-h-48 overflow-y-auto stable-scroll rounded-xl border border-slate-200 bg-white p-1.5 flex flex-col gap-1">
          <div 
            @click="emit('apply-font', 'system-ui')" 
            class="shrink-0 h-8 px-3 rounded-lg text-xs cursor-pointer flex items-center justify-between transition-all"
            :class="currentFontFamily === 'system-ui' ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200/80 shadow-2xs' : 'text-slate-700 hover:bg-slate-50 border border-transparent'"
          >
            <span>默认系统字体 (system-ui)</span>
            <span v-if="currentFontFamily === 'system-ui'" class="text-emerald-600 font-bold text-xs">✓</span>
          </div>

          <div 
            v-for="f in filteredFonts" 
            :key="f" 
            @click="emit('apply-font', f)" 
            class="shrink-0 h-8 px-3 rounded-lg text-xs cursor-pointer flex items-center justify-between transition-all"
            :class="currentFontFamily === f ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200/80 shadow-2xs' : 'text-slate-700 hover:bg-slate-50 border border-transparent'"
          >
            <span class="truncate">{{ f }}</span>
            <span v-if="currentFontFamily === f" class="text-emerald-600 font-bold text-xs">✓</span>
          </div>
        </div>
      </div>

      <!-- 数据与资产操作 -->
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
            @click="emit('export-json')" 
            :disabled="isExporting" 
            class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200/90 shadow-2xs hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-900 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <span>📦</span><span>{{ isExporting ? '导出中...' : 'JSON备份' }}</span>
          </button>
          <button 
            type="button"
            @click="emit('export-markdown')" 
            class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-emerald-800 border border-emerald-300/80 shadow-2xs hover:bg-emerald-50 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1"
          >
            <span>📝</span><span>MD知识库</span>
          </button>
          <button 
            type="button"
            @click="emit('trigger-import')" 
            :disabled="isImporting" 
            class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200/90 shadow-2xs hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-900 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <span>📥</span><span>{{ isImporting ? '导入中...' : '导入备份' }}</span>
          </button>
          <button 
            type="button"
            @click="emit('clean-images')" 
            :disabled="isCleaningImages" 
            class="h-9 px-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200/90 shadow-2xs hover:border-rose-300 hover:bg-rose-50/50 hover:text-rose-700 cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <span>🧹</span><span>{{ isCleaningImages ? '清理中...' : '清理冗余' }}</span>
          </button>
        </div>
      </div>

      <!-- 防窥锁屏配置 -->
      <div class="flex flex-col gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-2xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>🛡️</span>
            <span>防窥锁屏保护 (PBKDF2)</span>
          </span>
          <span 
            class="text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold border transition-colors"
            :class="isLocked ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-200/70 text-slate-500 border-slate-300/50'"
          >
            {{ isLocked ? '已开启' : '未开启' }}
          </span>
        </div>

        <div v-if="!isLocked" class="flex flex-col gap-2 pt-0.5">
          <input 
            type="password" 
            v-model="newPassword" 
            placeholder="设置新锁屏密码..." 
            class="h-9 text-xs px-3.5 rounded-xl border border-slate-200 bg-white text-[#0F172A] focus:outline-none focus:border-emerald-500" 
          />
          <input 
            type="password" 
            v-model="confirmPassword" 
            placeholder="确认新密码..." 
            class="h-9 text-xs px-3.5 rounded-xl border border-slate-200 bg-white text-[#0F172A] focus:outline-none focus:border-emerald-500" 
          />
          <button 
            type="button"
            @click="emit('set-password', newPassword, confirmPassword); newPassword = ''; confirmPassword = '';" 
            class="h-9 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
          >
            <span>🔒</span><span>开启锁屏保护</span>
          </button>
        </div>

        <div v-else class="flex items-center justify-between pt-1">
          <button 
            type="button"
            @click="emit('lock-now'); emit('update:modelValue', false);" 
            class="h-8 px-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold shadow-2xs cursor-pointer active:scale-95 transition-all"
          >
            立即锁屏
          </button>
          <button 
            type="button"
            @click="emit('disable-password')" 
            class="text-xs text-rose-600 hover:text-rose-700 font-semibold hover:underline cursor-pointer px-1"
          >
            解除密码锁
          </button>
        </div>
      </div>

      <div class="pt-3 flex items-center justify-between border-t border-slate-100">
        <span class="text-[11px] text-slate-400 font-mono">配置变更即刻生效</span>
        <button 
          type="button"
          @click="emit('update:modelValue', false)" 
          class="px-6 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-black text-white cursor-pointer shadow-sm active:scale-95 transition-all"
        >
          完成
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  systemFonts: string[];
  isScanningFonts: boolean;
  currentFontFamily: string;
  isExporting: boolean;
  isImporting: boolean;
  isCleaningImages: boolean;
  isLocked: boolean;
  currentFontSize?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'scan-fonts'): void;
  (e: 'apply-font', family: string): void;
  (e: 'export-json'): void;
  (e: 'export-markdown'): void;
  (e: 'trigger-import'): void;
  (e: 'clean-images'): void;
  (e: 'set-password', p1: string, p2: string): void;
  (e: 'disable-password'): void;
  (e: 'lock-now'): void;
  (e: 'set-font-size', size: 'compact' | 'normal' | 'large'): void;
}>();

const fontSearch = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

const filteredFonts = computed(() => {
  const q = fontSearch.value.trim().toLowerCase();
  if (!q) return props.systemFonts.slice(0, 80);
  return props.systemFonts.filter(f => f.toLowerCase().includes(q)).slice(0, 80);
});
</script>
