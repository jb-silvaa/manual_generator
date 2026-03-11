// ============================
// CONSTANTS & STATE
// ============================
const PIN_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
const MAX_UNDO = 20;

// screens: [{ id, name, dataUrl, sectionTitle, description, pinCount, annotations: [{id, x, y, label, desc, color, num}] }]
let screens = [];
let activeScreenId = null;
let pinMode = false;
let selectedPinColor = PIN_COLORS[0];
let selectedAnnotationId = null;
let undoStack = [];

// Drag-and-drop reorder state
let dragSrcIndex = null;

function getScreen(id) { return screens.find(s => s.id === id); }
function getActive() { return getScreen(activeScreenId); }

// ============================
// UNDO
// ============================
function pushUndo() {
  const snapshot = {
    screens: screens.map(s => ({ ...s, annotations: s.annotations.map(a => ({ ...a })) })),
    activeScreenId,
    selectedAnnotationId,
  };
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  screens = prev.screens;
  activeScreenId = prev.activeScreenId;
  selectedAnnotationId = prev.selectedAnnotationId;
  renderScreensList();
  if (activeScreenId) {
    renderCanvas();
    renderAnnotations();
    const active = getActive();
    document.getElementById('sectionTitle').value = active?.sectionTitle || '';
    document.getElementById('screenDescription').value = active?.description || '';
  } else {
    showEmpty();
  }
}

// ============================
// FILE UPLOAD
// ============================
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');

fileInput.addEventListener('change', e => { loadFiles(e.target.files); });

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  loadFiles(e.dataTransfer.files);
});

function loadFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!imageFiles.length) return;

  pushUndo();

  // Load sequentially to preserve file order
  let chain = Promise.resolve();
  imageFiles.forEach(file => {
    chain = chain.then(() => readFileAsDataURL(file)).then(dataUrl => {
      const id = 'scr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const name = file.name.replace(/\.[^.]+$/, '');
      screens.push({ id, name, dataUrl, sectionTitle: name, description: '', pinCount: 0, annotations: [] });
      renderScreensList();
      if (!activeScreenId) selectScreen(id);
    });
  });

  chain.finally(() => { fileInput.value = ''; });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================
// SCREENS LIST & DRAG-AND-DROP REORDER
// ============================
function renderScreensList() {
  const list = document.getElementById('screensList');
  const count = document.getElementById('screenCount');
  count.textContent = screens.length + ' pantalla' + (screens.length !== 1 ? 's' : '');

  if (screens.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = screens.map((s, idx) => `
    <div class="screen-item ${s.id === activeScreenId ? 'active' : ''}"
         draggable="true"
         data-index="${idx}"
         onclick="selectScreen('${s.id}')"
         ondragstart="onDragStart(event, ${idx})"
         ondragover="onDragOver(event)"
         ondragleave="onDragLeave(event)"
         ondrop="onDrop(event, ${idx})"
         ondragend="onDragEnd(event)">
      <img class="screen-thumb" src="${s.dataUrl}" alt="${escHtml(s.name)}">
      <div class="screen-info">
        <span class="screen-name" title="${escHtml(s.name)}">${escHtml(s.name)}</span>
        <span class="screen-badge">${s.annotations.length} 📍</span>
      </div>
      <button class="screen-delete" onclick="event.stopPropagation();deleteScreen('${s.id}')" title="Eliminar pantalla">✕</button>
    </div>
  `).join('');
}

function onDragStart(e, idx) {
  dragSrcIndex = idx;
  setTimeout(() => e.target.classList.add('dragging'), 0);
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e, targetIdx) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === targetIdx) return;
  pushUndo();
  const [moved] = screens.splice(dragSrcIndex, 1);
  screens.splice(targetIdx, 0, moved);
  dragSrcIndex = null;
  renderScreensList();
}

function onDragEnd() {
  dragSrcIndex = null;
  document.querySelectorAll('.screen-item').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });
}

function deleteScreen(id) {
  pushUndo();
  screens = screens.filter(s => s.id !== id);
  if (activeScreenId === id) {
    activeScreenId = screens.length ? screens[0].id : null;
    activeScreenId ? selectScreen(activeScreenId) : showEmpty();
  }
  renderScreensList();
}

function selectScreen(id) {
  activeScreenId = id;
  pinMode = false;
  selectedAnnotationId = null;
  renderScreensList();
  renderCanvas();
  renderAnnotations();
  const active = getActive();
  document.getElementById('sectionTitle').value = active?.sectionTitle || '';
  document.getElementById('screenDescription').value = active?.description || '';
}

// ============================
// CANVAS
// ============================
function showEmpty() {
  document.getElementById('canvasEmpty').style.display = 'flex';
  document.getElementById('imageWrapper').style.display = 'none';
  document.getElementById('canvasToolbar').style.display = 'none';
  document.getElementById('annotationsList').innerHTML =
    '<div class="empty-annotations">Selecciona una pantalla y coloca marcadores haciendo clic sobre la imagen.</div>';
  document.getElementById('annCount').textContent = '0';
  document.getElementById('sectionTitle').value = '';
  document.getElementById('screenDescription').value = '';
}

function renderCanvas() {
  const screen = getActive();
  if (!screen) { showEmpty(); return; }

  document.getElementById('canvasEmpty').style.display = 'none';
  document.getElementById('imageWrapper').style.display = 'inline-block';
  document.getElementById('canvasToolbar').style.display = 'flex';

  const img = document.getElementById('mainImage');
  img.src = screen.dataUrl;
  img.onclick = handleImageClick;

  updatePinModeUI();
  renderPins();
  renderColorPicker();
}

function renderColorPicker() {
  const container = document.getElementById('pinColors');
  container.innerHTML = '<span class="color-label">Color:</span>';
  PIN_COLORS.forEach(color => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (color === selectedPinColor ? ' selected' : '');
    dot.style.background = color;
    dot.title = color;
    dot.onclick = () => { selectedPinColor = color; renderColorPicker(); };
    container.appendChild(dot);
  });
}

function handleImageClick(e) {
  if (!pinMode) return;
  const screen = getActive();
  if (!screen) return;

  pushUndo();

  const rect = e.target.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;

  screen.pinCount = (screen.pinCount || 0) + 1;
  const ann = {
    id: 'ann_' + Date.now(),
    x,
    y,
    label: 'Elemento ' + screen.pinCount,
    desc: '',
    color: selectedPinColor,
    num: screen.pinCount,
  };

  screen.annotations.push(ann);
  selectedAnnotationId = ann.id;
  renderPins();
  renderAnnotations();
  renderScreensList();

  setTimeout(() => {
    const el = document.getElementById('desc_' + ann.id);
    if (el) el.focus();
  }, 50);
}

function renderPins() {
  const wrapper = document.getElementById('imageWrapper');
  wrapper.querySelectorAll('.pin').forEach(p => p.remove());

  const screen = getActive();
  if (!screen) return;

  screen.annotations.forEach(ann => {
    const pin = document.createElement('div');
    pin.className = 'pin' + (ann.id === selectedAnnotationId ? ' selected' : '');
    pin.style.cssText = `left:${ann.x}%;top:${ann.y}%;background:${ann.color};`;
    pin.innerHTML = `<span class="pin-number">${ann.num}</span>`;
    pin.title = ann.label;
    pin.onclick = e => {
      e.stopPropagation();
      selectedAnnotationId = ann.id;
      renderPins();
      renderAnnotations();
    };
    wrapper.appendChild(pin);
  });
}

function togglePinMode() {
  pinMode = !pinMode;
  updatePinModeUI();
}

function updatePinModeUI() {
  const btn = document.getElementById('btnAddPin');
  const dot = document.getElementById('modeDot');
  const txt = document.getElementById('modeText');
  const img = document.getElementById('mainImage');

  if (pinMode) {
    btn.style.color = 'var(--accent)';
    btn.style.borderColor = 'var(--accent)';
    dot.classList.add('active-pin');
    txt.textContent = 'modo marcador activo';
  } else {
    btn.style.color = '';
    btn.style.borderColor = '';
    dot.classList.remove('active-pin');
    txt.textContent = 'modo selección';
  }

  if (img) img.classList.toggle('mode-select', !pinMode);
}

function clearPins() {
  const screen = getActive();
  if (!screen || !screen.annotations.length) return;
  if (!confirm('¿Eliminar todos los marcadores de esta pantalla?')) return;
  pushUndo();
  screen.annotations = [];
  screen.pinCount = 0;
  selectedAnnotationId = null;
  renderPins();
  renderAnnotations();
  renderScreensList();
}

// ============================
// ANNOTATIONS PANEL
// ============================
function renderAnnotations() {
  const screen = getActive();
  const list = document.getElementById('annotationsList');
  const count = document.getElementById('annCount');

  if (!screen || screen.annotations.length === 0) {
    list.innerHTML = '<div class="empty-annotations">Activa el modo marcador (tecla <kbd>P</kbd>) y haz clic en la imagen para agregar anotaciones.</div>';
    count.textContent = '0';
    return;
  }

  count.textContent = screen.annotations.length;
  list.innerHTML = screen.annotations.map(ann => `
    <div class="annotation-card ${ann.id === selectedAnnotationId ? 'selected' : ''}" onclick="selectAnnotation('${ann.id}')">
      <div class="annotation-header">
        <div class="annotation-pin-dot" style="background:${ann.color}">${ann.num}</div>
        <input class="annotation-label-input" id="lbl_${ann.id}"
          value="${escHtml(ann.label)}"
          placeholder="Nombre del elemento…"
          oninput="updateAnnotation('${ann.id}','label',this.value)"
          onclick="event.stopPropagation()">
      </div>
      <textarea class="annotation-desc-input" id="desc_${ann.id}"
        placeholder="Describe la funcionalidad o acción de este elemento…"
        oninput="updateAnnotation('${ann.id}','desc',this.value)"
        onclick="event.stopPropagation()">${escHtml(ann.desc)}</textarea>
      <div class="annotation-actions">
        <button class="del-ann-btn" onclick="event.stopPropagation();deleteAnnotation('${ann.id}')">✕ eliminar</button>
      </div>
    </div>
  `).join('');

  if (selectedAnnotationId) {
    const card = list.querySelector('.annotation-card.selected');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function selectAnnotation(id) {
  selectedAnnotationId = id;
  renderPins();
  renderAnnotations();
}

function updateAnnotation(id, field, value) {
  const screen = getActive();
  if (!screen) return;
  const ann = screen.annotations.find(a => a.id === id);
  if (!ann) return;
  ann[field] = value;
  if (field === 'label') renderPins();
}

function deleteAnnotation(id) {
  pushUndo();
  const screen = getActive();
  if (!screen) return;
  screen.annotations = screen.annotations.filter(a => a.id !== id);
  if (selectedAnnotationId === id) selectedAnnotationId = null;
  renderPins();
  renderAnnotations();
  renderScreensList();
}

document.getElementById('sectionTitle').addEventListener('input', function () {
  const screen = getActive();
  if (screen) screen.sectionTitle = this.value;
});

document.getElementById('screenDescription').addEventListener('input', function () {
  const screen = getActive();
  if (screen) screen.description = this.value;
});

// ============================
// SAVE / LOAD PROJECT (JSON)
// ============================
function saveProject() {
  if (screens.length === 0) { alert('No hay contenido para guardar.'); return; }
  const project = {
    _docshot: '1.0',
    title: document.getElementById('manualTitle').value,
    version: document.getElementById('manualVersion').value,
    savedAt: new Date().toISOString(),
    screens,
  };
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const title = project.title || 'manual';
  a.href = url;
  a.download = title.replace(/\s+/g, '-').toLowerCase() + '.docshot.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadProject() {
  document.getElementById('projectFileInput').click();
}

document.getElementById('projectFileInput').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const project = JSON.parse(ev.target.result);
      if (!project._docshot || !Array.isArray(project.screens)) {
        alert('Archivo de proyecto inválido o corrupto.');
        return;
      }
      pushUndo();
      screens = project.screens.map(s => ({
        ...s,
        description: s.description || '',
        pinCount: s.pinCount || s.annotations.length,
        annotations: s.annotations || [],
      }));
      activeScreenId = screens.length ? screens[0].id : null;
      selectedAnnotationId = null;
      pinMode = false;
      document.getElementById('manualTitle').value = project.title || '';
      document.getElementById('manualVersion').value = project.version || '';
      renderScreensList();
      if (activeScreenId) selectScreen(activeScreenId);
      else showEmpty();
    } catch {
      alert('Error al cargar el proyecto: archivo inválido.');
    }
  };
  reader.readAsText(file);
  this.value = '';
});

// ============================
// EXPORT / PREVIEW
// ============================
function buildPreviewContent() {
  const title = document.getElementById('manualTitle').value || 'Manual de Usuario';
  const version = document.getElementById('manualVersion').value || 'v1.0';
  const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

  const sectionsHTML = screens.map((s, idx) => {
    const pinsHTML = s.annotations.map(ann => `
      <div class="preview-pin" style="left:${ann.x}%;top:${ann.y}%;background:${ann.color};">
        <div class="preview-pin-num">${ann.num}</div>
      </div>`).join('');

    const annsHTML = s.annotations.map(ann => `
      <div class="preview-ann-item">
        <div class="preview-ann-num" style="background:${ann.color}">${ann.num}</div>
        <div class="preview-ann-content">
          <div class="preview-ann-label">${escHtml(ann.label)}</div>
          ${ann.desc ? `<div class="preview-ann-desc">${escHtml(ann.desc)}</div>` : ''}
        </div>
      </div>`).join('');

    return `
      <div class="preview-section">
        <div class="preview-section-title">
          <span class="preview-section-num">${String(idx + 1).padStart(2, '0')}</span>
          ${escHtml(s.sectionTitle || s.name)}
        </div>
        ${s.description ? `<p class="preview-section-desc">${escHtml(s.description)}</p>` : ''}
        <div class="preview-img-container">
          <img src="${s.dataUrl}" alt="${escHtml(s.sectionTitle || s.name)}">
          ${pinsHTML}
        </div>
        ${s.annotations.length ? `<div class="preview-annotations">${annsHTML}</div>` : ''}
      </div>`;
  }).join('');

  return { title, version, date, sectionsHTML };
}

function buildExportHTML() {
  const { title, version, date, sectionsHTML } = buildPreviewContent();
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f8fafc; color: #1a1a2e; padding: 40px 20px; max-width: 900px; margin: 0 auto; }
    .preview-title { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 6px; font-family: monospace; }
    .preview-meta { font-size: 12px; color: #64748b; margin-bottom: 36px; font-family: monospace; }
    .preview-section { margin-bottom: 48px; background: white; border-radius: 10px; padding: 24px; border: 1px solid #e2e8f0; }
    .preview-section-title { font-size: 15px; font-weight: 600; color: #0f172a; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; font-family: monospace; display: flex; align-items: center; gap: 8px; }
    .preview-section-num { background: #0f172a; color: white; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .preview-section-desc { font-size: 14px; color: #475569; margin-bottom: 16px; line-height: 1.6; white-space: pre-wrap; }
    .preview-img-container { position: relative; display: inline-block; margin-bottom: 16px; max-width: 100%; }
    .preview-img-container img { max-width: 100%; border-radius: 6px; border: 1px solid #e2e8f0; display: block; }
    .preview-pin { position: absolute; width: 24px; height: 24px; border-radius: 50% 50% 50% 0; transform: translate(-50%, -100%) rotate(-45deg); border: 1.5px solid rgba(0,0,0,0.2); }
    .preview-pin-num { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(45deg); font-size: 10px; font-weight: 700; color: white; font-family: monospace; }
    .preview-annotations { margin-top: 8px; }
    .preview-ann-item { display: flex; gap: 10px; padding: 8px 12px; background: #f8fafc; border-left: 3px solid #e2e8f0; border-radius: 0 6px 6px 0; margin-bottom: 6px; align-items: flex-start; }
    .preview-ann-num { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; font-family: monospace; margin-top: 1px; }
    .preview-ann-label { font-size: 12px; font-weight: 600; color: #0f172a; font-family: monospace; }
    .preview-ann-desc { font-size: 13px; color: #475569; margin-top: 2px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="preview-title">${escHtml(title)}</div>
  <div class="preview-meta">Versión: ${escHtml(version)} · Generado: ${date} · ${screens.length} sección(es)</div>
  ${sectionsHTML}
</body>
</html>`;
}

function exportPDF() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }
  const { title, version, date, sectionsHTML } = buildPreviewContent();
  const filename = (document.getElementById('manualTitle').value || 'manual')
    .replace(/\s+/g, '-').toLowerCase();

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    @page {
      size: A4;
      margin: 18mm 16mm 18mm 16mm;
    }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      font-size: 13px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Cover ── */
    .cover {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0 10mm;
      page-break-after: always;
      break-after: page;
    }
    .cover-label {
      font-size: 10px;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 14px;
    }
    .cover-title {
      font-size: 32px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.2;
      margin-bottom: 12px;
    }
    .cover-meta {
      font-size: 12px;
      color: #64748b;
    }
    .cover-rule {
      width: 48px;
      height: 4px;
      background: #0f172a;
      border-radius: 2px;
      margin-bottom: 20px;
    }

    /* ── Section ── */
    .preview-section {
      break-before: page;
      page-break-before: always;
      padding-bottom: 8mm;
    }
    .preview-section:first-child { break-before: auto; page-break-before: avoid; }

    .preview-section-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 6px;
      padding-bottom: 6px;
      border-bottom: 2px solid #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .preview-section-num {
      background: #0f172a;
      color: white;
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 3px;
      font-family: monospace;
    }
    .preview-section-desc {
      font-size: 12px;
      color: #475569;
      margin: 8px 0 10px;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    /* ── Image ── */
    .preview-img-container {
      position: relative;
      display: block;
      width: 100%;
      margin-bottom: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .preview-img-container img {
      width: 100%;
      height: auto;
      display: block;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
    }

    /* ── Pins ── */
    .preview-pin {
      position: absolute;
      width: 22px;
      height: 22px;
      border-radius: 50% 50% 50% 0;
      transform: translate(-50%, -100%) rotate(-45deg);
      border: 1.5px solid rgba(0,0,0,0.25);
    }
    .preview-pin-num {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(45deg);
      font-size: 9px;
      font-weight: 700;
      color: white;
      font-family: monospace;
    }

    /* ── Annotations list ── */
    .preview-annotations {
      margin-top: 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .preview-ann-item {
      display: flex;
      gap: 8px;
      padding: 6px 10px;
      background: #f8fafc;
      border-left: 3px solid #e2e8f0;
      margin-bottom: 4px;
      align-items: flex-start;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .preview-ann-num {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      color: white;
      font-family: monospace;
      margin-top: 1px;
    }
    .preview-ann-label { font-size: 11px; font-weight: 600; color: #0f172a; font-family: monospace; }
    .preview-ann-desc { font-size: 12px; color: #475569; margin-top: 2px; white-space: pre-wrap; }
  </style>
</head>
<body>

  <!-- Cover page -->
  <div class="cover">
    <div class="cover-label">Manual de usuario</div>
    <div class="cover-rule"></div>
    <div class="cover-title">${escHtml(title)}</div>
    <div class="cover-meta">Versión ${escHtml(version)} &nbsp;·&nbsp; ${date} &nbsp;·&nbsp; ${screens.length} sección${screens.length !== 1 ? 'es' : ''}</div>
  </div>

  ${sectionsHTML}

  <script>
    window.onload = function() {
      document.title = ${JSON.stringify(filename)};
      setTimeout(function() { window.print(); }, 400);
    };
  <\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    alert('El navegador bloqueó la ventana emergente. Por favor, permite ventanas emergentes para este sitio e intenta de nuevo.');
    return;
  }
  // Revoke after the window has had time to load
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function exportMarkdown() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }
  const title = document.getElementById('manualTitle').value || 'Manual de Usuario';
  const version = document.getElementById('manualVersion').value || 'v1.0';
  const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

  let md = `# ${title}\n\n`;
  md += `**Versión:** ${version} &nbsp;·&nbsp; **Generado:** ${date}\n\n---\n\n`;

  screens.forEach((s, idx) => {
    md += `## ${String(idx + 1).padStart(2, '0')}. ${s.sectionTitle || s.name}\n\n`;
    if (s.description) md += `${s.description}\n\n`;
    md += `![${s.sectionTitle || s.name}](${s.dataUrl})\n\n`;
    if (s.annotations.length) {
      s.annotations.forEach(ann => {
        md += `**${ann.num}. ${ann.label}**`;
        if (ann.desc) md += `\\\n${ann.desc}`;
        md += '\n\n';
      });
    }
    md += '---\n\n';
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title.replace(/\s+/g, '-').toLowerCase() + '.md';
  a.click();
  URL.revokeObjectURL(url);
}

function openPreview() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }
  const { title, version, date, sectionsHTML } = buildPreviewContent();
  document.getElementById('manualPreview').innerHTML = `
    <div class="preview-title">${escHtml(title)}</div>
    <div class="preview-meta">Versión: ${escHtml(version)} · Generado: ${date} · ${screens.length} sección(es)</div>
    ${sectionsHTML}
  `;
  document.getElementById('previewModal').classList.add('open');
}

function closePreview() {
  document.getElementById('previewModal').classList.remove('open');
}

function exportHTML() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }
  const html = buildExportHTML();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const title = document.getElementById('manualTitle').value || 'manual';
  a.href = url;
  a.download = title.replace(/\s+/g, '-').toLowerCase() + '.html';
  a.click();
  URL.revokeObjectURL(url);
}

function clearAll() {
  if (!confirm('¿Limpiar todo el contenido?')) return;
  pushUndo();
  screens = [];
  activeScreenId = null;
  selectedAnnotationId = null;
  pinMode = false;
  document.getElementById('manualTitle').value = 'Manual de Usuario';
  document.getElementById('manualVersion').value = 'v1.0';
  renderScreensList();
  showEmpty();
}

// ============================
// EXPORT DOCX
// ============================
async function exportDOCX() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }

  const lib = window.docx;
  if (!lib) {
    alert('La librería Word no está disponible aún. Verifica tu conexión e intenta de nuevo en unos segundos.');
    return;
  }

  const {
    Document, Paragraph, TextRun, ImageRun, Packer,
    BorderStyle, HeadingLevel,
    convertInchesToTwip,
  } = lib;

  const title    = document.getElementById('manualTitle').value  || 'Manual de Usuario';
  const version  = document.getElementById('manualVersion').value || 'v1.0';
  const date     = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  const filename = title.replace(/\s+/g, '-').toLowerCase();

  // Helpers
  function dataUrlToUint8Array(dataUrl) {
    const binary = atob(dataUrl.split(',')[1]);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }

  function getImageMime(dataUrl) {
    if (dataUrl.includes('image/png'))  return 'png';
    if (dataUrl.includes('image/gif'))  return 'gif';
    if (dataUrl.includes('image/bmp'))  return 'bmp';
    if (dataUrl.includes('image/webp')) return 'png'; // fallback
    return 'jpg';
  }

  function getImageDimensions(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 800, h: 600 });
      img.src = dataUrl;
    });
  }

  // Max image width: ~6.3 inches at 96dpi = 605 px
  const MAX_W = 605;

  const children = [];

  // ── Cover ──────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'MANUAL DE USUARIO', size: 20, color: '94a3b8', characterSpacing: 120 })],
      spacing: { before: convertInchesToTwip(2.5), after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 64, color: '0f172a' })],
      spacing: { after: 300 },
      border: { bottom: { style: BorderStyle.THICK, size: 20, color: '0f172a', space: 6 } },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Versión ${version}`, size: 22, color: '475569' }),
        new TextRun({ text: '   ·   ', size: 22, color: 'cbd5e1' }),
        new TextRun({ text: date, size: 22, color: '475569' }),
        new TextRun({ text: '   ·   ', size: 22, color: 'cbd5e1' }),
        new TextRun({ text: `${screens.length} sección${screens.length !== 1 ? 'es' : ''}`, size: 22, color: '475569' }),
      ],
      spacing: { before: 200 },
      pageBreakBefore: false,
    }),
  );

  // ── Sections ────────────────────────────────────────
  for (const [idx, screen] of screens.entries()) {
    const sectionLabel = `${String(idx + 1).padStart(2, '0')}. ${screen.sectionTitle || screen.name}`;

    // Section heading (starts new page after cover)
    children.push(new Paragraph({
      children: [new TextRun({ text: sectionLabel, bold: true, size: 32, color: '0f172a' })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'e2e8f0', space: 4 } },
      pageBreakBefore: true,
    }));

    // Description
    if (screen.description) {
      children.push(new Paragraph({
        children: [new TextRun({ text: screen.description, size: 22, color: '475569' })],
        spacing: { after: 200 },
      }));
    }

    // Image
    try {
      const { w, h } = await getImageDimensions(screen.dataUrl);
      const scale    = w > MAX_W ? MAX_W / w : 1;
      const dispW    = Math.round(w * scale);
      const dispH    = Math.round(h * scale);

      children.push(new Paragraph({
        children: [new ImageRun({
          data: dataUrlToUint8Array(screen.dataUrl),
          transformation: { width: dispW, height: dispH },
          type: getImageMime(screen.dataUrl),
        })],
        spacing: { after: 160 },
      }));
    } catch (err) {
      console.warn('Error embedding image for screen:', screen.name, err);
    }

    // Annotations
    if (screen.annotations.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Anotaciones', bold: true, size: 22, color: '0f172a' })],
        spacing: { before: 120, after: 80 },
      }));

      for (const ann of screen.annotations) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${ann.num}.  `, bold: true, size: 20, color: '0f172a' }),
            new TextRun({ text: ann.label, bold: true, size: 20, color: '0f172a' }),
            ...(ann.desc
              ? [new TextRun({ text: ' — ', size: 20, color: 'cbd5e1' }),
                 new TextRun({ text: ann.desc, size: 20, color: '475569' })]
              : []),
          ],
          spacing: { before: 60, after: 60 },
          indent: { left: convertInchesToTwip(0.2) },
        }));
      }
    }
  }

  // Build & download
  const doc = new Document({
    creator: 'DocShot',
    title,
    description: `Manual generado con DocShot · ${date}`,
    styles: {
      paragraphStyles: [{
        id: 'Heading1',
        name: 'Heading 1',
        run: { bold: true, size: 32, color: '0f172a' },
      }],
    },
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename + '.docx';
  a.click();
  URL.revokeObjectURL(url);
}

// ============================
// EXPORT DROPDOWN
// ============================
function toggleExportMenu(id = 'exportDropdown') {
  const dropdown = document.getElementById(id);
  const isOpen = dropdown.classList.contains('open');
  // Close all dropdowns first
  document.querySelectorAll('.export-dropdown.open').forEach(d => d.classList.remove('open'));
  if (!isOpen) dropdown.classList.add('open');
}

function closeExportMenu(id = 'exportDropdown') {
  document.getElementById(id)?.classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.export-dropdown')) {
    document.querySelectorAll('.export-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

// ============================
// KEYBOARD SHORTCUTS
// ============================
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

  // Escape: close modal
  if (e.key === 'Escape') { closePreview(); return; }

  // Ctrl+Z / Cmd+Z: undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  if (isTyping) return;

  // P: toggle pin mode
  if (e.key === 'p' || e.key === 'P') {
    if (activeScreenId) togglePinMode();
  }
});

// Close modal on backdrop click
document.getElementById('previewModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closePreview();
});

// ============================
// UTILS
// ============================
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
