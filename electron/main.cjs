process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');

const path = require('path');
const fs = require('fs');

// 高清晰度矢量字体与高DPI渲染优化参数
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

let mainWindow = null;
let dbModule = null;

function loadDatabaseSafe(userDataPath) {
  try {
    dbModule = require('./db.cjs');
    dbModule.initDatabase(userDataPath);
    console.log('✓ SQLite 数据库引擎挂载成功！');
  } catch (err) {
    console.error('❌ SQLite 加载失败详情:', err);
  }
}

async function loadDevServerWithRetry(win, url, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await win.loadURL(url);
      console.log('✓ 成功连入前端热更新服务:', url);
      return;
    } catch (err) {
      console.log(`正在等待前端 Vite 服务 (${i + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, 800));
    }
  }
  win.loadFile(path.join(__dirname, '../dist/index.html')).catch(() => {
    console.error('未能连入前端服务，请先在终端运行 npm run dev！');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 780,
    minHeight: 580,
    backgroundColor: '#F4F6F3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 开发阶段自动打开 DevTools；打包后不打开
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // 捕获前台网页控制台的日志，严格区分 Warning 与 Error
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 3) {
      console.log(`\x1b[31m[Webview 报错]\x1b[0m ${message} (at ${path.basename(sourceId)}:${line})`);
    } else if (level === 2) {
      console.log(`\x1b[33m[Webview 警告]\x1b[0m ${message} (at ${path.basename(sourceId)}:${line})`);
    }
  });

  // 生产环境直接读取 dist，开发态连入 Vite
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
      // 监听并打印加载失败原因
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`❌ [加载失败] ${errorCode}: ${errorDescription} (${validatedURL})`);
  });

  // 支持按 F12 键随时调出 DevTools 开发者工具
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const devUrl = 'http://localhost:1420';
    loadDevServerWithRetry(mainWindow, devUrl);
  }
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });

  // 自动迁移原 Tauri 的数据库文件
  const homeDir = process.env.HOME || '';
  const oldTauriDb = path.join(homeDir, '.local/share/com.thoughtrings.desktop/thought_rings.db');
  const newDbPath = path.join(userDataPath, 'thought_rings.db');
  if (fs.existsSync(oldTauriDb) && !fs.existsSync(newDbPath)) {
    try {
      fs.copyFileSync(oldTauriDb, newDbPath);
      console.log('✓ 已将原有 Tauri 笔记数据库无缝迁移至 Electron！');
    } catch (e) {}
  }

  loadDatabaseSafe(userDataPath);

  ipcMain.handle('tauri-invoke', async (event, cmd, args) => {
    if (!dbModule) {
      throw new Error("数据库引擎未就绪");
    }
    return dbModule.handleInvoke(cmd, args, { clipboard, shell, userDataPath });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
