// ============================
// CONSTANTS & STATE
// ============================
const PIN_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
const MAX_UNDO = 20;
const AUTOSAVE_KEY = 'docshot_autosave';
let _autoSaveTimer = null;

// screens: [{ id, name, dataUrl, sectionTitle, description, pinCount, annotations: [{id, x, y, label, desc, color, num}] }]
let screens = [];
let coverPhotoUrl = null;
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
  scheduleAutoSave();
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

  chain.finally(() => { fileInput.value = ''; scheduleAutoSave(); });
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
  scheduleAutoSave();
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
  scheduleAutoSave();
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

// Reassigns num 1,2,3… based on current array order after any add/delete
function renumberAnnotations(screen) {
  screen.annotations.forEach((ann, idx) => { ann.num = idx + 1; });
  screen.pinCount = screen.annotations.length;
}

function handleImageClick(e) {
  if (!pinMode) return;
  const screen = getActive();
  if (!screen) return;

  pushUndo();

  const rect = e.target.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;

  const nextNum = screen.annotations.length + 1;
  const ann = {
    id: 'ann_' + Date.now(),
    x,
    y,
    label: 'Elemento ' + nextNum,
    desc: '',
    color: selectedPinColor,
    num: nextNum,
  };

  screen.annotations.push(ann);
  renumberAnnotations(screen);
  selectedAnnotationId = ann.id;
  renderPins();
  renderAnnotations();
  renderScreensList();
  scheduleAutoSave();

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

    // Select on click (only if not a drag)
    pin.addEventListener('click', e => { e.stopPropagation(); });

    // Drag to reposition
    pin.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      selectedAnnotationId = ann.id;
      renderPins();
      renderAnnotations();
      startPinDrag(e, ann);
    });

    wrapper.appendChild(pin);
  });
}

function startPinDrag(e, ann) {
  pushUndo();
  const imgEl = document.getElementById('mainImage');
  let moved = false;

  const onMove = moveE => {
    moved = true;
    const rect = imgEl.getBoundingClientRect();
    ann.x = Math.max(0, Math.min(100, ((moveE.clientX - rect.left) / rect.width) * 100));
    ann.y = Math.max(0, Math.min(100, ((moveE.clientY - rect.top) / rect.height) * 100));
    renderPins();
  };

  const onUp = upE => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const dx = upE.clientX - e.clientX;
    const dy = upE.clientY - e.clientY;
    // If barely moved (<5px), it was a click — discard the undo entry
    if (!moved || Math.sqrt(dx * dx + dy * dy) < 5) undoStack.pop();
    else scheduleAutoSave();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
  scheduleAutoSave();
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
  scheduleAutoSave();
}

function deleteAnnotation(id) {
  pushUndo();
  const screen = getActive();
  if (!screen) return;
  screen.annotations = screen.annotations.filter(a => a.id !== id);
  if (selectedAnnotationId === id) selectedAnnotationId = null;
  renumberAnnotations(screen);
  renderPins();
  renderAnnotations();
  renderScreensList();
  scheduleAutoSave();
}

document.getElementById('sectionTitle').addEventListener('input', function () {
  const screen = getActive();
  if (screen) { screen.sectionTitle = this.value; scheduleAutoSave(); }
});

document.getElementById('screenDescription').addEventListener('input', function () {
  const screen = getActive();
  if (screen) { screen.description = this.value; scheduleAutoSave(); }
});

document.getElementById('manualTitle').addEventListener('input', scheduleAutoSave);
document.getElementById('manualVersion').addEventListener('input', scheduleAutoSave);

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
    coverPhotoUrl: coverPhotoUrl || null,
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
  localStorage.removeItem(AUTOSAVE_KEY);
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
      coverPhotoUrl = project.coverPhotoUrl || null;
      activeScreenId = screens.length ? screens[0].id : null;
      selectedAnnotationId = null;
      pinMode = false;
      document.getElementById('manualTitle').value = project.title || '';
      document.getElementById('manualVersion').value = project.version || '';
      renderScreensList();
      renderCoverPhotoUI();
      if (activeScreenId) selectScreen(activeScreenId);
      else showEmpty();
      scheduleAutoSave();
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

  return { title, version, date, sectionsHTML, coverPhotoUrl };
}

function buildExportHTML() {
  const { title, version, date, sectionsHTML, coverPhotoUrl: cover } = buildPreviewContent();
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
    .preview-pin { position: absolute; width: 22px; height: 22px; border-radius: 50%; transform: translate(-50%, -50%); border: 2px solid rgba(255,255,255,0.6); box-shadow: 0 1px 4px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
    .preview-pin-num { font-size: 10px; font-weight: 700; color: white; font-family: monospace; line-height: 1; }
    .preview-annotations { margin-top: 8px; }
    .preview-ann-item { display: flex; gap: 10px; padding: 8px 12px; background: #f8fafc; border-left: 3px solid #e2e8f0; border-radius: 0 6px 6px 0; margin-bottom: 6px; align-items: flex-start; }
    .preview-ann-num { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; font-family: monospace; margin-top: 1px; }
    .preview-ann-label { font-size: 12px; font-weight: 600; color: #0f172a; font-family: monospace; }
    .preview-ann-desc { font-size: 13px; color: #475569; margin-top: 2px; white-space: pre-wrap; }
    .export-cover-img { width: 100%; max-height: 420px; object-fit: cover; border-radius: 8px; margin-bottom: 28px; display: block; }
  </style>
</head>
<body>
  ${cover ? `<img class="export-cover-img" src="${cover}" alt="Portada">` : ''}
  <div class="preview-title">${escHtml(title)}</div>
  ${sectionsHTML}
</body>
</html>`;
}

function loadHtml2PdfLib() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.onload  = () => resolve(window.html2pdf);
    script.onerror = () => reject(new Error('CDN no disponible'));
    document.head.appendChild(script);
  });
}

async function exportPDF() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }

  // Loading feedback on all PDF buttons
  const pdfBtns = [...document.querySelectorAll('.export-item')].filter(b => b.textContent.includes('PDF'));
  pdfBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });

  let lib;
  try {
    lib = await loadHtml2PdfLib();
  } catch {
    alert('No se pudo cargar la librería PDF. Verifica tu conexión e intenta de nuevo.');
    pdfBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    return;
  }

  const { title, version, date, sectionsHTML, coverPhotoUrl: cover } = buildPreviewContent();
  const filename = (document.getElementById('manualTitle').value || 'manual')
    .replace(/\s+/g, '-').toLowerCase();

  // Build content with all CSS inlined (no full document wrapper — html2pdf renders a fragment)
  const content = `
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body, .pdf-root {
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #0f172a;
    font-size: 13px;
    background: #fff;
  }

  /* ── Cover ── */
  .cover {
    min-height: 257mm;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 20mm 12mm 18mm;
    page-break-after: always;
    break-after: page;
    position: relative;
    overflow: hidden;
  }
  .cover-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.22;
    z-index: 0;
  }
  .cover-label, .cover-rule, .cover-title, .cover-meta { position: relative; z-index: 1; }
  .cover-label {
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 14px;
  }
  .cover-rule {
    width: 48px;
    height: 4px;
    background: #0f172a;
    border-radius: 2px;
    margin-bottom: 20px;
  }
  .cover-title {
    font-size: 32px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
    margin-bottom: 12px;
  }
  .cover-meta { font-size: 12px; color: #64748b; }

  /* ── Sections ── */
  .preview-section {
    page-break-before: always;
    break-before: page;
    padding-bottom: 8mm;
  }
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
    page-break-inside: avoid;
    break-inside: avoid;
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
    width: 20px;
    height: 20px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid rgba(255,255,255,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .preview-pin-num {
    font-size: 9px;
    font-weight: 700;
    color: white;
    font-family: monospace;
    line-height: 1;
  }

  /* ── Annotations ── */
  .preview-annotations { margin-top: 6px; page-break-inside: avoid; break-inside: avoid; }
  .preview-ann-item {
    display: flex;
    gap: 8px;
    padding: 6px 10px;
    background: #f8fafc;
    border-left: 3px solid #e2e8f0;
    margin-bottom: 4px;
    align-items: flex-start;
    page-break-inside: avoid;
    break-inside: avoid;
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
  .preview-ann-desc  { font-size: 12px; color: #475569; margin-top: 2px; white-space: pre-wrap; }
</style>

<div class="pdf-root">
  <div class="cover">
    ${cover ? `<img class="cover-bg-img" src="${cover}" alt="">` : ''}
    <div class="cover-label">Manual de usuario</div>
    <div class="cover-rule"></div>
    <div class="cover-title">${escHtml(title)}</div>
    <div class="cover-meta">Versión ${escHtml(version)} &nbsp;·&nbsp; ${date} &nbsp;·&nbsp; ${screens.length} sección${screens.length !== 1 ? 'es' : ''}</div>
  </div>
  ${sectionsHTML}
</div>`;

  // Temporary off-screen container so html2canvas can render it
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;top:0;left:-9999px;width:794px;background:#fff;';
  container.innerHTML = content;
  document.body.appendChild(container);

  try {
    await lib()
      .set({
        margin: [18, 16, 18, 16],
        filename: filename + '.pdf',
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(container)
      .save();
  } catch (err) {
    console.error('Error generando PDF:', err);
    alert('Ocurrió un error al generar el PDF. Intenta de nuevo.');
  } finally {
    document.body.removeChild(container);
    pdfBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }
}

function exportMarkdown() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }
  const title = document.getElementById('manualTitle').value || 'Manual de Usuario';
  const version = document.getElementById('manualVersion').value || 'v1.0';
  const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

  let md = `# ${title}\n\n`;
  if (coverPhotoUrl) md += `![Portada](${coverPhotoUrl})\n\n`;

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
  const { title, version, date, sectionsHTML, coverPhotoUrl: cover } = buildPreviewContent();
  document.getElementById('manualPreview').innerHTML = `
    ${cover ? `<div class="preview-cover"><img class="preview-cover-img" src="${cover}" alt="Portada"></div>` : ''}
    <div class="preview-title">${escHtml(title)}</div>
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
  coverPhotoUrl = null;
  activeScreenId = null;
  selectedAnnotationId = null;
  pinMode = false;
  document.getElementById('manualTitle').value = 'Manual de Usuario';
  document.getElementById('manualVersion').value = 'v1.0';
  renderScreensList();
  renderCoverPhotoUI();
  showEmpty();
  localStorage.removeItem(AUTOSAVE_KEY);
}

// ============================
// COVER PHOTO
// ============================
document.getElementById('coverPhotoInput').addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  readFileAsDataURL(file).then(dataUrl => {
    coverPhotoUrl = dataUrl;
    renderCoverPhotoUI();
    scheduleAutoSave();
  });
  this.value = '';
});

const coverPhotoZone = document.getElementById('coverPhotoZone');
coverPhotoZone.addEventListener('dragover', e => { e.preventDefault(); coverPhotoZone.classList.add('dragover'); });
coverPhotoZone.addEventListener('dragleave', () => coverPhotoZone.classList.remove('dragover'));
coverPhotoZone.addEventListener('drop', e => {
  e.preventDefault();
  coverPhotoZone.classList.remove('dragover');
  const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
  if (!file) return;
  readFileAsDataURL(file).then(dataUrl => {
    coverPhotoUrl = dataUrl;
    renderCoverPhotoUI();
    scheduleAutoSave();
  });
});

function removeCoverPhoto() {
  coverPhotoUrl = null;
  renderCoverPhotoUI();
  scheduleAutoSave();
}

function renderCoverPhotoUI() {
  const preview = document.getElementById('coverPhotoPreview');
  const empty = document.getElementById('coverPhotoEmpty');
  const removeBtn = document.getElementById('removeCoverPhotoBtn');
  if (coverPhotoUrl) {
    preview.src = coverPhotoUrl;
    preview.style.display = 'block';
    empty.style.display = 'none';
    removeBtn.style.display = 'flex';
  } else {
    preview.style.display = 'none';
    empty.style.display = 'flex';
    removeBtn.style.display = 'none';
  }
}

// ============================
// CANVAS PIN COMPOSITING
// ============================

/**
 * Draws a compact numbered circle centered at (cx, cy) on the canvas.
 */
function drawPinOnCanvas(ctx, cx, cy, color, num, size) {
  const r = size * 0.5;

  ctx.save();

  // Drop shadow
  ctx.shadowColor   = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur    = size * 0.3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = size * 0.1;

  // Filled circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // White border
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = Math.max(1.5, size * 0.07);
  ctx.stroke();

  ctx.restore();

  // Number label
  ctx.save();
  ctx.font         = `bold ${Math.round(r * 1.05)}px monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = 'white';
  ctx.shadowColor  = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur   = 2;
  ctx.fillText(String(num), cx, cy);
  ctx.restore();
}

/**
 * Returns a Promise<{ dataUrl: string, width: number, height: number }>
 * with the screen image composited with all its pin markers drawn on top.
 */
function compositeImageWithPins(screen) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas  = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx     = canvas.getContext('2d');

      ctx.drawImage(img, 0, 0);

      if (screen.annotations.length) {
        // Pin size scales with image but stays between 20–52 px
        const pinSize = Math.max(20, Math.min(img.naturalWidth * 0.025, 52));
        for (const ann of screen.annotations) {
          const x = (ann.x / 100) * img.naturalWidth;
          const y = (ann.y / 100) * img.naturalHeight;
          drawPinOnCanvas(ctx, x, y, ann.color, ann.num, pinSize);
        }
      }

      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        width:   img.naturalWidth,
        height:  img.naturalHeight,
      });
    };
    img.onerror = () => resolve({ dataUrl: screen.dataUrl, width: 800, height: 600 });
    img.src = screen.dataUrl;
  });
}

// ============================
// EXPORT DOCX
// ============================
function loadDocxLib() {
  if (window.docx) return Promise.resolve(window.docx);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/docx@7.8.2/build/index.js';
    script.onload  = () => resolve(window.docx);
    script.onerror = () => reject(new Error('CDN no disponible'));
    document.head.appendChild(script);
  });
}

async function exportDOCX() {
  if (screens.length === 0) { alert('Agrega al menos una pantalla primero.'); return; }

  let lib;
  try {
    lib = await loadDocxLib();
  } catch {
    alert('No se pudo cargar la librería Word. Verifica tu conexión a internet e intenta de nuevo.');
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

  // Max image width: ~6.3 inches at 96dpi = 605 px
  const MAX_W = 605;

  const children = [];

  // ── Cover ──────────────────────────────────────────
  if (coverPhotoUrl) {
    try {
      const coverImg = new Image();
      await new Promise(res => { coverImg.onload = res; coverImg.onerror = res; coverImg.src = coverPhotoUrl; });
      const coverW = Math.min(coverImg.naturalWidth || 800, 605);
      const coverH = coverImg.naturalHeight
        ? Math.round((coverImg.naturalHeight / (coverImg.naturalWidth || coverW)) * coverW)
        : Math.round(coverW * 9 / 16);
      children.push(new Paragraph({
        children: [new ImageRun({
          data: dataUrlToUint8Array(coverPhotoUrl),
          transformation: { width: coverW, height: coverH },
          type: coverPhotoUrl.startsWith('data:image/png') ? 'png' : 'jpg',
        })],
        spacing: { after: 320 },
      }));
    } catch (err) {
      console.warn('Error embedding cover photo in DOCX:', err);
    }
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 64, color: '0f172a' })],
      spacing: { after: 300 },
      border: { bottom: { style: BorderStyle.THICK, size: 20, color: '0f172a', space: 6 } },
    }),
  );

  // ── Sections ────────────────────────────────────────
  for (const [idx, screen] of screens.entries()) {
    const sectionLabel = `${String(idx + 1).padStart(2, '0')}. ${screen.sectionTitle || screen.name}`;

    // Section heading (starts new page after cover)
    children.push(new Paragraph({
      children: [new TextRun({ text: sectionLabel, bold: true, size: 36, color: '0f172a' })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'e2e8f0', space: 4 } },
      pageBreakBefore: true,
    }));

    // Description
    if (screen.description) {
      children.push(new Paragraph({
        children: [new TextRun({ text: screen.description, size: 28, color: '475569' })],
        spacing: { after: 200 },
      }));
    }

    // Image — composited with pin markers drawn on top
    try {
      const { dataUrl: compositeUrl, width: w, height: h } = await compositeImageWithPins(screen);
      const scale = w > MAX_W ? MAX_W / w : 1;
      const dispW = Math.round(w * scale);
      const dispH = Math.round(h * scale);

      children.push(new Paragraph({
        children: [new ImageRun({
          data: dataUrlToUint8Array(compositeUrl),
          transformation: { width: dispW, height: dispH },
          type: 'png',
        })],
        spacing: { after: 160 },
      }));
    } catch (err) {
      console.warn('Error embedding image for screen:', screen.name, err);
    }

    // Annotations
    if (screen.annotations.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Anotaciones', bold: true, size: 26, color: '0f172a' })],
        spacing: { before: 120, after: 80 },
      }));

      for (const ann of screen.annotations) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${ann.num}.  `, bold: true, size: 24, color: '0f172a' }),
            new TextRun({ text: ann.label, bold: true, size: 24, color: '0f172a' }),
            ...(ann.desc
              ? [new TextRun({ text: ': ', bold:true,size: 24, color: '0f172a' }),
                 new TextRun({ text: ann.desc, size: 24, color: '475569' })]
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
    description: "Manual de usuario",
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
// AUTO-SAVE (localStorage)
// ============================
function scheduleAutoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(doAutoSave, 2000);
}

function doAutoSave() {
  if (!screens.length) return;
  try {
    const data = JSON.stringify({
      _docshot: '1.0',
      title: document.getElementById('manualTitle').value,
      version: document.getElementById('manualVersion').value,
      savedAt: new Date().toISOString(),
      coverPhotoUrl: coverPhotoUrl || null,
      screens,
    });
    localStorage.setItem(AUTOSAVE_KEY, data);
    _showAutoSaveStatus();
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      _showAutoSaveStatus('⚠ Sin espacio para auto-guardar');
    }
  }
}

function _showAutoSaveStatus(msg) {
  const el = document.getElementById('autoSaveStatus');
  if (!el) return;
  const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  el.textContent = msg || `auto-guardado ${time}`;
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 4000);
}

function checkAutoSave() {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    if (!data) return;
    const project = JSON.parse(data);
    if (!project._docshot || !Array.isArray(project.screens) || !project.screens.length) return;
    const banner = document.getElementById('autoSaveBanner');
    const timeEl = document.getElementById('autoSaveTime');
    if (banner) {
      if (timeEl && project.savedAt) {
        const d = new Date(project.savedAt);
        timeEl.textContent = d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      }
      banner.style.display = 'flex';
    }
  } catch { /* ignore */ }
}

function restoreAutoSave() {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    if (!data) return;
    const project = JSON.parse(data);
    if (!project._docshot || !Array.isArray(project.screens)) return;
    screens = project.screens.map(s => ({
      ...s,
      description: s.description || '',
      pinCount: s.pinCount || s.annotations.length,
      annotations: s.annotations || [],
    }));
    coverPhotoUrl = project.coverPhotoUrl || null;
    activeScreenId = screens.length ? screens[0].id : null;
    selectedAnnotationId = null;
    pinMode = false;
    document.getElementById('manualTitle').value = project.title || '';
    document.getElementById('manualVersion').value = project.version || '';
    renderScreensList();
    renderCoverPhotoUI();
    if (activeScreenId) selectScreen(activeScreenId);
    else showEmpty();
  } catch {
    alert('Error al restaurar el auto-guardado.');
  }
  dismissAutoSaveBanner();
}

function dismissAutoSaveBanner() {
  const banner = document.getElementById('autoSaveBanner');
  if (banner) banner.style.display = 'none';
}

// Check for auto-saved data when the app loads
checkAutoSave();

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
