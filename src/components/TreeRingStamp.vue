<template>
  <div 
    class="tree-ring-stamp relative inline-flex items-center justify-center cursor-default select-none group"
    :title="tooltipText"
  >
    <svg 
      :width="size" 
      :height="size" 
      viewBox="0 0 44 44" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      class="transition-transform duration-300 group-hover:scale-110"
    >
      <!-- 背景微光盘 -->
      <circle cx="22" cy="22" r="21" class="fill-emerald-500/5 group-hover:fill-emerald-500/10 transition-colors" />

      <!-- 外围年轮层 (根据 thoughts 数量动态生长，每层带有机轻微微差) -->
      <circle 
        v-if="effectiveRings >= 4" 
        cx="22" cy="22" r="19" 
        stroke="currentColor" 
        stroke-width="1.2" 
        stroke-dasharray="2 1.5"
        class="text-emerald-600/30 animate-spin-slow"
      />
      <circle 
        v-if="effectiveRings >= 3" 
        cx="22" cy="22" r="15" 
        stroke="currentColor" 
        stroke-width="1.3" 
        class="text-emerald-600/40"
      />
      <circle 
        v-if="effectiveRings >= 2" 
        cx="22" cy="22" r="11" 
        stroke="currentColor" 
        stroke-width="1.5" 
        class="text-emerald-700/60"
      />
      <circle 
        v-if="effectiveRings >= 1" 
        cx="22" cy="22" r="7.5" 
        stroke="currentColor" 
        stroke-width="1.6" 
        class="text-emerald-800/80"
      />

      <!-- 核心初芯 (The Seed) -->
      <circle 
        cx="22" cy="22" r="3.5" 
        class="fill-emerald-600 shadow-2xs group-hover:fill-emerald-500 transition-colors" 
      />
    </svg>

    <!-- 极简微徽章：演进层数指示 -->
    <span 
      v-if="effectiveRings > 0"
      class="absolute -bottom-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-emerald-600 text-white font-mono text-[9px] font-extrabold flex items-center justify-center shadow-2xs border border-white"
    >
      {{ effectiveRings }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  ringsCount?: number;
  createdAt?: number;
  size?: number;
}>(), {
  ringsCount: 0,
  createdAt: 0,
  size: 32,
});

const effectiveRings = computed(() => props.ringsCount);

const daysAgo = computed(() => {
  if (!props.createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() - props.createdAt) / 86400000));
});

const tooltipText = computed(() => {
  if (effectiveRings.value === 0) {
    return `初芯沉淀 ${daysAgo.value} 天 · 尚未萌发延伸年轮`;
  }
  return `🌱 历经 ${effectiveRings.value} 层思维年轮演进 · 时光沉淀 ${daysAgo.value} 天`;
});
</script>

<style scoped>
@keyframes spinSlow {
  from { transform: rotate(0deg); transform-origin: center; }
  to { transform: rotate(360deg); transform-origin: center; }
}
.animate-spin-slow {
  animation: spinSlow 40s linear infinite;
}
</style>
