(() => {
  'use strict';

  const STORAGE_KEY = 'notas-rapidas-v1';
  const NONE = '__none__'; // filtro "Sin categoría"
  const CATEGORIES = [
    'Trabajo', 'Música', 'Series', 'Restaurante', 'Vino', 'Viaje', 'Libros',
    'App/Internet', 'Gestión', 'Personas', 'Deportes', 'Ocio', 'Compras', 'Idiomas',
  ];
  const SORTED = [...CATEGORIES].sort(new Intl.Collator('es').compare);

  const LONG_PRESS_MS = 350;   // pulsación prolongada para empezar a mover
  const MOVE_TOLERANCE = 10;   // px de movimiento que se interpretan como scroll
  const EDGE = 60;             // px desde el borde de la lista que activan el autoscroll
  const SCROLL_STEP = 6;

  const $ = (id) => document.getElementById(id);
  const el = {
    count: $('count'), chips: $('chips'), list: $('list'), empty: $('empty'),
    composer: $('composer'), text: $('new-text'), category: $('new-category'), send: $('send'),
    sheet: $('sheet'), editForm: $('edit-form'), editText: $('edit-text'),
    editCategory: $('edit-category'), editSave: $('edit-save'),
    editDelete: $('edit-delete'), editCancel: $('edit-cancel'),
  };

  const dateFmt = new Intl.DateTimeFormat('es', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  let notes = load();
  let filter = '';      // '' = todas, NONE = sin categoría, o nombre de categoría
  let editingId = null;
  let touch = null;     // estado del gesto táctil en curso
  let suppressClick = false;

  // ---------- Persistencia ----------

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(data)) {
        return data.filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string');
      }
    } catch (_) { /* datos corruptos: se empieza vacío */ }
    return [];
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch (_) {
      alert('No se pudo guardar. Libera espacio en el almacenamiento de Safari.');
    }
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------- Filtros y render ----------

  const matchesFilter = (note) => {
    if (!filter) return true;
    if (filter === NONE) return !note.category;
    return note.category === filter;
  };

  const visibleNotes = () => notes.filter(matchesFilter);

  function renderChips() {
    const hasUncategorized = notes.some((n) => !n.category);
    if (filter === NONE && !hasUncategorized) filter = '';

    const items = [['', 'Todas'], ...SORTED.map((c) => [c, c])];
    if (hasUncategorized) items.push([NONE, 'Sin categoría']);

    el.chips.replaceChildren(...items.map(([value, label]) => {
      const chip = document.createElement('button');
      const active = value === filter;
      chip.type = 'button';
      chip.className = 'chip' + (active ? ' active' : '');
      chip.dataset.value = value;
      chip.textContent = label;
      chip.setAttribute('aria-pressed', String(active));
      return chip;
    }));
  }

  function buildRow(note) {
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.id = note.id;

    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = note.text;

    const meta = document.createElement('span');
    meta.className = 'note-meta';
    meta.textContent = [note.category, dateFmt.format(new Date(note.createdAt || 0))]
      .filter(Boolean).join(' · ');

    li.append(text, meta);
    return li;
  }

  function render() {
    renderChips();
    const visible = visibleNotes();
    el.list.replaceChildren(...visible.map(buildRow));
    el.count.textContent = visible.length
      ? `${visible.length} ${visible.length === 1 ? 'nota' : 'notas'}`
      : '';
    el.empty.hidden = visible.length > 0;
    el.empty.textContent = notes.length
      ? 'No hay notas en esta categoría'
      : 'Escribe una idea abajo y pulsa enviar';
  }

  function fillCategoryOptions(select) {
    const options = [['', 'Sin categoría'], ...SORTED.map((c) => [c, c])];
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  }

  // ---------- Captura ----------

  el.text.addEventListener('input', () => {
    el.send.disabled = !el.text.value.trim();
  });

  el.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.text.value.trim();
    if (!text) return;

    notes.unshift({ id: newId(), text, category: el.category.value, createdAt: Date.now() });
    el.text.value = '';
    el.send.disabled = true;
    if (!matchesFilter(notes[0])) filter = ''; // que la nota nueva no desaparezca
    save();
    render();
    el.text.focus();
  });

  // ---------- Filtros ----------

  el.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.value;
    if (filter) el.category.value = filter === NONE ? '' : filter;
    render();
  });

  // ---------- Edición y borrado ----------

  function openEditor(id) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    editingId = id;
    el.editText.value = note.text;
    el.editCategory.value = note.category || '';
    el.editSave.disabled = !note.text.trim();
    el.sheet.showModal();
  }

  el.editText.addEventListener('input', () => {
    el.editSave.disabled = !el.editText.value.trim();
  });

  el.editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const note = notes.find((n) => n.id === editingId);
    const text = el.editText.value.trim();
    if (note && text) {
      note.text = text;
      note.category = el.editCategory.value;
      save();
    }
    el.sheet.close();
  });

  el.editCancel.addEventListener('click', () => el.sheet.close());

  el.editDelete.addEventListener('click', () => {
    if (!editingId || !confirm('¿Eliminar esta nota?')) return;
    notes = notes.filter((n) => n.id !== editingId);
    save();
    el.sheet.close();
  });

  // Se ejecuta con cualquier cierre (guardar, cancelar, Esc o eliminar)
  el.sheet.addEventListener('close', () => {
    editingId = null;
    render();
  });

  el.list.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const row = e.target.closest('.note');
    if (row) openEditor(row.dataset.id);
  });

  // ---------- Reordenar: pulsar y arrastrar arriba/abajo ----------

  el.list.addEventListener('touchstart', onTouchStart, { passive: true });
  el.list.addEventListener('touchmove', onTouchMove, { passive: false });
  el.list.addEventListener('touchend', endTouch);
  el.list.addEventListener('touchcancel', endTouch);

  function onTouchStart(e) {
    suppressClick = false;
    if (e.touches.length !== 1) {
      endTouch();
      return;
    }
    const row = e.target.closest('.note');
    if (!row) return;
    const t = e.touches[0];
    touch = {
      row,
      startX: t.clientX,
      startY: t.clientY,
      lastY: t.clientY,
      dragging: false,
      grabOffset: 0,
      translate: 0,
      frame: 0,
      timer: setTimeout(startDrag, LONG_PRESS_MS),
    };
  }

  function onTouchMove(e) {
    if (!touch) return;
    const t = e.touches[0];
    touch.lastY = t.clientY;

    if (!touch.dragging) {
      // Movimiento antes de la pulsación prolongada: es un scroll normal
      if (Math.abs(t.clientX - touch.startX) > MOVE_TOLERANCE ||
          Math.abs(t.clientY - touch.startY) > MOVE_TOLERANCE) {
        clearTimeout(touch.timer);
        touch = null;
      }
      return;
    }

    e.preventDefault(); // evita que la lista se desplace mientras arrastras
    moveDrag(t.clientY);
  }

  function startDrag() {
    if (!touch) return;
    touch.dragging = true;
    suppressClick = true;
    touch.grabOffset = touch.lastY - touch.row.getBoundingClientRect().top;
    touch.row.classList.add('dragging');
    autoScrollLoop();
  }

  function moveDrag(y) {
    const { row } = touch;
    const top = y - touch.grabOffset;
    const centre = top + row.offsetHeight / 2;

    let prev;
    let next;
    while ((prev = row.previousElementSibling) && centre < midY(prev)) {
      el.list.insertBefore(row, prev);
    }
    while ((next = row.nextElementSibling) && centre > midY(next)) {
      el.list.insertBefore(row, next.nextElementSibling);
    }

    // Mantiene la fila bajo el dedo aunque haya cambiado su posición en el DOM
    const natural = row.getBoundingClientRect().top - touch.translate;
    touch.translate = top - natural;
    row.style.transform = `translate3d(0, ${touch.translate}px, 0)`;
  }

  function autoScrollLoop() {
    if (!touch || !touch.dragging) return;
    const box = el.list.getBoundingClientRect();
    const y = touch.lastY;
    let step = 0;
    if (y < box.top + EDGE) step = -SCROLL_STEP;
    else if (y > box.bottom - EDGE) step = SCROLL_STEP;

    if (step) {
      const before = el.list.scrollTop;
      el.list.scrollTop += step;
      if (el.list.scrollTop !== before) moveDrag(y);
    }
    touch.frame = requestAnimationFrame(autoScrollLoop);
  }

  function endTouch() {
    if (!touch) return;
    clearTimeout(touch.timer);
    if (touch.dragging) finishDrag();
    touch = null;
  }

  function finishDrag() {
    cancelAnimationFrame(touch.frame);
    const ids = [...el.list.children].map((li) => li.dataset.id);
    applyVisibleOrder(ids);
    save();
    render();
  }

  // Las notas visibles ocupan sus mismas posiciones en la lista global;
  // así reordenar con un filtro activo no altera las notas ocultas.
  function applyVisibleOrder(ids) {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const visibleIds = new Set(visibleNotes().map((n) => n.id));
    const reordered = ids.map((id) => byId.get(id)).filter(Boolean);
    let i = 0;
    notes = notes.map((n) => (visibleIds.has(n.id) ? reordered[i++] : n));
  }

  function midY(node) {
    const r = node.getBoundingClientRect();
    return r.top + r.height / 2;
  }

  // ---------- Arranque ----------

  fillCategoryOptions(el.category);
  fillCategoryOptions(el.editCategory);
  render();
})();
