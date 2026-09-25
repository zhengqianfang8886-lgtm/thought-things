<template>
  <div v-if="type === 'empty'" class="flex flex-col items-center justify-center py-12 select-none animate-view-in">
    <svg class="w-60 h-40" viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 晨光清澈浮云 -->
      <path d="M40 50 C40 38, 56 32, 66 40 C74 28, 92 30, 98 42 C108 40, 118 48, 114 60 C88 62, 52 62, 40 50 Z" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M190 35 C190 25, 204 20, 212 26 C218 18, 232 20, 238 28 C245 26, 254 33, 250 42 C228 44, 202 44, 190 35 Z" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round"/>

      <!-- 探头晨光小熊 (明快生机) -->
      <g transform="translate(112, 50)">
        <circle cx="16" cy="18" r="8" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        <circle cx="48" cy="18" r="8" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        <ellipse cx="32" cy="36" rx="26" ry="22" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
        <circle cx="23" cy="35" r="2.2" fill="#0F172A"/>
        <circle cx="41" cy="35" r="2.2" fill="#0F172A"/>
        <ellipse cx="32" cy="39" rx="3.2" ry="2" fill="#0F172A"/>
        <ellipse cx="17" cy="40" rx="4" ry="2.5" fill="#FB7185" opacity="0.85"/>
        <ellipse cx="47" cy="40" rx="4" ry="2.5" fill="#FB7185" opacity="0.85"/>
        <ellipse cx="15" cy="56" rx="6" ry="4" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
        <ellipse cx="49" cy="56" rx="6" ry="4" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      </g>

      <!-- 鲜绿晨露茎叶 -->
      <path d="M45 140 Q45 105 50 85" stroke="#059669" stroke-width="3" stroke-linecap="round"/>
      <path d="M95 150 Q92 110 90 78" stroke="#059669" stroke-width="3" stroke-linecap="round"/>
      <path d="M142 160 Q142 125 144 95" stroke="#059669" stroke-width="3" stroke-linecap="round"/>
      <path d="M190 150 Q192 110 195 80" stroke="#059669" stroke-width="3" stroke-linecap="round"/>
      <path d="M235 140 Q232 105 230 85" stroke="#059669" stroke-width="3" stroke-linecap="round"/>

      <path d="M25 145 C20 110, 50 95, 48 85 C40 105, 38 125, 35 145 Z" fill="#86EFAC" stroke="#059669" stroke-width="2"/>
      <path d="M70 145 C65 115, 88 100, 88 88 C78 108, 80 128, 75 145 Z" fill="#86EFAC" stroke="#059669" stroke-width="2"/>
      <path d="M165 145 C170 115, 145 98, 145 88 C155 108, 155 128, 160 145 Z" fill="#86EFAC" stroke="#059669" stroke-width="2"/>
      <path d="M215 145 C220 115, 195 98, 195 88 C205 108, 208 128, 210 145 Z" fill="#86EFAC" stroke="#059669" stroke-width="2"/>
      <path d="M255 145 C260 110, 230 95, 232 85 C240 105, 242 125, 245 145 Z" fill="#86EFAC" stroke="#059669" stroke-width="2"/>

      <!-- 鲜艳粉橙郁金香花丛 -->
      <g transform="translate(32, 60)">
        <path d="M8 35 C-2 20, 0 5, 16 0 C22 15, 20 28, 18 35 Z" fill="#FB7185" stroke="#0F172A" stroke-width="2"/>
        <path d="M26 35 C36 20, 34 5, 18 0 C24 15, 22 28, 20 35 Z" fill="#FDA4AF" stroke="#0F172A" stroke-width="2"/>
        <path d="M10 33 C10 15, 26 15, 26 33 Z" fill="#FFF1F2" stroke="#0F172A" stroke-width="1.8"/>
      </g>
      <g transform="translate(73, 50)">
        <path d="M8 38 C-2 22, 0 6, 18 0 C24 17, 22 30, 20 38 Z" fill="#FB923C" stroke="#0F172A" stroke-width="2"/>
        <path d="M28 38 C38 22, 36 6, 18 0 C26 17, 24 30, 22 38 Z" fill="#FDBA74" stroke="#0F172A" stroke-width="2"/>
        <path d="M11 36 C11 17, 28 17, 28 36 Z" fill="#FFF7ED" stroke="#0F172A" stroke-width="1.8"/>
      </g>
      <g transform="translate(130, 70)">
        <path d="M6 30 C-2 18, 0 5, 14 0 C19 13, 17 24, 15 30 Z" fill="#FB7185" stroke="#0F172A" stroke-width="2"/>
        <path d="M22 30 C30 18, 28 5, 14 0 C20 13, 19 24, 17 30 Z" fill="#FDA4AF" stroke="#0F172A" stroke-width="2"/>
        <path d="M9 28 C9 14, 21 14, 21 28 Z" fill="#FFF1F2" stroke="#0F172A" stroke-width="1.8"/>
      </g>
      <g transform="translate(178, 52)">
        <path d="M8 38 C-2 22, 0 6, 18 0 C24 17, 22 30, 20 38 Z" fill="#38BDF8" stroke="#0F172A" stroke-width="2"/>
        <path d="M28 38 C38 22, 36 6, 18 0 C26 17, 24 30, 22 38 Z" fill="#7DD3FC" stroke="#0F172A" stroke-width="2"/>
        <path d="M11 36 C11 17, 28 17, 28 36 Z" fill="#F0F9FF" stroke="#0F172A" stroke-width="1.8"/>
      </g>
      <g transform="translate(215, 62)">
        <path d="M8 35 C-2 20, 0 5, 16 0 C22 15, 20 28, 18 35 Z" fill="#FB7185" stroke="#0F172A" stroke-width="2"/>
        <path d="M26 35 C36 20, 34 5, 18 0 C24 15, 22 28, 20 35 Z" fill="#FDA4AF" stroke="#0F172A" stroke-width="2"/>
        <path d="M10 33 C10 15, 26 15, 26 33 Z" fill="#FFF1F2" stroke="#0F172A" stroke-width="1.8"/>
      </g>
    </svg>
    <p class="text-xs font-bold tracking-wide mt-3 text-[#0F172A]">晨光花海里暂未长出年轮记录</p>
    <p class="text-[11px] mt-0.5 text-[#64748B]">在左侧开启第一条灵动认知采撷吧 🌱</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  type?: "empty" | "corner";
}>();
</script>
