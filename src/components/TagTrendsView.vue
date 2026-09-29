<template>
  <!-- 全局容器：统一标准内外边距 (pt-3 sm:pt-4 px-6 sm:px-8 pb-5) -->
  <div class="flex-1 min-h-0 w-full px-6 sm:px-8 pt-3 sm:pt-4 pb-5 flex flex-col overflow-hidden max-w-7xl mx-auto select-none">
    
    <!-- 1. 全局轻量时间基准带 (设置相对定位与 z-30，杜绝下层卡片穿透) -->
    <div class="shrink-0 relative z-30 flex items-center justify-between pb-3 mb-3 border-b border-emerald-950/[0.06] text-xs">
      
      <!-- 左侧：时间周期滑块 -->
      <div class="flex items-center gap-2.5">
        <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">分析周期:</span>
        <div class="flex items-center p-0.5 rounded-full border border-emerald-950/[0.06] bg-slate-100/90 shadow-inner">
          <button 
            v-for="preset in [
              { label: '7天', days: 7 },
              { label: '14天', days: 14 },
              { label: '30天', days: 30 },
              { label: '90天', days: 90 },
              { label: '半年', days: 180 }
            ]"
            :key="preset.days"
            @click="selectTimeWindow(preset.days)"
            class="px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
            :class="!isCustomMode && selectedDays === preset.days ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
          >
            {{ preset.label }}
          </button>
          
          <button 
            @click="enableCustomMode"
            class="px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
            :class="isCustomMode ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
          >
            <span>📅 自定义</span>
          </button>
        </div>

        <!-- 自研翡翠质感日期选择胶囊与气泡 -->
        <div v-if="isCustomMode" class="relative flex items-center gap-1.5 animate-fade-in">
          <button 
            type="button"
            @click="toggleCalendarPicker"
            class="flex items-center gap-2 px-3 py-1 rounded-full bg-white hover:bg-emerald-50/60 border border-emerald-300 text-slate-800 text-xs font-mono font-semibold shadow-2xs transition active:scale-95 cursor-pointer"
          >
            <span class="text-[11px] text-emerald-700">📅</span>
            <span>{{ customStartDate }}</span>
            <span class="text-slate-400 font-sans">至</span>
            <span>{{ customEndDate }}</span>
            <span class="text-[9px] text-slate-400">▾</span>
          </button>

          <!-- 优雅统一的翡翠日历弹窗 (防穿透实体填充与孤立层叠) -->
          <div 
            v-if="isCalendarPickerOpen"
            class="absolute top-full left-0 mt-2.5 z-[100] p-4 rounded-3xl bg-white border border-emerald-900/15 shadow-[0_20px_50px_rgba(0,0,0,0.18)] flex flex-col gap-2.5 w-[290px] animate-pop select-none isolate"
            style="background-color: #FFFFFF !important;"
            @click.stop
          >
            <!-- 头部月份与年份切换 -->
            <div class="flex items-center justify-between px-1">
              <span class="text-xs font-extrabold text-slate-800 font-mono tracking-tight">
                {{ viewYear }} 年 {{ viewMonth + 1 }} 月
              </span>
              <div class="flex items-center gap-1">
                <button 
                  type="button" 
                  @click="prevMonth"
                  class="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center text-xs text-slate-500 cursor-pointer"
                >
                  ‹
                </button>
                <button 
                  type="button" 
                  @click="nextMonth"
                  class="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center text-xs text-slate-500 cursor-pointer"
                >
                  ›
                </button>
              </div>
            </div>

            <!-- 星期指示行 -->
            <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400">
              <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span class="text-emerald-800">六</span><span class="text-emerald-800">日</span>
            </div>

            <!-- 天数矩阵 (翡翠主题圆圈) -->
            <div class="grid grid-cols-7 gap-1 text-center">
              <button 
                v-for="day in calendarDays" 
                :key="day.dateStr"
                type="button"
                @click="onSelectCalendarDate(day.dateStr)"
                :disabled="!day.isCurrentMonth"
                class="h-7 w-7 mx-auto rounded-full text-xs font-mono flex items-center justify-center transition-all cursor-pointer"
                :class="[
                  !day.isCurrentMonth ? 'text-slate-300 pointer-events-none' : 'hover:bg-emerald-50 text-slate-700',
                  isDateSelectedStart(day.dateStr) ? 'bg-emerald-600 !text-white font-bold shadow-2xs' : '',
                  isDateSelectedEnd(day.dateStr) ? 'bg-emerald-600 !text-white font-bold shadow-2xs' : '',
                  isDateInRange(day.dateStr) ? 'bg-emerald-100 text-emerald-950 rounded-none' : ''
                ]"
              >
                {{ day.dayNum }}
              </button>
            </div>

            <!-- 底部快捷操作条 (舒适内边距与实体按钮) -->
            <div class="flex items-center justify-between pt-2.5 mt-1 border-t border-slate-100 text-[11px] shrink-0">
              <span class="text-emerald-800 font-semibold flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>{{ selectingStep === 'start' ? '请点选起始日' : '请点选截止日' }}</span>
              </span>
              <button 
                type="button" 
                @click="isCalendarPickerOpen = false"
                class="h-7 px-3.5 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs cursor-pointer transition active:scale-95 shadow-xs"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：动态情报摘要 (优雅填补，信息量充足) -->
      <div class="flex items-center gap-2 font-mono text-slate-500">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span>{{ isCustomMode ? `区间内 (${selectedDays}天)` : `近 ${selectedDays} 天` }}已收录 <strong class="text-slate-800 font-bold">{{ analyticsData.total_recent_quotes }}</strong> 篇手记</span>
        <span class="text-slate-300">/</span>
        <span><strong class="text-slate-800 font-bold">{{ sortedTrendsList.length }}</strong> 个激增焦点</span>
      </div>
    </div>

    <!-- 2. 主体双栏架构 (左 60% 主舞台，右 40% 穿透视窗) -->
    <div class="flex-1 min-h-0 flex gap-4 sm:gap-5 overflow-hidden">
      
      <!-- 左栏：主舞台 (控制器内聚到卡片顶栏，在 60% 宽度内排版天然完美) -->
      <section class="flex-1 flex flex-col h-full min-h-0 rounded-3xl bg-white border border-emerald-950/[0.08] shadow-sm p-4 sm:p-5 gap-3.5 overflow-hidden">
        
        <!-- 卡片内嵌顶栏：性质透镜 ↔ 排序与视图 (在卡片内自成一体，比例协调) -->
        <div class="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 text-xs">
          
          <!-- 手记性质分段器 -->
          <div class="flex items-center p-0.5 rounded-full border border-emerald-950/[0.06] bg-slate-100/90 shadow-inner">
            <button 
              @click="selectEntryType('all')"
              class="px-2.5 py-1 rounded-full font-bold transition cursor-pointer"
              :class="selectedEntryType === 'all' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              全部手记
            </button>
            <button 
              @click="selectEntryType(0)"
              class="px-2.5 py-1 rounded-full font-bold transition cursor-pointer flex items-center gap-1"
              :class="selectedEntryType === 0 ? 'bg-white text-emerald-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              📖 摘录
            </button>
            <button 
              @click="selectEntryType(2)"
              class="px-2.5 py-1 rounded-full font-bold transition cursor-pointer flex items-center gap-1"
              :class="selectedEntryType === 2 ? 'bg-white text-indigo-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              💡 感悟
            </button>
            <button 
              @click="selectEntryType(1)"
              class="px-2.5 py-1 rounded-full font-bold transition cursor-pointer flex items-center gap-1"
              :class="selectedEntryType === 1 ? 'bg-white text-amber-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
            >
              ❓ 问题
            </button>
          </div>

          <!-- 右侧紧凑小工具：排序与条形图切换 -->
          <div class="flex items-center gap-2">
            <!-- 排序 -->
            <div class="flex items-center p-0.5 rounded-full border border-emerald-950/[0.06] bg-slate-100/90 shadow-inner">
              <button 
                type="button"
                @click="sortMode = 'count'"
                class="px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer"
                :class="sortMode === 'count' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
              >
                篇数榜
              </button>
              <button 
                type="button"
                @click="sortMode = 'momentum'"
                class="px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer"
                :class="sortMode === 'momentum' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-500 hover:text-slate-900'"
              >
                飙升榜
              </button>
            </div>

            <!-- 视图 -->
            <div class="flex items-center p-0.5 rounded-full border border-emerald-950/[0.06] bg-slate-100/90 shadow-inner">
              <button 
                type="button" 
                @click="chartViewMode = 'bar'"
                title="条形图"
                class="px-2 py-1 rounded-full text-xs font-bold transition-all cursor-pointer"
                :class="chartViewMode === 'bar' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-400 hover:text-slate-800'"
              >
                📊
              </button>
              <button 
                type="button" 
                @click="chartViewMode = 'card'"
                title="卡片榜"
                class="px-2 py-1 rounded-full text-xs font-bold transition-all cursor-pointer"
                :class="chartViewMode === 'card' ? 'bg-white text-emerald-950 shadow-2xs' : 'text-slate-400 hover:text-slate-800'"
              >
                📋
              </button>
            </div>
          </div>

        </div>

        <!-- 紧凑指标三宫格 -->
        <div class="grid grid-cols-3 gap-2.5">
          <div class="px-3.5 py-2.5 rounded-2xl bg-slate-50/90 border border-slate-200/70 flex flex-col gap-0.5">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">本期手记</span>
            <span class="text-lg sm:text-xl font-extrabold text-slate-800 font-mono">{{ analyticsData.total_recent_quotes }} 篇</span>
          </div>
          <div class="px-3.5 py-2.5 rounded-2xl bg-emerald-50/50 border border-emerald-200/70 flex flex-col gap-0.5">
            <span class="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">活跃激增标签</span>
            <span class="text-lg sm:text-xl font-extrabold text-emerald-950 font-mono">{{ sortedTrendsList.length }} 个</span>
          </div>
          <div class="px-3.5 py-2.5 rounded-2xl bg-amber-50/50 border border-amber-200/70 flex flex-col gap-0.5">
            <span class="text-[10px] font-bold text-amber-800 uppercase tracking-wider">首要思考焦点</span>
            <span class="text-xs sm:text-sm font-extrabold text-amber-950 font-mono mt-0.5 truncate">
              {{ sortedTrendsList[0] ? `#${sortedTrendsList[0].name}` : '暂无显著焦点' }}
            </span>
          </div>
        </div>

        <!-- 极简注意力光谱条 (纤细微光) -->
        <div v-if="sortedTrendsList.length > 0" class="p-2.5 rounded-2xl bg-slate-50/60 border border-slate-200/60 flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-[10.5px] font-bold text-slate-500 px-0.5">
            <span>注意力光谱分布 (Top 5 核心焦点占比)</span>
            <span class="font-mono text-slate-400">{{ topFiveCoverageRatio }}% 覆盖率</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-slate-200/60 overflow-hidden flex">
            <div 
              v-for="(item, idx) in sortedTrendsList.slice(0, 5)"
              :key="'spectrum_' + item.id"
              :style="{ 
                width: `${item.ratio}%`, 
                backgroundColor: getPaletteColor(idx)
              }"
              :title="`#${item.name}: 占 ${item.ratio}%`"
              class="h-full hover:opacity-80 transition-all cursor-pointer"
              @click="activeTag = item.name"
            ></div>
          </div>
        </div>

        <!-- 条形图与卡片流列表 -->
        <div class="flex-1 min-h-0 stable-scroll overflow-y-auto pr-1 flex flex-col gap-2">
          
          <div v-if="isLoading" class="py-16 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <span class="text-2xl animate-spin">⏳</span>
            <span>正在分析全库年轮数据...</span>
          </div>

          <div v-else-if="sortedTrendsList.length === 0" class="py-16 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <span class="text-3xl">🍃</span>
            <span>当前筛选条件下暂无手记数量提升</span>
            <span class="text-[11px] text-slate-400">尝试切换为“全部手记”或拉长统计周期 🌱</span>
          </div>

          <!-- 现代顶天立地柱状天际线模式 (Full-Height Skyline Chart) -->
          <div 
            v-else-if="chartViewMode === 'bar'" 
            class="flex-1 min-h-[360px] h-full flex flex-col justify-between p-5 rounded-3xl bg-slate-50/70 border border-slate-200/80 overflow-hidden relative select-none"
          >
            <!-- 顶栏标尺刻度说明 -->
            <div class="shrink-0 flex items-center justify-between pb-2 border-b border-slate-200/80 text-xs">
              <div class="flex items-center gap-2">
                <span class="font-mono font-bold text-slate-700 text-xs">📈 增长峰值: <strong class="text-emerald-700">{{ maxBarCount }}</strong> 篇</span>
                <span class="text-[11px] font-mono text-slate-400">/ 均值: {{ Math.round(maxBarCount / 2) }} 篇</span>
              </div>
              <span class="text-[11px] font-mono text-slate-400">点击任意柱体联动穿透右侧手记</span>
            </div>

            <!-- 主图表绘制区：自适应撑满全部垂直空间 -->
            <div class="flex-1 min-h-0 relative my-3 flex flex-col justify-end">
              
              <!-- 1. 绝对定位标尺虚线 (与最高柱体绝对几何贴合) -->
              <div class="absolute inset-x-0 top-3 bottom-0 flex flex-col justify-between pointer-events-none opacity-50 z-0">
                <!-- 顶峰参考线 -->
                <div class="w-full border-b border-dashed border-emerald-500/40 flex items-center justify-end pr-1">
                  <span class="font-mono text-[10px] text-emerald-800 bg-white/80 px-1 rounded shadow-2xs font-bold">MAX {{ maxBarCount }}</span>
                </div>
                <!-- 50% 参考线 -->
                <div class="w-full border-b border-dashed border-slate-300 flex items-center justify-end pr-1">
                  <span class="font-mono text-[10px] text-slate-400 bg-white/80 px-1 rounded">MID {{ Math.round(maxBarCount / 2) }}</span>
                </div>
                <!-- 地平基准线 (实体稳固) -->
                <div class="w-full border-b-2 border-slate-300/80"></div>
              </div>

              <!-- 2. 横向滚动立柱群 (地平线对齐，撑满高度) -->
              <div class="relative z-10 w-full h-full overflow-x-auto stable-scroll flex items-end gap-4 sm:gap-6 px-4 pb-0 pt-6">
                
                <div 
                  v-for="(item, index) in sortedTrendsList" 
                  :key="item.id"
                  @click="activeTag = item.name"
                  class="group/col flex flex-col items-center h-full justify-end cursor-pointer shrink-0 transition-transform active:scale-95 relative"
                  :style="{ width: '42px' }"
                  :title="`#${item.name}: 本期新增 ${item.current_count} 篇`"
                >
                  <!-- 柱顶极简微标 (单层一体化，杜绝双层药丸) -->
                  <div 
                    class="flex flex-col items-center gap-0.5 mb-1.5 transition-all duration-200"
                    :class="activeTag === item.name ? '-translate-y-1 scale-110' : 'group-hover/col:-translate-y-0.5'"
                  >
                    <span 
                      v-if="item.delta > 0" 
                      class="text-[9.5px] font-mono font-extrabold text-emerald-800 leading-none tracking-tight flex items-center gap-0.5"
                    >
                      <span class="text-[8px]">▲</span>+{{ item.delta }}
                    </span>
                    <span 
                      class="font-mono font-extrabold text-xs transition-colors leading-none mt-0.5"
                      :class="activeTag === item.name ? 'text-slate-900 font-black' : 'text-slate-600'"
                    >
                      {{ item.current_count }}
                    </span>
                  </div>

                  <!-- 柱身实体 (顶天立地高度计算 + 纯正柱体平底扎实结构) -->
                  <div 
                    class="w-8 rounded-t-[8px] rounded-b-none relative transition-all duration-300 flex flex-col justify-between overflow-hidden shadow-sm"
                    :style="{ 
                      /* 核心修复：最高柱子撑满 92% 垂直高度，彻底消除矮矬悬空感 */
                      height: `${Math.max(24, Math.round((item.current_count / maxBarCount) * 88))}%`,
                      background: getBarGradient(index),
                      boxShadow: activeTag === item.name 
                        ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${getPaletteColor(index)}, 0 10px 20px -2px ${getPaletteColor(index)}66` 
                        : `0 4px 12px -2px ${getPaletteColor(index)}33`,
                      opacity: activeTag === item.name ? 1 : 0.85
                    }"
                  >
                    <!-- 柱顶光感切面 -->
                    <div class="w-full h-1 bg-white/40"></div>

                    <!-- 柱内微光条 (大柱才显示，增加立体感) -->
                    <div class="w-full text-center pb-1 pointer-events-none opacity-40 text-white font-mono text-[9px] font-bold hidden sm:block">
                      {{ item.ratio }}%
                    </div>
                  </div>

                  <!-- 柱底基座标签名 (稳扎地平线之下) -->
                  <div class="mt-2.5 flex flex-col items-center gap-0.5 w-full select-none">
                    <span 
                      class="w-2 h-2 rounded-full shrink-0 shadow-2xs transition-transform group-hover/col:scale-125"
                      :style="{ backgroundColor: getPaletteColor(index) }"
                    ></span>
                    <span 
                      class="text-[11.5px] font-mono font-bold truncate max-w-full text-center transition-colors"
                      :class="activeTag === item.name ? 'text-slate-900 font-extrabold underline decoration-2' : 'text-slate-600 group-hover/col:text-slate-900'"
                    >
                      {{ item.name.split('/').pop() }}
                    </span>
                  </div>
                </div>

              </div>
            </div>

            <!-- 底栏数据摘要 -->
            <div class="shrink-0 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>📊 纵轴真实柱高映射手记激增量 · 横向排布当前活跃焦点</span>
              <span class="font-mono">共展示前 {{ sortedTrendsList.length }} 根脉动立柱</span>
            </div>
          </div>

          <!-- 卡片榜单模式 -->
          <template v-else>
            <div 
              v-for="(item, index) in sortedTrendsList" 
              :key="item.id"
              @click="activeTag = item.name"
              class="group p-3 rounded-2xl border transition-all duration-150 cursor-pointer flex flex-col gap-2"
              :class="activeTag === item.name 
                ? 'border-emerald-500/80 bg-emerald-50/40 shadow-xs ring-1 ring-emerald-400/20' 
                : 'border-slate-200/70 bg-slate-50/40 hover:bg-slate-50 hover:border-emerald-200'"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0">
                  <span 
                    class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono font-bold shrink-0"
                    :class="index === 0 ? 'bg-amber-400 text-amber-950' : (index === 1 ? 'bg-slate-300 text-slate-800' : (index === 2 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-500'))"
                  >
                    {{ index + 1 }}
                  </span>

                  <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: getPaletteColor(index) }"></span>
                  <span class="text-xs font-bold text-slate-800 font-mono truncate">#{{ item.name }}</span>

                  <span v-if="item.momentum === 'new'" class="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold">新萌发</span>
                  <span v-else-if="item.momentum === 'surging'" class="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-800 font-bold">飙升</span>
                </div>

                <div class="flex items-center gap-2 font-mono text-xs">
                  <span class="font-extrabold text-emerald-700 bg-emerald-100/80 px-2 py-0.2 rounded-full">+{{ item.current_count }} 篇</span>
                  <span class="text-[10.5px] text-slate-400">总计 {{ item.total_count }}</span>
                </div>
              </div>

              <!-- 进度条 -->
              <div class="flex items-center gap-2 pt-0.5">
                <div class="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div 
                    class="h-full rounded-full transition-all duration-500"
                    :style="{ 
                      width: `${Math.min(100, Math.max(4, (item.current_count / maxBarCount) * 100))}%`,
                      background: getBarGradient(index)
                    }"
                  ></div>
                </div>
                <span class="text-[10px] font-mono text-slate-400 shrink-0">占 {{ item.ratio }}%</span>
              </div>
            </div>
          </template>

        </div>
      </section>

      <!-- 右栏：近期手记脉络穿透视窗 (40% 宽度，自成一体) -->
      <aside class="w-[360px] lg:w-[400px] shrink-0 flex flex-col h-full min-h-0 rounded-3xl bg-white border border-emerald-950/[0.08] shadow-sm p-4 sm:p-5 gap-3.5 overflow-hidden">
        
        <div class="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-xs font-bold text-slate-700">近期思考实况:</span>
            <span v-if="activeTag" class="text-xs font-extrabold text-emerald-800 font-mono truncate">#{{ activeTag }}</span>
          </div>

          <button 
            v-if="activeTag"
            @click="emit('filter-tag-in-archive', activeTag)"
            class="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer shrink-0"
          >
            在主轴查看全部 ➔
          </button>
        </div>

        <!-- 关联卡片列表 -->
        <div class="flex-1 min-h-0 stable-scroll overflow-y-auto pr-1 flex flex-col gap-2.5">
          <div v-if="isRelatedLoading" class="py-20 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <span class="animate-spin text-lg">⏳</span>
            <span>正在穿透加载关联手记...</span>
          </div>
          <div v-else-if="relatedQuotesInWindow.length === 0" class="py-20 text-center text-slate-400 text-xs flex flex-col items-center gap-1">
            <span class="text-xl">🍃</span>
            <span>暂无匹配的近期手记</span>
          </div>

          <article 
            v-for="card in relatedQuotesInWindow"
            :key="card.id"
            @click="emit('jump-to-quote', card.id)"
            class="p-3.5 rounded-2xl border border-slate-200/70 bg-slate-50/40 hover:bg-emerald-50/30 hover:border-emerald-300 transition-all duration-150 cursor-pointer flex flex-col gap-1.5 group select-text"
            title="点击跳转至此篇手记"
          >
            <div class="flex items-center justify-between text-[10.5px]">
              <div class="flex items-center gap-1.5">
                <span 
                  class="px-1.5 py-0.2 rounded text-[10px] font-bold border"
                  :class="card.is_question === 1 ? 'bg-amber-50 text-amber-800 border-amber-200' : (card.is_question === 2 ? 'bg-indigo-50 text-indigo-800 border-indigo-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200')"
                >
                  {{ card.is_question === 1 ? '问题' : (card.is_question === 2 ? '感悟' : '摘录') }}
                </span>
                <span class="font-mono text-slate-400">{{ formatShortDate(card.created_at) }}</span>
              </div>
              <span class="text-emerald-700 font-bold group-hover:translate-x-0.5 transition-transform text-[11px]">定位 ➔</span>
            </div>

            <p class="text-xs text-slate-700 leading-relaxed font-serif line-clamp-3">
              {{ stripHtml(card.content) }}
            </p>

            <div v-if="card.source" class="text-[10px] text-slate-400 italic truncate font-serif">
              —— {{ card.source }}
            </div>
          </article>
        </div>

      </aside>

    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { invoke } from '../ipc-bridge';
import type { QuoteDetail } from '../types';

const props = defineProps<{
  quotes: QuoteDetail[];
  getTagDotColor: (name: string) => string;
}>();

const emit = defineEmits<{
  (e: 'jump-to-quote', id: string): void;
  (e: 'filter-tag-in-archive', tagName: string): void;
}>();

const selectedDays = ref<number>(7);
const selectedEntryType = ref<'all' | number>('all');
const sortMode = ref<'count' | 'momentum'>('count');
const chartViewMode = ref<'bar' | 'card'>('bar');
const isLoading = ref<boolean>(true);

// 自定义自由时间跨度状态
const isCustomMode = ref<boolean>(false);
const formatInputDate = (d: Date) => d.toISOString().slice(0, 10);
const todayStr = formatInputDate(new Date());
const thirtyDaysAgoStr = formatInputDate(new Date(Date.now() - 30 * 86400000));
const customStartDate = ref<string>(thirtyDaysAgoStr);
const customEndDate = ref<string>(todayStr);

// ----------------- 自研翡翠日历弹窗控制系统 -----------------
const isCalendarPickerOpen = ref<boolean>(false);
const viewYear = ref<number>(new Date().getFullYear());
const viewMonth = ref<number>(new Date().getMonth());
const selectingStep = ref<'start' | 'end'>('start');

const toggleCalendarPicker = () => {
  isCalendarPickerOpen.value = !isCalendarPickerOpen.value;
  if (isCalendarPickerOpen.value) {
    selectingStep.value = 'start';
    const sDate = new Date(customStartDate.value);
    if (!isNaN(sDate.getTime())) {
      viewYear.value = sDate.getFullYear();
      viewMonth.value = sDate.getMonth();
    }
  }
};

const prevMonth = () => {
  if (viewMonth.value === 0) {
    viewMonth.value = 11;
    viewYear.value--;
  } else {
    viewMonth.value--;
  }
};

const nextMonth = () => {
  if (viewMonth.value === 11) {
    viewMonth.value = 0;
    viewYear.value++;
  } else {
    viewMonth.value++;
  }
};

const calendarDays = computed(() => {
  const year = viewYear.value;
  const month = viewMonth.value;

  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7; // 周一为 0
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  const days: Array<{ dayNum: number; dateStr: string; isCurrentMonth: boolean }> = [];

  // 补齐上月尾巴
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthTotalDays - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ dayNum: d, dateStr, isCurrentMonth: false });
  }

  // 当月天数
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ dayNum: d, dateStr, isCurrentMonth: true });
  }

  // 关键优化：自适应收敛，5行(35格)能排完就绝不多排第6行，彻底杜绝高度溢出
  const targetCells = days.length > 35 ? 42 : 35;
  const remaining = targetCells - days.length;
  for (let d = 1; d <= remaining; d++) {
    const m = month === 11 ? 1 : month + 2;
    const y = month === 11 ? year + 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ dayNum: d, dateStr, isCurrentMonth: false });
  }

  return days;
});

const isDateSelectedStart = (dateStr: string) => customStartDate.value === dateStr;
const isDateSelectedEnd = (dateStr: string) => customEndDate.value === dateStr;
const isDateInRange = (dateStr: string) => {
  return dateStr > customStartDate.value && dateStr < customEndDate.value;
};

const onSelectCalendarDate = (dateStr: string) => {
  if (selectingStep.value === 'start') {
    customStartDate.value = dateStr;
    selectingStep.value = 'end';
  } else {
    if (dateStr < customStartDate.value) {
      customEndDate.value = customStartDate.value;
      customStartDate.value = dateStr;
    } else {
      customEndDate.value = dateStr;
    }
    selectingStep.value = 'start';
    applyCustomRange();
  }
};

// 莫兰迪色系（自然、雅致）
const PALETTE = [
  '#059669', // 翡翠绿
  '#4F46E5', // 暮山紫
  '#D97706', // 琥珀黄
  '#0284C7', // 石青蓝
  '#E11D48', // 胭脂红
  '#0D9488', // 墨松绿
  '#7C3AED', // 黛紫
  '#EA580C', // 珊瑚橙
];

const getPaletteColor = (index: number) => {
  return PALETTE[index % PALETTE.length];
};

const getBarGradient = (index: number) => {
  const c = getPaletteColor(index);
  return `linear-gradient(90deg, ${c}EE 0%, ${c}AA 100%)`;
};

const analyticsData = ref<{
  time_window_days: number;
  total_recent_quotes: number;
  trends: Array<{
    id: number;
    name: string;
    current_count: number;
    prev_count: number;
    total_count: number;
    delta: number;
    momentum: string;
    ratio: number;
    quote_count?: number;
    insight_count?: number;
    question_count?: number;
  }>;
}>({
  time_window_days: 7,
  total_recent_quotes: 0,
  trends: []
});

const activeTag = ref<string | null>(null);

const sortedTrendsList = computed(() => {
  const list = [...(analyticsData.value?.trends || [])];
  if (sortMode.value === 'momentum') {
    return list.sort((a, b) => b.delta - a.delta || b.current_count - a.current_count);
  }
  return list.sort((a, b) => b.current_count - a.current_count);
});

const maxBarCount = computed(() => {
  if (sortedTrendsList.value.length === 0) return 1;
  return Math.max(1, sortedTrendsList.value[0].current_count);
});

const topFiveCoverageRatio = computed(() => {
  const top5 = sortedTrendsList.value.slice(0, 5);
  const sum = top5.reduce((acc, cur) => acc + cur.ratio, 0);
  return Math.min(100, sum);
});

const loadTrends = async () => {
  isLoading.value = true;
  try {
    const payload: any = {
      entryType: selectedEntryType.value,
      limit: 20 
    };

    if (isCustomMode.value && customStartDate.value && customEndDate.value) {
      const s = new Date(customStartDate.value + "T00:00:00").getTime();
      const e = new Date(customEndDate.value + "T23:59:59.999").getTime();
      payload.startTs = s;
      payload.endTs = e;
      selectedDays.value = Math.max(1, Math.round((e - s) / 86400000));
    } else {
      payload.days = selectedDays.value;
    }

    const res = await invoke('get_tag_trends_analytics', payload);
    if (res && Array.isArray(res.trends)) {
      analyticsData.value = res;
      if (res.trends.length > 0) {
        if (!activeTag.value || !res.trends.some((t: any) => t.name === activeTag.value)) {
          activeTag.value = res.trends[0].name;
        }
      } else {
        activeTag.value = null;
      }
    } else {
      analyticsData.value = {
        time_window_days: selectedDays.value,
        total_recent_quotes: 0,
        trends: []
      };
      activeTag.value = null;
    }
  } catch (e) {
    console.error('加载脉动趋势失败:', e);
  } finally {
    isLoading.value = false;
  }
};

const selectTimeWindow = (days: number) => {
  isCustomMode.value = false;
  selectedDays.value = days;
  loadTrends();
};

const enableCustomMode = () => {
  isCustomMode.value = true;
  applyCustomRange();
};

const applyCustomRange = () => {
  if (customStartDate.value && customEndDate.value) {
    if (customStartDate.value > customEndDate.value) {
      customStartDate.value = customEndDate.value;
    }
    loadTrends();
  }
};

const selectEntryType = (type: 'all' | number) => {
  selectedEntryType.value = type;
  loadTrends();
};

import { watch } from 'vue';
watch([activeTag, selectedDays, selectedEntryType, customStartDate, customEndDate, isCustomMode], () => {
  fetchRelatedQuotes();
});

// 右侧手记列表：直连 SQLite 后端，彻底解除 props.quotes 分页条数限制导致的右侧空白问题
const relatedQuotesInWindow = ref<QuoteDetail[]>([]);
const isRelatedLoading = ref<boolean>(false);

const fetchRelatedQuotes = async () => {
  if (!activeTag.value) {
    relatedQuotesInWindow.value = [];
    return;
  }

  isRelatedLoading.value = true;
  try {
    let startTs = Date.now() - selectedDays.value * 86400000;
    let endTs = Date.now();
    if (isCustomMode.value && customStartDate.value && customEndDate.value) {
      startTs = new Date(customStartDate.value + "T00:00:00").getTime();
      endTs = new Date(customEndDate.value + "T23:59:59.999").getTime();
    }

    const payload: any = {
      tag: activeTag.value,
      entryType: selectedEntryType.value,
      startTs,
      endTs,
      limit: 60
    };

    const res = await invoke('get_quotes', payload);
    const items = Array.isArray(res) ? res : (res?.items || []);
    relatedQuotesInWindow.value = items;
  } catch (err) {
    console.error('穿透加载关联手记失败:', err);
    relatedQuotesInWindow.value = [];
  } finally {
    isRelatedLoading.value = false;
  }
};

const stripHtml = (raw: string): string => {
  if (!raw) return '';
  return raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
};

const formatShortDate = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

onMounted(() => {
  loadTrends();
});
</script>
