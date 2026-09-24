<template>
  <div 
    class="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-md select-none overflow-hidden animate-fade-in cursor-default"
    @wheel.prevent="handleWheel"
  >
    <!-- 1. 顶栏操作区：文件名与关闭 -->
    <div class="absolute top-5 inset-x-6 flex items-center justify-between pointer-events-none z-20" @click.stop>
      <div class="flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/80 border border-white/10 text-white/90 text-xs font-mono backdrop-blur-md shadow-lg pointer-events-auto">
        <span>🖼️</span>
        <span class="truncate max-w-[260px]">{{ displayFileName }}</span>
      </div>

      <button 
        type="button"
        @click="emit('close')" 
        class="w-9 h-9 rounded-full bg-slate-900/80 hover:bg-rose-600 border border-white/10 text-white flex items-center justify-center transition-all cursor-pointer shadow-lg active:scale-90 pointer-events-auto"
        title="关闭 (Esc)"
      >
        <span class="text-sm font-bold">✕</span>
      </button>
    </div>

    <!-- 2. 图片展示与手势捕获主舞台 (点击空白退出，拖动不误关) -->
    <div 
      class="w-full h-full flex items-center justify-center overflow-hidden touch-none"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @click="handleStageClick"
      @dblclick="handleDoubleClick"
    >
      <img 
        ref="imageRef"
        :src="src" 
        alt="预览大图"
        draggable="false"
        class="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl block border border-white/10 select-none will-change-transform"
        :style="{
          transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale}) rotate(${rotate}deg)`,
          transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          cursor: isDragging ? 'grabbing' : (scale > 1.05 ? 'grab' : 'zoom-in'),
          userSelect: 'none'
        }"
      />
    </div>

    <!-- 3. 底部悬浮控制胶囊岛 (灵动 HUD) -->
    <div 
      class="absolute bottom-7 inset-x-0 mx-auto w-fit flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-slate-900/85 border border-white/15 backdrop-blur-md text-white shadow-2xl z-20 select-none pointer-events-auto"
      @click.stop
    >
      <!-- 缩小 -->
      <button 
        type="button" 
        @click="zoomStep(-0.25)" 
        title="缩小 (-)" 
        class="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center text-sm font-bold transition active:scale-90 cursor-pointer"
      >
        −
      </button>

      <!-- 缩放比例重置 -->
      <button 
        type="button" 
        @click="resetView" 
        title="点击恢复 100% 原始比例 (按键 0)" 
        class="px-2.5 h-8 rounded-full hover:bg-white/15 flex items-center justify-center font-mono text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition active:scale-95 cursor-pointer"
      >
        {{ Math.round(scale * 100) }}%
      </button>

      <!-- 放大 -->
      <button 
        type="button" 
        @click="zoomStep(0.25)" 
        title="放大 (+)" 
        class="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center text-sm font-bold transition active:scale-90 cursor-pointer"
      >
        +
      </button>

      <span class="w-[1px] h-4 bg-white/20 mx-1"></span>

      <!-- 顺时针旋转 90 度 -->
      <button 
        type="button" 
        @click="rotateClockwise" 
        title="顺时针旋转 90° (快捷键 R)" 
        class="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center text-xs transition active:scale-90 cursor-pointer"
      >
        ↻
      </button>

      <!-- 一键还原自适应 -->
      <button 
        type="button" 
        @click="resetView" 
        title="适应窗口" 
        class="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center text-xs transition active:scale-90 cursor-pointer"
      >
        ⛶
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
  src: string;
  fileNameHint?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// 核心变换状态
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const rotate = ref(0);

// 拖拽手势状态
const isDragging = ref(false);
const dragStart = { x: 0, y: 0, startTx: 0, startTy: 0 };
const pointerDownPos = { x: 0, y: 0 };
let hasMovedBeyondThreshold = false;

const imageRef = ref<HTMLImageElement | null>(null);

const displayFileName = computed(() => {
  if (props.fileNameHint) return props.fileNameHint;
  if (props.src.startsWith('data:image/')) return '剪贴板截屏预览';
  const urlParts = props.src.split('/');
  return urlParts[urlParts.length - 1] || '图片预览';
});

// 缩放边界控制
const MIN_SCALE = 0.25;
const MAX_SCALE = 8.0;

const zoomStep = (delta: number) => {
  let next = scale.value + delta;
  if (next < MIN_SCALE) next = MIN_SCALE;
  if (next > MAX_SCALE) next = MAX_SCALE;
  scale.value = Number(next.toFixed(2));
  if (scale.value <= 1 && delta < 0) {
    translateX.value = 0;
    translateY.value = 0;
  }
};

// 滚轮缩放处理（严格防页面穿透滚动）
const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
  let next = scale.value * zoomFactor;
  if (next < MIN_SCALE) next = MIN_SCALE;
  if (next > MAX_SCALE) next = MAX_SCALE;
  scale.value = Number(next.toFixed(2));
};

// 指针拖拽与点击判定管线
const handlePointerDown = (e: PointerEvent) => {
  if (e.button !== 0) return; // 仅限鼠标左键
  isDragging.value = true;
  hasMovedBeyondThreshold = false;

  pointerDownPos.x = e.clientX;
  pointerDownPos.y = e.clientY;
  dragStart.x = e.clientX;
  dragStart.y = e.clientY;
  dragStart.startTx = translateX.value;
  dragStart.startTy = translateY.value;

  const target = e.currentTarget as HTMLElement;
  if (target && target.setPointerCapture) {
    target.setPointerCapture(e.pointerId);
  }
};

const handlePointerMove = (e: PointerEvent) => {
  if (!isDragging.value) return;
  const deltaX = e.clientX - dragStart.x;
  const deltaY = e.clientY - dragStart.y;

  // 移动距离超过 6px 时标记为真实拖拽平移
  if (!hasMovedBeyondThreshold) {
    const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    if (dist > 6) {
      hasMovedBeyondThreshold = true;
    }
  }

  translateX.value = dragStart.startTx + deltaX;
  translateY.value = dragStart.startTy + deltaY;
};

const handlePointerUp = (e: PointerEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;
  const target = e.currentTarget as HTMLElement;
  if (target && target.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {}
  }
};

// 点击舞台：精准区分“点击图片本体”、“拖拽画布”与“点击空白背景”
const handleStageClick = (e: MouseEvent) => {
  // 1. 如果刚刚发生过拖拽，不视作点击退出
  if (hasMovedBeyondThreshold) {
    hasMovedBeyondThreshold = false;
    return;
  }

  // 2. 如果点击的是图片本身，不退出
  if (e.target === imageRef.value) {
    return;
  }

  // 3. 点击的是空白背景区域，平滑退出
  emit('close');
};

// 双击智能跳切：在“适应视口(1.0)”与“高清特写(2.4)”之间切换
const handleDoubleClick = (e: MouseEvent) => {
  // 仅双击在图片上时触发缩放切换
  if (e.target !== imageRef.value) return;
  e.stopPropagation();

  if (scale.value > 1.05 || translateX.value !== 0 || translateY.value !== 0) {
    resetView();
  } else {
    scale.value = 2.4;
  }
};

const rotateClockwise = () => {
  rotate.value = (rotate.value + 90) % 360;
};

const resetView = () => {
  scale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
  rotate.value = 0;
};

// 全局快捷键
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    zoomStep(0.25);
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    zoomStep(-0.25);
  } else if (e.key === '0') {
    e.preventDefault();
    resetView();
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    rotateClockwise();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>
