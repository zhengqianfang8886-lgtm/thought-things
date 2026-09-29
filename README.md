# 🌲 ThoughtRings (思维年轮)

> **终生思维年轮与知识手记管理系统 · 本地优先 · 认知漫卷**

ThoughtRings 是一款围绕**“客观原句初芯”**与在其上逐层生长蔓延的**“思维年轮（Thought Rings）”**展开的桌面级认知管理工具。它融合了现代出版级水彩排版、格式塔色彩认知心理学、苹果流体阻尼交互与 SQLite 本地零延迟物理引擎。

---

## ✨ 核心哲学与架构特性

* **🌱 原句初芯与思维年轮**：每条手记以“客观摘录/原生感悟/待解之问”为起点，日后每一次重逢复读与认知演进，都化为最外围的一层新轮，自动计算沉淀时光（“+N 天沉淀”）。
* **🏷️ 色彩群岛标签体系**：基于黄金分割角（137.5°）离散色相，同域父级标签色彩绝对固化，子标签微差衍生，300+ 标签无需逐字阅读即可余光秒选。
* **🍏 苹果流体阻尼交互 (Apple Fluid Glider)**：顶栏导航与记录台三态分段器内置物理动量引擎（`cubic-bezier(0.2, 0.95, 0.3, 1)`），实体白玉滑块贴地穿梭，按压自带果冻微回弹。
* **🔗 真实原子级双链引用**：富文本内联嵌入 TipTap 原生 `quoteRef` 胶囊，后台自动维护有向图拓扑，支持毫秒级反向链接溯源与连续跳转回退 HUD。
* **📊 脉动天际线看板**：纵向立体水彩立柱天际线，自底向上拔地而起，直观呈现近期思考增长峰值与认知注意力光谱分布。
* **🛡️ 本地优先与安全盾**：基于 `better-sqlite3`（WAL 模式 + 事务强一致性），提供 100,000 轮 PBKDF2 强加密会话、长效撤销栈（Ctrl+Z 瞬间复原物理删改）与物理热快照。

---

## 🖥️ 平台支持与安装指南

### 1. Linux (适配 Ubuntu 24.04 LTS 及更高版本)

> **注意 (Ubuntu 24.04+)**：由于系统默认采用 fuse3，运行 AppImage 需先确保具备兼容运行库：
> ```bash
> sudo apt update
> sudo apt install -y libfuse2t64
> ```

* **方式 A：AppImage (绿色免安装，推荐)**
  ```bash
  chmod +x ThoughtRings-*.AppImage
  ./ThoughtRings-*.AppImage
方式 B：.deb (原生包安装)
code
Bash
sudo dpkg -i thought-rings_*_amd64.deb
# 若提示依赖缺失，执行自动修复：
sudo apt-get install -f
2. Windows (Windows 10 / 11)
安装版：运行 ThoughtRings Setup *.exe，跟随向导安装，自带自动桌面快捷方式。
便携版：运行 ThoughtRings *.exe，纯绿色单文件，放在 U 盘随身携带。
3. macOS (Apple Silicon M系列 & Intel)
双击打开 ThoughtRings-*.dmg，将应用图标拖动至 Applications 目录即可。
⌨️ 效率极客全键盘指南
快捷键 (Windows/Linux)	快捷键 (macOS)	触发动作
Ctrl + 1	⌘ + 1	瞬切到 ✍️ 记录 工作台
Ctrl + 2	⌘ + 2	瞬切到 📜 年轮 归档主轴
Ctrl + 3	⌘ + 3	瞬切到 🌟 常看 聚焦看板
Ctrl + 4	⌘ + 4	瞬切到 📈 脉动 激增看板
Ctrl + Enter	⌘ + Enter	保存当前手记 / 沉浸模态提交
Ctrl + Z	⌘ + Z	桌面级撤销（长效撤销误删手记/年轮）
Ctrl + \	⌘ + \	快速展开/收起左侧分类目录
Alt + ←	⌘ + [	跨卡片双链引用后原路跳回上一步
Ctrl + L	⌘ + L	立即防窥锁屏
Ctrl + = / - / 0	⌘ + = / - / 0	动态缩放全局字号 (大字/紧凑/重置)
Esc	Esc	退出专注模式 / 关闭任意弹窗 / 清除预览
🛠️ 本地开发与手动构建
本项目采用 Vite + Vue 3 + TypeScript + TailwindCSS + Electron + better-sqlite3 架构。
依赖环境
Node.js: >= 20.0.0
Python: 3.x
Linux (Ubuntu 24.04+) 构建工具：
code
Bash
sudo apt-get install -y build-essential libarchive-tools libfuse2t64
快速启动
code
Bash
# 1. 安装项目依赖 (自动编译原生 SQLite C++ 模块)
npm install

# 2. 启动 Vite 热更新服务 + Electron 调试窗口
npm run start
# 或分步执行：
# 终端1: npm run dev
# 终端2: npm run electron:dev
本地编译打包
code
Bash
# 编译前端并生成当前平台的安装包产物 (输出至 release/ 目录)
npm run dist
🚀 GitHub Actions 自动云端打包与发布
本项目已配置免维护的 GitHub Actions CI/CD 流水线。
提交代码并打上版本 Tag：
code
Bash
git add .
git commit -m "feat: 发布新版本"
git push

# 推送版本标签 (以 'v' 开头)
git tag v1.0.1
git push origin v1.0.1
全自动交付：
GitHub Actions 会并行调动 Ubuntu 24.04、Windows Latest 与 macOS Latest 三台云主机；
自动解决原生 C++ 模块编译并注入签名；
约 3~5 分钟后，在 GitHub 仓库的 Releases 页面即可下载全平台安装包。
📄 许可证
ThoughtRings 基于 MIT License 开源。数据资产 100% 留存在你的本地设备中。
