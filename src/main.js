const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { exportClassPresentation, exportLessonSummary } = require('./yuketang-export');

const APP_CONFIG = 'config.json';
let mainWindow;
const classCapture = {
  presentationId: '',
  authorization: '',
  sourceUrl: '',
  updatedAt: '',
};

function getConfigPath() {
  return path.join(app.getPath('userData'), APP_CONFIG);
}

function getDefaultConfig() {
  return {
    outputDir: path.join(app.getPath('downloads'), 'Yuketang'),
    format: 'pdf',
  };
}

function normalizeConfig(config = {}) {
  const defaults = getDefaultConfig();
  const rawOutputDir =
    typeof config.outputDir === 'string' && config.outputDir.trim()
      ? config.outputDir.trim()
      : defaults.outputDir;
  const outputDir = rawOutputDir === '~'
    ? app.getPath('home')
    : rawOutputDir.startsWith('~/')
      ? path.join(app.getPath('home'), rawOutputDir.slice(2))
      : rawOutputDir;
  const format = config.format === 'jpg' || config.format === 'png' ? 'jpg' : 'pdf';
  return { outputDir, format };
}

async function loadConfig() {
  const defaults = getDefaultConfig();
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    return normalizeConfig({ ...defaults, ...JSON.parse(raw) });
  } catch {
    return defaults;
  }
}

async function saveConfig(nextConfig) {
  const config = normalizeConfig(nextConfig);
  await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

async function buildYuketangCookieHeader() {
  const urls = ['https://www.yuketang.cn', 'https://yuketang.cn', 'https://pro.yuketang.cn'];
  const cookieMap = new Map();
  const cookieSessions = [session.fromPartition('persist:yuketang'), session.defaultSession];

  for (const currentSession of cookieSessions) {
    for (const url of urls) {
      const cookies = await currentSession.cookies.get({ url });
      for (const cookie of cookies) {
        cookieMap.set(cookie.name, cookie.value);
      }
    }
  }

  if (cookieMap.size === 0) {
    throw new Error('No Yuketang cookies found. Please sign in via the embedded website first.');
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function getHeaderValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      if (Array.isArray(value)) {
        return value.join('; ');
      }
      return typeof value === 'string' ? value : '';
    }
  }
  return '';
}

function hasReadyClassCapture() {
  return Boolean(classCapture.presentationId && classCapture.authorization);
}

function getPublicClassCapture() {
  return {
    presentationId: classCapture.presentationId,
    hasAuthorization: Boolean(classCapture.authorization),
    sourceUrl: classCapture.sourceUrl,
    updatedAt: classCapture.updatedAt,
  };
}

function setupClassCaptureListener() {
  const captureSession = session.fromPartition('persist:yuketang');
  captureSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.yuketang.cn/api/v3/lesson/presentation/fetch*'] },
    (details, callback) => {
      try {
        const url = new URL(details.url);
        const presentationId = url.searchParams.get('presentation_id') || '';
        const authorization = getHeaderValue(details.requestHeaders, 'authorization');

        if (presentationId) {
          classCapture.presentationId = presentationId;
        }
        if (authorization) {
          classCapture.authorization = authorization;
        }

        if (presentationId || authorization) {
          classCapture.sourceUrl = details.url;
          classCapture.updatedAt = new Date().toISOString();
          mainWindow?.webContents.send('class:capture-updated', getPublicClassCapture());
        }
      } catch {}

      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('config:get', async () => {
  return loadConfig();
});

ipcMain.handle('config:save', async (_event, config) => {
  return saveConfig(config);
});

ipcMain.handle('dialog:pickOutputDir', async () => {
  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('folder:open', async (_event, folderPath) => {
  const target = typeof folderPath === 'string' ? folderPath.trim() : '';
  if (!target) {
    throw new Error('No folder path provided.');
  }

  const openError = await shell.openPath(target);
  if (openError) {
    throw new Error(openError);
  }
  return true;
});

ipcMain.handle('class:capture:get', async () => {
  return getPublicClassCapture();
});

ipcMain.handle('lesson:export', async (_event, payload) => {
  const lessonId = String(payload?.lessonId ?? '').trim();
  const config = await saveConfig(payload);
  const cookieHeader = await buildYuketangCookieHeader();
  const onProgress = (message) => {
    mainWindow?.webContents.send('lesson:export-progress', message);
  };

  if (/^\d+$/.test(lessonId)) {
    return exportLessonSummary({
      lessonId,
      outputDir: config.outputDir,
      format: config.format,
      cookieHeader,
      onProgress,
    });
  }

  if (hasReadyClassCapture()) {
    return exportClassPresentation({
      presentationId: classCapture.presentationId,
      authorization: classCapture.authorization,
      cookieHeader,
      outputDir: config.outputDir,
      format: config.format,
      onProgress,
    });
  }

  throw new Error(
    'No lesson_id found. Open a lesson report page, or open class fullscreen PPT and wait for capture.'
  );
});

app.whenReady().then(() => {
  setupClassCaptureListener();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
