<template>
  <div 
    v-if="modelValue"
    class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/60 animate-fade-in"
    @click.self="emit('update:modelValue', false)"
  >
    <div class="w-full max-w-2xl soft-modal p-6 flex flex-col gap-3.5 max-h-[85vh] overflow-hidden shadow-2xl animate-pop">
      <div class="flex items-center justify-between pb-2 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <h2 class="text-sm font-bold text-[#0F172A] font-mono">运行诊断终端</h2>
        </div>
        <div class="flex items-center gap-2">
          <button @click="emit('clear')" class="text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer">清空</button>
          <button @click="emit('update:modelValue', false)" class="text-sm text-slate-400 hover:text-slate-800 cursor-pointer px-1">✕</button>
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
</template>

<script setup lang="ts">
import type { AppLog } from '../../types';

defineProps<{
  modelValue: boolean;
  logs: AppLog[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
  (e: 'clear'): void;
}>();
</script>
