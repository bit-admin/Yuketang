const lessonIdInput = document.getElementById('lessonId');
const outputDirInput = document.getElementById('outputDir');
const formatSelect = document.getElementById('format');
const browseBtn = document.getElementById('browseBtn');
const exportBtn = document.getElementById('exportBtn');
const backBtn = document.getElementById('backBtn');
const homeBtn = document.getElementById('homeBtn');
const statusWrap = document.getElementById('status');
const statusText = document.getElementById('statusMessage');
const openFolderBtn = document.getElementById('openFolderBtn');
const webview = document.getElementById('yuketangWebview');
const DEFAULT_STATUS_TEXT = 'Open Yuketang and navigate to a lesson report or class fullscreen page.';
const LESSON_READY_TEXT = 'Lesson report detected, you can export slides.';
const CLASS_READY_TEXT = 'Class fullscreen detected, you can export slides.';
const CLASS_WAIT_CAPTURE_TEXT = 'Class fullscreen detected, waiting for presentation capture...';
let saveTimer = null;
let navTimer = null;
let latestExportDir = '';
let currentPageMode = 'none';
let isExporting = false;
let classCapture = {
  presentationId: '',
  hasAuthorization: false,
};

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusWrap.classList.toggle('error', isError);
}

function setOpenFolderPath(folderPath = '') {
  latestExportDir = folderPath;
  openFolderBtn.hidden = !latestExportDir;
}

function hasReadyClassCapture() {
  return Boolean(classCapture.presentationId && classCapture.hasAuthorization);
}

function canExportNow() {
  return currentPageMode === 'lesson' || currentPageMode === 'class';
}

function refreshExportButtonState() {
  exportBtn.disabled = isExporting || !canExportNow();
}

function scheduleNavigationEvaluation(url, delayMs = 180) {
  if (navTimer) {
    clearTimeout(navTimer);
  }
  navTimer = setTimeout(() => {
    handleNavigation(url);
    navTimer = null;
  }, delayMs);
}

function extractLessonId(urlString) {
  try {
    const url = new URL(urlString);
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = parts.indexOf('student-lesson-report');
    if (marker === -1) {
      return null;
    }

    const segments = parts.slice(marker + 1);
    if (segments.length >= 2 && /^\d+$/.test(segments[1])) {
      return segments[1];
    }

    const fallback = segments.find((segment) => /^\d+$/.test(segment));
    return fallback || null;
  } catch {
    return null;
  }
}

function isClassFullscreenUrl(urlString) {
  try {
    const url = new URL(urlString);
    return /^\/lesson\/fullscreen\/v3\/\d+\/ppt\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function handleNavigation(url) {
  setOpenFolderPath('');
  const lessonId = extractLessonId(url);
  if (lessonId) {
    currentPageMode = 'lesson';
    lessonIdInput.value = lessonId;
    setStatus(LESSON_READY_TEXT);
    refreshExportButtonState();
    return;
  }

  if (isClassFullscreenUrl(url)) {
    currentPageMode = 'class';
    lessonIdInput.value = '';
    if (hasReadyClassCapture()) {
      setStatus(CLASS_READY_TEXT);
    } else {
      setStatus(CLASS_WAIT_CAPTURE_TEXT);
    }
    refreshExportButtonState();
    return;
  }

  currentPageMode = 'none';
  setStatus(DEFAULT_STATUS_TEXT);
  refreshExportButtonState();
}

async function loadConfig() {
  const config = await window.electronAPI.getConfig();
  outputDirInput.value = config.outputDir;
  formatSelect.value = config.format;
}

async function saveConfig() {
  const config = await window.electronAPI.saveConfig({
    outputDir: outputDirInput.value.trim(),
    format: formatSelect.value,
  });
  outputDirInput.value = config.outputDir;
  formatSelect.value = config.format;
}

function scheduleConfigSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveConfig().catch((error) => {
      setStatus(error?.message || String(error), true);
    });
  }, 300);
}

async function exportCurrentLesson() {
  if (!canExportNow()) {
    setStatus(DEFAULT_STATUS_TEXT);
    return;
  }

  const lessonId = lessonIdInput.value.trim();
  if (currentPageMode === 'class' && !hasReadyClassCapture()) {
    setStatus(CLASS_WAIT_CAPTURE_TEXT);
    return;
  }

  if (currentPageMode === 'lesson' && !/^\d+$/.test(lessonId)) {
    setStatus('lesson_id is not ready yet. Please refresh the lesson report page.', true);
    return;
  }

  isExporting = true;
  refreshExportButtonState();
  browseBtn.disabled = true;
  setOpenFolderPath('');

  try {
    const result = await window.electronAPI.exportLesson(
      /^\d+$/.test(lessonId)
        ? {
            lessonId,
            outputDir: outputDirInput.value.trim(),
            format: formatSelect.value,
          }
        : {
            outputDir: outputDirInput.value.trim(),
            format: formatSelect.value,
          }
    );
    setStatus(`Exported ${result.presentationCount} presentation(s) as ${result.format.toUpperCase()}`);
    setOpenFolderPath(result.lessonDir);
  } catch (error) {
    setStatus(error?.message || String(error), true);
    setOpenFolderPath('');
  } finally {
    isExporting = false;
    refreshExportButtonState();
    browseBtn.disabled = false;
  }
}

async function pickDirectory() {
  try {
    const picked = await window.electronAPI.pickOutputDir();
    if (picked) {
      outputDirInput.value = picked;
      await saveConfig();
    }
  } catch (error) {
    setStatus(error?.message || String(error), true);
  }
}

window.electronAPI.onExportProgress((message) => {
  setOpenFolderPath('');
  setStatus(message);
});
window.electronAPI.onClassCaptureUpdate((capture) => {
  classCapture = capture;
  const currentUrl = webview.getURL();
  if (isClassFullscreenUrl(currentUrl)) {
    if (hasReadyClassCapture()) {
      setStatus(CLASS_READY_TEXT);
    } else {
      setStatus(CLASS_WAIT_CAPTURE_TEXT);
    }
    currentPageMode = 'class';
    refreshExportButtonState();
  }
});

browseBtn.addEventListener('click', pickDirectory);
exportBtn.addEventListener('click', exportCurrentLesson);
backBtn.addEventListener('click', () => {
  if (webview.canGoBack()) {
    webview.goBack();
  }
});
homeBtn.addEventListener('click', () => {
  webview.loadURL('https://www.yuketang.cn/web');
});
outputDirInput.addEventListener('input', scheduleConfigSave);
formatSelect.addEventListener('change', () => {
  saveConfig().catch((error) => {
    setStatus(error?.message || String(error), true);
  });
});
openFolderBtn.addEventListener('click', async () => {
  if (!latestExportDir) {
    return;
  }
  openFolderBtn.disabled = true;
  try {
    await window.electronAPI.openFolder(latestExportDir);
  } catch (error) {
    setStatus(error?.message || String(error), true);
  } finally {
    openFolderBtn.disabled = false;
  }
});

for (const eventName of ['did-navigate', 'did-navigate-in-page']) {
  webview.addEventListener(eventName, (event) => {
    scheduleNavigationEvaluation(event.url, 180);
  });
}

webview.addEventListener('did-stop-loading', () => {
  scheduleNavigationEvaluation(webview.getURL(), 0);
});

window.electronAPI
  .getClassCapture()
  .then((capture) => {
    classCapture = capture;
  })
  .catch(() => {});

refreshExportButtonState();

loadConfig().catch((error) => {
  setStatus(error?.message || String(error), true);
});
