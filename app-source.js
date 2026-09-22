import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { jsPDF } from 'jspdf';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { currentView: 'home', activeTool: null, notes: [], scanPages: [], installPrompt: null, imageBlob: null, imageName: '轻捷图片.jpg', ocrWorker: null };
const TOOL_TITLES = { docscan: 'A4 文档扫描', ocr: '扫描文本', image: '图片处理', text: '文字工具', date: '日期计算', units: '单位换算', split: 'AA 分账', qr: '二维码工具', 'note-editor': '编辑便签' };
let openCvPromise;
const UNIT_DATA = {
  length: { units: { m: ['米', 1], km: ['千米', 1000], cm: ['厘米', .01], mm: ['毫米', .001], in: ['英寸', .0254], ft: ['英尺', .3048] }, defaults: ['m', 'cm'] },
  weight: { units: { kg: ['千克', 1], g: ['克', .001], lb: ['磅', .45359237], oz: ['盎司', .028349523] }, defaults: ['kg', 'lb'] },
  temp: { units: { c: ['摄氏度', 'c'], f: ['华氏度', 'f'], k: ['开尔文', 'k'] }, defaults: ['c', 'f'] }
};

function init() {
  loadNotes();
  setToday();
  applyTheme(localStorage.getItem('pocketkit-theme') || 'system');
  bindNavigation();
  bindGlobalActions();
  renderNotes();
  registerServiceWorker();
  const shortcutTool = new URLSearchParams(location.search).get('tool');
  if (shortcutTool && TOOL_TITLES[shortcutTool]) setTimeout(() => openTool(shortcutTool), 80);
}

function setToday() {
  const date = new Date();
  $('#todayText').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
}

function bindNavigation() {
  $$('[data-nav]').forEach(button => button.addEventListener('click', () => showView(button.dataset.nav)));
  $$('[data-open-tool]').forEach(button => button.addEventListener('click', () => openTool(button.dataset.openTool)));
  $$('[data-close-tool]').forEach(button => button.addEventListener('click', closeTool));
  $('#toolSearch').addEventListener('input', event => {
    const term = event.target.value.trim().toLowerCase();
    let visible = 0;
    $$('#toolList > button').forEach(button => {
      const show = !term || `${button.textContent} ${button.dataset.keywords}`.toLowerCase().includes(term);
      button.hidden = !show;
      visible += Number(show);
    });
    $('#toolEmpty').hidden = visible !== 0;
  });
}

function showView(name) {
  state.currentView = name;
  $$('.view').forEach(view => view.classList.toggle('active', view.dataset.view === name));
  $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.nav === name));
  if (name === 'notes') renderNotes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openTool(name, options = {}) {
  const template = $(`#tpl-${name}`);
  if (!template) return;
  state.activeTool = name;
  $('#sheetTitle').textContent = TOOL_TITLES[name] || '轻捷工具';
  $('#sheetKicker').textContent = name === 'note-editor' ? '自动保存' : '轻捷工具';
  $('#sheetBody').replaceChildren(template.content.cloneNode(true));
  $('#toolSheet').classList.add('open');
  $('#toolSheet').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setupTool(name, options);
}

function closeTool() {
  if (state.ocrWorker) {
    state.ocrWorker.terminate().catch(() => {});
    state.ocrWorker = null;
  }
  state.activeTool = null;
  state.imageBlob = null;
  $('#toolSheet').classList.remove('open');
  $('#toolSheet').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  renderNotes();
}

function setupTool(name, options) {
  const setups = { docscan: setupDocumentScanner, ocr: () => setupOcr(options.blob), image: setupImage, text: setupText, date: setupDate, units: setupUnits, split: setupSplit, qr: setupQr, 'note-editor': () => setupNoteEditor(options.id) };
  setups[name]?.();
}

function bindGlobalActions() {
  $('#themeToggle').addEventListener('click', () => {
    const current = localStorage.getItem('pocketkit-theme') || 'system';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
  $('#settingTheme').addEventListener('click', cycleTheme);
  $('#newNote').addEventListener('click', () => openTool('note-editor'));
  $('#exportData').addEventListener('click', exportNotes);
  $('#clearData').addEventListener('click', clearData);
  $('#installButton').addEventListener('click', installApp);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && state.activeTool) closeTool(); });
}

function cycleTheme() {
  const current = localStorage.getItem('pocketkit-theme') || 'system';
  applyTheme(current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system');
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  localStorage.setItem('pocketkit-theme', theme);
  const label = { system: '跟随系统', light: '浅色模式', dark: '深色模式' }[theme];
  if ($('#themeLabel')) $('#themeLabel').textContent = label;
  document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', theme === 'dark' ? '#10211d' : '#f4f1e9');
}

async function installApp() {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
  } else {
    toast('在 Safari 中点“分享”，再选“添加到主屏幕”');
  }
}

function loadOpenCv() {
  if (window.cv?.Mat) return Promise.resolve(window.cv);
  if (openCvPromise) return openCvPromise;
  openCvPromise = new Promise((resolve, reject) => {
    const finish = async () => {
      try {
        let candidate = window.cv;
        if (candidate?.then) candidate = await candidate;
        if (candidate?.Mat) return resolve(candidate);
        if (!candidate) return reject(new Error('OpenCV 未加载'));
        const timer = setTimeout(() => reject(new Error('OpenCV 初始化超时')), 45000);
        candidate.onRuntimeInitialized = () => { clearTimeout(timer); resolve(candidate); };
      } catch (error) { reject(error); }
    };
    const existing = document.querySelector('script[data-opencv]');
    if (existing) return finish();
    const script = document.createElement('script');
    script.src = new URL('vendor/opencv.js', location.href).href;
    script.dataset.opencv = 'true';
    script.onload = finish;
    script.onerror = () => reject(new Error('扫描组件加载失败'));
    document.head.appendChild(script);
  });
  return openCvPromise;
}

function setupDocumentScanner() {
  const input = $('#scanFile');
  const dropZone = $('#scanDropZone');
  const loading = $('#scanLoading');
  const workspace = $('#scannerWorkspace');
  const sourceStage = $('#scanSourceStage');
  const sourceCanvas = $('#scanSourceCanvas');
  const resultCanvas = $('#scanResultCanvas');
  const overlay = $('#scanCornerOverlay');
  const effectPanel = $('#scanEffectPanel');
  const applyButton = $('#scanApply');
  const redetectButton = $('#scanRedetect');
  const adjustButton = $('#scanAdjust');
  let cv;
  let corners = [];
  let currentMode = 'color';
  let sourceReady = false;

  const showAdjusting = () => {
    sourceStage.hidden = false;
    resultCanvas.hidden = true;
    effectPanel.hidden = true;
    applyButton.hidden = false;
    redetectButton.hidden = false;
    adjustButton.hidden = true;
  };
  const showResult = () => {
    sourceStage.hidden = true;
    resultCanvas.hidden = false;
    effectPanel.hidden = false;
    applyButton.hidden = true;
    redetectButton.hidden = true;
    adjustButton.hidden = false;
  };

  const updateOverlay = () => {
    overlay.setAttribute('viewBox', `0 0 ${sourceCanvas.width} ${sourceCanvas.height}`);
    $('polygon', overlay).setAttribute('points', corners.map(point => `${point.x},${point.y}`).join(' '));
    $$('circle', overlay).forEach((circle, index) => {
      circle.setAttribute('cx', corners[index]?.x || 0);
      circle.setAttribute('cy', corners[index]?.y || 0);
      circle.setAttribute('r', Math.max(18, Math.min(sourceCanvas.width, sourceCanvas.height) * .025));
    });
  };

  const fallbackCorners = () => {
    const insetX = sourceCanvas.width * .045;
    const insetY = sourceCanvas.height * .045;
    return [
      { x: insetX, y: insetY }, { x: sourceCanvas.width - insetX, y: insetY },
      { x: sourceCanvas.width - insetX, y: sourceCanvas.height - insetY }, { x: insetX, y: sourceCanvas.height - insetY }
    ];
  };

  const detectDocument = () => {
    if (!cv || !sourceReady) return;
    const scale = Math.min(1, 1000 / Math.max(sourceCanvas.width, sourceCanvas.height));
    const detectCanvas = document.createElement('canvas');
    detectCanvas.width = Math.round(sourceCanvas.width * scale);
    detectCanvas.height = Math.round(sourceCanvas.height * scale);
    detectCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, detectCanvas.width, detectCanvas.height);
    const src = cv.imread(detectCanvas);
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    let best = null;
    let bestArea = 0;
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      cv.Canny(gray, edges, 50, 150);
      cv.dilate(edges, edges, kernel);
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const minimumArea = detectCanvas.width * detectCanvas.height * .12;
      for (let index = 0; index < contours.size(); index++) {
        const contour = contours.get(index);
        const perimeter = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, .02 * perimeter, true);
        const area = Math.abs(cv.contourArea(approx));
        if (approx.rows === 4 && area > minimumArea && area > bestArea) {
          bestArea = area;
          best = [];
          for (let point = 0; point < 4; point++) best.push({ x: approx.data32S[point * 2] / scale, y: approx.data32S[point * 2 + 1] / scale });
        }
        contour.delete();
        approx.delete();
      }
    } finally {
      src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
    }
    corners = best ? orderCorners(best) : fallbackCorners();
    updateOverlay();
    toast(best ? '已自动找到文档边缘' : '请拖动圆点对齐纸张四角');
  };

  const renderDocument = () => {
    if (!cv || corners.length !== 4) return false;
    const widthTop = pointDistance(corners[0], corners[1]);
    const widthBottom = pointDistance(corners[3], corners[2]);
    const heightLeft = pointDistance(corners[0], corners[3]);
    const heightRight = pointDistance(corners[1], corners[2]);
    const portrait = (heightLeft + heightRight) >= (widthTop + widthBottom);
    let outWidth;
    let outHeight;
    if (portrait) {
      outWidth = Math.max(700, Math.round((widthTop + widthBottom) / 2));
      outHeight = Math.round(outWidth * Math.SQRT2);
    } else {
      outHeight = Math.max(700, Math.round((heightLeft + heightRight) / 2));
      outWidth = Math.round(outHeight * Math.SQRT2);
    }
    const downscale = Math.min(1, 2200 / Math.max(outWidth, outHeight));
    outWidth = Math.round(outWidth * downscale);
    outHeight = Math.round(outHeight * downscale);
    const src = cv.imread(sourceCanvas);
    const warped = new cv.Mat();
    const output = new cv.Mat();
    const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(point => [point.x, point.y]));
    const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outWidth - 1, 0, outWidth - 1, outHeight - 1, 0, outHeight - 1]);
    const transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    try {
      cv.warpPerspective(src, warped, transform, new cv.Size(outWidth, outHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      if (currentMode === 'original') warped.copyTo(output);
      if (currentMode === 'color') {
        const blur = new cv.Mat();
        cv.GaussianBlur(warped, blur, new cv.Size(0, 0), 2.2);
        cv.addWeighted(warped, 1.35, blur, -.35, 7, output);
        blur.delete();
      }
      if (currentMode === 'gray' || currentMode === 'bw') {
        const gray = new cv.Mat();
        cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
        if (currentMode === 'gray') {
          const blur = new cv.Mat();
          cv.GaussianBlur(gray, blur, new cv.Size(0, 0), 2);
          cv.addWeighted(gray, 1.45, blur, -.45, 8, output);
          blur.delete();
        } else {
          cv.adaptiveThreshold(gray, output, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 13);
        }
        gray.delete();
      }
      cv.imshow(resultCanvas, output);
    } finally {
      src.delete(); warped.delete(); output.delete(); sourcePoints.delete(); destinationPoints.delete(); transform.delete();
    }
    return true;
  };

  const processFile = async file => {
    if (!file) return;
    dropZone.hidden = true;
    workspace.hidden = true;
    loading.hidden = false;
    try {
      cv = await loadOpenCv();
      const image = await loadImage(URL.createObjectURL(file));
      const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
      sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      sourceCanvas.getContext('2d').drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
      sourceReady = true;
      detectDocument();
      workspace.hidden = false;
      showAdjusting();
    } catch (error) {
      console.error(error);
      dropZone.hidden = false;
      toast('扫描组件加载失败，请检查网络后重试');
    } finally { loading.hidden = true; }
  };

  input.addEventListener('change', () => processFile(input.files?.[0]));
  redetectButton.addEventListener('click', detectDocument);
  applyButton.addEventListener('click', () => { if (renderDocument()) showResult(); });
  adjustButton.addEventListener('click', showAdjusting);
  $$('[data-scan-mode]').forEach(button => button.addEventListener('click', () => {
    currentMode = button.dataset.scanMode;
    $$('[data-scan-mode]').forEach(item => item.classList.toggle('active', item === button));
    renderDocument();
  }));
  $$('circle', overlay).forEach(circle => {
    let dragging = false;
    const move = event => {
      if (!dragging) return;
      const rect = overlay.getBoundingClientRect();
      const index = Number(circle.dataset.corner);
      corners[index] = {
        x: Math.max(0, Math.min(sourceCanvas.width, (event.clientX - rect.left) / rect.width * sourceCanvas.width)),
        y: Math.max(0, Math.min(sourceCanvas.height, (event.clientY - rect.top) / rect.height * sourceCanvas.height))
      };
      updateOverlay();
    };
    circle.addEventListener('pointerdown', event => { dragging = true; circle.setPointerCapture(event.pointerId); event.preventDefault(); });
    circle.addEventListener('pointermove', move);
    circle.addEventListener('pointerup', event => { dragging = false; circle.releasePointerCapture(event.pointerId); });
    circle.addEventListener('pointercancel', () => { dragging = false; });
  });
  $('#scanAddPage').addEventListener('click', () => {
    if (state.scanPages.length >= 12) return toast('一次最多保存 12 页');
    const data = resultCanvas.toDataURL('image/jpeg', .9);
    state.scanPages.push({ id: crypto.randomUUID?.() || String(Date.now()), data, width: resultCanvas.width, height: resultCanvas.height });
    renderScanPages();
    toast(`已加入第 ${state.scanPages.length} 页`);
  });
  $('#scanSaveJpg').addEventListener('click', () => resultCanvas.toBlob(blob => downloadBlob(blob, `轻捷-A4扫描-${Date.now()}.jpg`), 'image/jpeg', .92));
  $('#scanToOcr').addEventListener('click', () => resultCanvas.toBlob(blob => openTool('ocr', { blob }), 'image/jpeg', .94));
  $('#scanNewPhoto').addEventListener('click', () => { input.value = ''; input.click(); });
  $('#exportScanPdf').addEventListener('click', exportScanPdf);
  $('#clearScanPages').addEventListener('click', () => { state.scanPages = []; renderScanPages(); });
  renderScanPages();
}

function renderScanPages() {
  const section = $('#scanPagesSection');
  const list = $('#scanPageList');
  if (!section || !list) return;
  section.hidden = state.scanPages.length === 0;
  $('#scanPageCount').textContent = state.scanPages.length;
  list.innerHTML = state.scanPages.map((page, index) => `<div class="scan-page-card"><img src="${page.data}" alt="扫描第 ${index + 1} 页"><span>${index + 1}</span><button data-delete-page="${page.id}" aria-label="删除第 ${index + 1} 页">×</button></div>`).join('');
  $$('[data-delete-page]', list).forEach(button => button.addEventListener('click', () => {
    state.scanPages = state.scanPages.filter(page => page.id !== button.dataset.deletePage);
    renderScanPages();
  }));
}

function exportScanPdf() {
  if (!state.scanPages.length) return toast('请先加入至少一页');
  let pdf;
  state.scanPages.forEach((page, index) => {
    const orientation = page.width > page.height ? 'landscape' : 'portrait';
    const pageWidth = orientation === 'portrait' ? 210 : 297;
    const pageHeight = orientation === 'portrait' ? 297 : 210;
    if (!pdf) pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
    else pdf.addPage('a4', orientation);
    const ratio = Math.min(pageWidth / page.width, pageHeight / page.height);
    const width = page.width * ratio;
    const height = page.height * ratio;
    pdf.addImage(page.data, 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, undefined, 'FAST');
  });
  pdf.save(`轻捷-A4扫描-${toDateInput(new Date())}.pdf`);
}

function orderCorners(points) {
  const bySum = [...points].sort((a, b) => a.x + a.y - b.x - b.y);
  const topLeft = bySum[0];
  const bottomRight = bySum[bySum.length - 1];
  const remaining = points.filter(point => point !== topLeft && point !== bottomRight).sort((a, b) => (b.x - b.y) - (a.x - a.y));
  return [topLeft, remaining[0], bottomRight, remaining[1]];
}

function pointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function setupOcr(initialBlob) {
  const fileInput = $('#ocrFile');
  const preview = $('#ocrPreview');
  const runButton = $('#runOcr');
  let file = initialBlob || null;
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    runButton.disabled = false;
  }
  fileInput.addEventListener('change', () => {
    file = fileInput.files?.[0];
    if (!file) return;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    runButton.disabled = false;
  });
  runButton.addEventListener('click', async () => {
    if (!file || !window.Tesseract) return;
    runButton.disabled = true;
    const progress = $('#ocrProgress');
    progress.hidden = false;
    $('#ocrResultWrap').hidden = true;
    $('#ocrActions').hidden = true;
    try {
      const base = new URL('.', location.href).href;
      state.ocrWorker = await Tesseract.createWorker($('#ocrLang').value, Tesseract.OEM.LSTM_ONLY, {
        workerPath: `${base}vendor/worker.min.js`,
        langPath: `${base}vendor/tessdata/`,
        corePath: `${base}vendor/tesseract-core/`,
        gzip: false,
        logger: message => updateOcrProgress(message)
      });
      const result = await state.ocrWorker.recognize(file);
      $('#ocrResult').value = result.data.text.trim();
      $('#ocrResultWrap').hidden = false;
      $('#ocrActions').hidden = false;
      updateOcrProgress({ status: 'recognizing text', progress: 1 });
      await state.ocrWorker.terminate();
      state.ocrWorker = null;
      toast(result.data.text.trim() ? '文字识别完成' : '未识别到清晰文字');
    } catch (error) {
      console.error(error);
      toast('识别失败，请换一张更清晰的图片');
      $('#ocrStatus').textContent = '识别失败';
    } finally {
      runButton.disabled = false;
    }
  });
  $('#copyOcr').addEventListener('click', () => copyText($('#ocrResult').value));
  $('#saveOcr').addEventListener('click', () => {
    const text = $('#ocrResult').value.trim();
    if (!text) return;
    addNote({ title: '扫描文字', content: text });
    toast('已保存到便签');
  });
}

function updateOcrProgress(message) {
  const labels = { 'loading tesseract core': '加载识别引擎…', 'initializing tesseract': '初始化引擎…', 'loading language traineddata': '加载语言数据…', 'initializing api': '准备识别…', 'recognizing text': '正在识别文字…' };
  const value = Number.isFinite(message.progress) ? message.progress : 0;
  $('#ocrStatus').textContent = labels[message.status] || '正在准备…';
  $('#ocrPercent').textContent = `${Math.round(value * 100)}%`;
  $('#ocrProgress progress').value = value;
}

function setupImage() {
  let sourceImage;
  let rotation = 0;
  const fileInput = $('#imageFile');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      $('#imagePreview').src = url;
      $('#imagePreview').hidden = false;
      $('#processImage').disabled = false;
    };
    img.onerror = () => toast('暂不支持这种图片格式');
    img.src = url;
  });
  $('#imageQuality').addEventListener('input', event => { $('#qualityText').textContent = `${event.target.value}%`; });
  $$('.segmented [data-rotate]').forEach(button => button.addEventListener('click', () => {
    rotation = Number(button.dataset.rotate);
    $$('.segmented [data-rotate]').forEach(item => item.classList.toggle('active', item === button));
  }));
  $('#processImage').addEventListener('click', async () => {
    if (!sourceImage) return;
    const longest = Number($('#imageSize').value);
    const format = $('#imageFormat').value;
    const quality = Number($('#imageQuality').value) / 100;
    let width = sourceImage.naturalWidth;
    let height = sourceImage.naturalHeight;
    if (longest && Math.max(width, height) > longest) {
      const scale = longest / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const rotated = Math.abs(rotation) === 90;
    const canvas = document.createElement('canvas');
    canvas.width = rotated ? height : width;
    canvas.height = rotated ? width : height;
    const context = canvas.getContext('2d');
    if (format === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(sourceImage, -width / 2, -height / 2, width, height);
    state.imageBlob = await new Promise(resolve => canvas.toBlob(resolve, format, quality));
    if (!state.imageBlob) return toast('处理失败，请更换输出格式');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[format];
    state.imageName = `轻捷-${Date.now()}.${extension}`;
    $('#outputPreview').src = URL.createObjectURL(state.imageBlob);
    $('#outputInfo').textContent = `${canvas.width} × ${canvas.height} · ${formatBytes(state.imageBlob.size)}`;
    $('#imageResult').hidden = false;
    $('#imageResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#downloadImage').addEventListener('click', () => downloadBlob(state.imageBlob, state.imageName));
  $('#shareImage').addEventListener('click', shareProcessedImage);
}

async function shareProcessedImage() {
  if (!state.imageBlob) return;
  const file = new File([state.imageBlob], state.imageName, { type: state.imageBlob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '轻捷处理的图片' }); } catch (error) { if (error.name !== 'AbortError') downloadBlob(state.imageBlob, state.imageName); }
  } else downloadBlob(state.imageBlob, state.imageName);
}

function setupText() {
  const input = $('#textInput');
  const update = () => {
    const text = input.value;
    $('#statChars').textContent = [...text].length;
    $('#statWords').textContent = (text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) || []).length;
    $('#statLines').textContent = text ? text.split(/\r?\n/).length : 0;
  };
  input.addEventListener('input', update);
  $$('[data-text-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.textAction;
    if (action === 'copy') return copyText(input.value);
    if (action === 'spaces') input.value = input.value.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (action === 'dedupe') input.value = [...new Set(input.value.split(/\r?\n/))].join('\n');
    if (action === 'upper') input.value = input.value.toUpperCase();
    if (action === 'lower') input.value = input.value.toLowerCase();
    if (action === 'trim') input.value = input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n');
    update();
  }));
}

function setupDate() {
  const today = toDateInput(new Date());
  $('#dateStart').value = today;
  $('#dateEnd').value = today;
  $('#birthDate').max = today;
  const updateGap = () => {
    const start = parseLocalDate($('#dateStart').value);
    const end = parseLocalDate($('#dateEnd').value);
    if (!start || !end) return;
    const days = Math.round((end - start) / 86400000);
    $('#dateGapResult strong').textContent = `${Math.abs(days).toLocaleString('zh-CN')} 天`;
    $('#dateGapResult p').textContent = days === 0 ? '是同一天' : days > 0 ? `约 ${formatDuration(days)}` : `结束日期早于开始日期 · ${formatDuration(Math.abs(days))}`;
  };
  $('#dateStart').addEventListener('change', updateGap);
  $('#dateEnd').addEventListener('change', updateGap);
  $('#birthDate').addEventListener('change', () => {
    const birth = parseLocalDate($('#birthDate').value);
    if (!birth) return;
    const now = new Date();
    if (birth > now) return toast('出生日期不能晚于今天');
    let years = now.getFullYear() - birth.getFullYear();
    let months = now.getMonth() - birth.getMonth();
    let days = now.getDate() - birth.getDate();
    if (days < 0) { months--; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
    if (months < 0) { years--; months += 12; }
    $('#ageResult strong').textContent = `${years} 岁`;
    $('#ageResult p').textContent = `${years} 年 ${months} 个月 ${days} 天`;
  });
  $$('[data-date-tab]').forEach(button => button.addEventListener('click', () => {
    const age = button.dataset.dateTab === 'age';
    $('#dateGapPanel').hidden = age;
    $('#agePanel').hidden = !age;
    $$('[data-date-tab]').forEach(item => item.classList.toggle('active', item === button));
  }));
  updateGap();
}

function setupUnits() {
  let category = 'length';
  const loadOptions = () => {
    const data = UNIT_DATA[category];
    const html = Object.entries(data.units).map(([value, [label]]) => `<option value="${value}">${label}</option>`).join('');
    $('#unitFrom').innerHTML = html;
    $('#unitTo').innerHTML = html;
    [$('#unitFrom').value, $('#unitTo').value] = data.defaults;
    update();
  };
  const update = () => {
    const value = Number($('#unitValue').value);
    const from = $('#unitFrom').value;
    const to = $('#unitTo').value;
    if (!Number.isFinite(value)) return;
    let result;
    if (category === 'temp') {
      const celsius = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
      result = to === 'c' ? celsius : to === 'f' ? celsius * 9 / 5 + 32 : celsius + 273.15;
    } else result = value * UNIT_DATA[category].units[from][1] / UNIT_DATA[category].units[to][1];
    const fromLabel = UNIT_DATA[category].units[from][0];
    const toLabel = UNIT_DATA[category].units[to][0];
    $('#unitResult').textContent = `${formatNumber(result)} ${toLabel}`;
    $('#unitFormula').textContent = `${formatNumber(value)} ${fromLabel} = ${formatNumber(result)} ${toLabel}`;
  };
  $$('[data-unit-category]').forEach(button => button.addEventListener('click', () => {
    category = button.dataset.unitCategory;
    $$('[data-unit-category]').forEach(item => item.classList.toggle('active', item === button));
    loadOptions();
  }));
  $('#unitValue').addEventListener('input', update);
  $('#unitFrom').addEventListener('change', update);
  $('#unitTo').addEventListener('change', update);
  $('#swapUnits').addEventListener('click', () => { const from = $('#unitFrom').value; $('#unitFrom').value = $('#unitTo').value; $('#unitTo').value = from; update(); });
  loadOptions();
}

function setupSplit() {
  const update = () => {
    const amount = Math.max(0, Number($('#billAmount').value) || 0);
    const people = Math.max(1, Math.floor(Number($('#peopleCount').value) || 1));
    const rate = Number($('#tipRate').value) || 0;
    const total = amount * (1 + rate / 100);
    $('#perPerson').textContent = `¥${(total / people).toFixed(2)}`;
    $('#splitDetail').textContent = `共 ¥${total.toFixed(2)} · ${people} 人${rate ? ` · 含 ${rate}%` : ''}`;
  };
  ['#billAmount', '#peopleCount', '#tipRate'].forEach(selector => $(selector).addEventListener('input', update));
  update();
}

function setupQr() {
  $$('[data-qr-tab]').forEach(button => button.addEventListener('click', () => {
    const scan = button.dataset.qrTab === 'scan';
    $('#qrGeneratePanel').hidden = scan;
    $('#qrScanPanel').hidden = !scan;
    $$('[data-qr-tab]').forEach(item => item.classList.toggle('active', item === button));
  }));
  $('#generateQr').addEventListener('click', async () => {
    const text = $('#qrText').value.trim();
    if (!text) return toast('请先输入内容');
    try {
      await QRCode.toCanvas($('#qrCanvas'), text, { width: 700, margin: 3, color: { dark: '#173b31', light: '#ffffff' }, errorCorrectionLevel: 'M' });
      $('#qrOutput').hidden = false;
    } catch { toast('内容过长，无法生成二维码'); }
  });
  $('#saveQr').addEventListener('click', () => $('#qrCanvas').toBlob(blob => downloadBlob(blob, `轻捷-二维码-${Date.now()}.png`)));
  $('#qrFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const image = await loadImage(URL.createObjectURL(file));
    $('#qrPreview').src = image.src;
    $('#qrPreview').hidden = false;
    const canvas = document.createElement('canvas');
    const max = 1600;
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    if (result) {
      $('#qrScanText').textContent = result.data;
      $('#qrScanResult').hidden = false;
    } else {
      $('#qrScanResult').hidden = true;
      toast('没有识别到二维码');
    }
  });
  $('#copyQr').addEventListener('click', () => copyText($('#qrScanText').textContent));
}

function loadNotes() {
  try { state.notes = JSON.parse(localStorage.getItem('pocketkit-notes') || '[]'); }
  catch { state.notes = []; }
}

function saveNotes() { localStorage.setItem('pocketkit-notes', JSON.stringify(state.notes)); }

function addNote({ title = '', content = '' }) {
  const note = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, title, content, updatedAt: Date.now() };
  state.notes.unshift(note);
  saveNotes();
  return note;
}

function renderNotes() {
  const list = $('#notesList');
  if (!state.notes.length) {
    list.innerHTML = '<div class="notes-empty"><span><svg><use href="#i-note"/></svg></span><h3>还没有便签</h3><p>新建一条，内容会自动保存在本机。</p></div>';
    return;
  }
  list.innerHTML = state.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(note => `<button class="note-card" data-note-id="${escapeHtml(note.id)}"><time>${formatDateTime(note.updatedAt)}</time><h3>${escapeHtml(note.title || '无标题便签')}</h3><p>${escapeHtml(note.content || '空白便签')}</p></button>`).join('');
  $$('.note-card', list).forEach(button => button.addEventListener('click', () => openTool('note-editor', { id: button.dataset.noteId })));
}

function setupNoteEditor(id) {
  let note = state.notes.find(item => item.id === id);
  if (!note) note = addNote({ title: '', content: '' });
  $('#noteTitle').value = note.title;
  $('#noteContent').value = note.content;
  let timer;
  const save = () => {
    note.title = $('#noteTitle').value.trim();
    note.content = $('#noteContent').value;
    note.updatedAt = Date.now();
    saveNotes();
    $('#noteSaveHint').textContent = '已自动保存';
  };
  const queueSave = () => {
    save();
    $('#noteSaveHint').textContent = '正在保存…';
    clearTimeout(timer);
    timer = setTimeout(() => { const hint = $('#noteSaveHint'); if (hint) hint.textContent = '已自动保存'; }, 350);
  };
  $('#noteTitle').addEventListener('input', queueSave);
  $('#noteContent').addEventListener('input', queueSave);
  $('#deleteNote').addEventListener('click', () => {
    if (!confirm('确定删除这条便签吗？')) return;
    state.notes = state.notes.filter(item => item.id !== note.id);
    saveNotes();
    closeTool();
    toast('便签已删除');
  });
}

function exportNotes() {
  const blob = new Blob([JSON.stringify({ app: '轻捷', exportedAt: new Date().toISOString(), notes: state.notes }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `轻捷便签-${toDateInput(new Date())}.json`);
}

function clearData() {
  if (!confirm('这会删除所有便签和本地设置，且无法恢复。确定继续吗？')) return;
  state.notes = [];
  localStorage.removeItem('pocketkit-notes');
  renderNotes();
  toast('本地数据已清除');
}

async function copyText(text) {
  if (!text) return toast('没有可复制的内容');
  try { await navigator.clipboard.writeText(text); }
  catch {
    const area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }
  toast('已复制到剪贴板');
}

function downloadBlob(blob, filename) {
  if (!blob) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2400);
}

function loadImage(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url; }); }
function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function parseLocalDate(value) { if (!value) return null; const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
function toDateInput(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function formatDuration(days) { const years = Math.floor(days / 365.2425); const months = Math.floor((days - years * 365.2425) / 30.44); return years ? `${years} 年 ${months} 个月` : months ? `${months} 个月 ${Math.round(days - months * 30.44)} 天` : `${days} 天`; }
function formatNumber(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 }).format(Number(value.toPrecision(10))); }
function formatDateTime(timestamp) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

init();
