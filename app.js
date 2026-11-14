(() => {
  'use strict';

  const STORAGE_KEY = 'notas-rapidas-v1';
  const NONE = '__none__'; // filtro "Sin categoría"
  const CATEGORIES = [
    'Trabajo', 'Música', 'Series', 'Restaurante', 'Bebidas/Comidas', 'Viaje', 'Libros',
    'App/Internet', 'Gestión', 'Personas', 'Deportes', 'Ocio', 'Compras', 'Idiomas',
  ];
  // Categorías que cambiaron de nombre: las notas guardadas pasan al nombre nuevo al cargar
  const RENAMED = new Map([['Vino', 'Bebidas/Comidas']]);
  const SORTED = [...CATEGORIES].sort(new Intl.Collator('es').compare);

  const LONG_PRESS_MS = 350;   // pulsación prolongada para empezar a mover
  const MOVE_TOLERANCE = 10;   // px de movimiento que se interpretan como scroll
  const EDGE = 60;             // px desde el borde de la lista que activan el autoscroll
  const SCROLL_STEP = 6;

  const SWIPE_REVEAL = 84;         // px que queda abierto el botón Eliminar
  const SWIPE_DELETE_RATIO = 0.55; // fracción del ancho a partir de la cual se elimina al soltar
  const REMOVE_MS = 360;           // duración de la animación de borrado (ver .note.removing)

  const GRIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor"/>`).join('') +
    '</svg>';

  const $ = (id) => document.getElementById(id);
  const el = {
    count: $('count'), filterBtn: $('filter-btn'), list: $('list'), empty: $('empty'),
    composer: $('composer'), text: $('new-text'), catBtn: $('new-category'), send: $('send'),
    menu: $('menu'), backdrop: $('menu-backdrop'),
    sheet: $('sheet'), editForm: $('edit-form'), editText: $('edit-text'),
    editCategory: $('edit-category'), editSave: $('edit-save'),
    editDelete: $('edit-delete'), editCancel: $('edit-cancel'),
  };

  let notes = load();
  let filter = '';      // '' = todas, NONE = sin categoría, o nombre de categoría
  let newCategory = ''; // categoría elegida para la próxima nota ('' = sin categoría)
  let menuMode = null;  // 'filter', 'composer' o null si el menú está cerrado
  let editingId = null;
  let touch = null;     // estado del gesto táctil en curso
  let openRow = null;   // fila con el botón Eliminar descubierto
  let suppressClick = false;

  // ---------- Persistencia ----------

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(data)) {
        return data
          .filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string')
          .map((n) => (RENAMED.has(n.category) ? { ...n, category: RENAMED.get(n.category) } : n));
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

  const categoryOptions = () => [['', 'Sin categoría'], ...SORTED.map((c) => [c, c])];

  // "Sin categoría" en el filtro solo aparece si hay notas sin categoría
  function filterOptions() {
    const hasUncategorized = notes.some((n) => !n.category);
    const options = [['', 'Todas'], ...SORTED.map((c) => [c, c])];
    if (hasUncategorized) options.push([NONE, 'Sin categoría']);
    return options;
  }

  function renderFilterButton() {
    if (filter === NONE && !notes.some((n) => !n.category)) filter = '';
    const label = filter === NONE ? 'Sin categoría' : (filter || 'Todas');
    el.filterBtn.textContent = `${label} ▾`;
  }

  function renderCategoryButton() {
    el.catBtn.textContent = `${newCategory || 'Sin categoría'} ▾`;
  }

  function buildRow(note) {
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.id = note.id;

    // Deslizar a la izquierda descubre el botón rojo Eliminar, como en el iPhone
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'swipe-delete';
    remove.tabIndex = -1;
    const label = document.createElement('span');
    label.textContent = 'Eliminar';
    remove.append(label);

    const front = document.createElement('div');
    front.className = 'note-front';

    const body = document.createElement('div');
    body.className = 'note-body';

    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = note.text;

    body.append(text);
    if (note.category) {
      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = note.category;
      body.append(meta);
    }

    // Asa de la derecha: se arrastra arriba o abajo para ordenar
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.innerHTML = GRIP_ICON;

    front.append(body, grip);
    li.append(remove, front);
    return li;
  }

  function render() {
    renderFilterButton();
    renderCategoryButton();
    openRow = null;
    el.list.replaceChildren(...visibleNotes().map(buildRow));
    renderCount();
  }

  function renderCount() {
    const count = visibleNotes().length;
    el.count.textContent = count ? `${count} ${count === 1 ? 'nota' : 'notas'}` : '';
    el.empty.hidden = count > 0;
    el.empty.textContent = notes.length
      ? 'No hay notas en esta categoría'
      : 'Escribe una idea abajo y pulsa enviar';
  }

  function fillCategoryOptions(select) {
    select.replaceChildren(...categoryOptions().map(([value, label]) => new Option(label, value)));
  }

  // ---------- Captura ----------

  el.text.addEventListener('input', () => {
    el.send.disabled = !el.text.value.trim();
  });

  el.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.text.value.trim();
    if (!text) return;

    notes.unshift({ id: newId(), text, category: newCategory, createdAt: Date.now() });
    el.text.value = '';
    el.send.disabled = true;
    if (!matchesFilter(notes[0])) filter = ''; // que la nota nueva no desaparezca
    save();
    render();
    el.text.focus();
  });

  // ---------- Filtros ----------

  // Un único desplegable (lista completa, sin desplazarse) para el filtro y para la categoría de la nota
  function openMenu(mode) {
    const current = mode === 'filter' ? filter : newCategory;
    const options = mode === 'filter' ? filterOptions() : categoryOptions();
    el.menu.replaceChildren(...options.map(([value, label]) => {
      const item = document.createElement('button');
      const selected = value === current;
      item.type = 'button';
      item.className = 'menu-item' + (selected ? ' selected' : '');
      item.dataset.value = value;
      item.textContent = label;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(selected));
      return item;
    }));

    const anchor = (mode === 'filter' ? el.filterBtn : el.catBtn).getBoundingClientRect();
    if (mode === 'filter') {
      el.menu.style.top = `${anchor.bottom + 6}px`;
      el.menu.style.bottom = 'auto';
    } else {
      el.menu.style.top = 'auto';
      el.menu.style.bottom = `${window.innerHeight - anchor.top + 6}px`;
      // Fondo opaco hasta la barra de captura: no se ven las notas anteriores
      el.backdrop.classList.add('solid');
      el.backdrop.style.bottom = `${window.innerHeight - anchor.top}px`;
    }

    menuMode = mode;
    (mode === 'filter' ? el.filterBtn : el.catBtn).setAttribute('aria-expanded', 'true');
    el.menu.hidden = false;
    el.backdrop.hidden = false;
  }

  function closeMenu() {
    (menuMode === 'filter' ? el.filterBtn : el.catBtn).setAttribute('aria-expanded', 'false');
    el.menu.hidden = true;
    el.backdrop.hidden = true;
    el.backdrop.classList.remove('solid');
    el.backdrop.style.bottom = '';
    menuMode = null;
  }

  function toggleMenu(mode) {
    const wasOpen = menuMode === mode;
    closeMenu();
    if (!wasOpen) openMenu(mode);
  }

  el.filterBtn.addEventListener('click', () => toggleMenu('filter'));
  el.catBtn.addEventListener('click', () => toggleMenu('composer'));
  el.backdrop.addEventListener('click', closeMenu);

  el.menu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const value = item.dataset.value;
    if (menuMode === 'filter') {
      filter = value;
      if (value) newCategory = value === NONE ? '' : value; // la próxima nota hereda el filtro
    } else {
      newCategory = value;
    }
    closeMenu();
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
    if (openRow) {
      if (e.target.closest('.swipe-delete')) removeNote(openRow);
      else closeSwipe();
      return;
    }
    const row = e.target.closest('.note');
    if (row) openEditor(row.dataset.id);
  });

  // ---------- Gestos: deslizar a la izquierda para eliminar; arrastrar el asa (o mantener
  // pulsada la nota) y mover arriba/abajo para reordenar ----------

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
    if (openRow && row !== openRow) {
      // Tocar fuera de la fila abierta solo la cierra
      closeSwipe();
      suppressClick = true;
      return;
    }
    if (!row || row.classList.contains('removing')) return;
    const t = e.touches[0];
    const grip = row !== openRow && !!e.target.closest('.grip');
    touch = {
      row,
      grip,
      decided: false, // desde el asa: ya se sabe si el gesto es ordenar o eliminar
      startX: t.clientX,
      startY: t.clientY,
      lastY: t.clientY,
      dragging: false,
      grabOffset: 0,
      translate: 0,
      frame: 0,
      swiping: false,
      swipeBase: row === openRow ? -SWIPE_REVEAL : 0,
      swipeX: 0,
      timer: row === openRow || grip ? 0 : setTimeout(startDrag, LONG_PRESS_MS),
    };
    if (grip) startDrag(); // el asa mueve la nota al instante, sin pulsación prolongada
  }

  // Un toque fuera de la lista también cierra la fila abierta
  document.addEventListener('touchstart', (e) => {
    if (openRow && !el.list.contains(e.target)) closeSwipe();
  }, { passive: true });

  function onTouchMove(e) {
    if (!touch) return;
    const t = e.touches[0];
    touch.lastY = t.clientY;

    if (touch.swiping) {
      if (e.cancelable) e.preventDefault();
      moveSwipe(t.clientX);
      return;
    }

    const dx = t.clientX - touch.startX;
    const dy = t.clientY - touch.startY;
    const moved = Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE;
    const leftwards = Math.abs(dx) > Math.abs(dy) && (dx < 0 || touch.swipeBase);

    if (!touch.dragging) {
      if (!moved) return;
      clearTimeout(touch.timer);
      // Movimiento antes de la pulsación prolongada: hacia la izquierda (o sobre la fila
      // ya abierta) es deslizar para eliminar; cualquier otro es un scroll normal
      if (leftwards) {
        if (e.cancelable) e.preventDefault();
        startSwipe(t.clientX);
      } else {
        touch = null;
      }
      return;
    }

    if (e.cancelable) e.preventDefault(); // evita que la lista se desplace mientras arrastras
    // Desde el asa también se puede deslizar a la izquierda para eliminar
    if (touch.grip && !touch.decided && moved) {
      touch.decided = true;
      if (leftwards) {
        cancelDrag();
        startSwipe(t.clientX);
        return;
      }
    }
    moveDrag(t.clientY);
  }

  function startSwipe(x) {
    touch.swiping = true;
    touch.startX = x; // la fila empieza a moverse desde aquí, sin salto
    touch.swipeX = touch.swipeBase;
    suppressClick = true;
    touch.row.classList.add('swiping');
  }

  function moveSwipe(x) {
    const { row } = touch;
    touch.swipeX = Math.max(-row.offsetWidth, Math.min(0, touch.swipeBase + x - touch.startX));
    setSwipeOffset(row, touch.swipeX);
  }

  // Un deslizamiento corto deja abierto el botón Eliminar; uno largo elimina directamente
  function finishSwipe(cancelled) {
    const { row, swipeX } = touch;
    row.classList.remove('swiping');
    if (!cancelled && swipeX < -row.offsetWidth * SWIPE_DELETE_RATIO) {
      removeNote(row);
    } else if (swipeX < -SWIPE_REVEAL / 2) {
      setSwipeOffset(row, -SWIPE_REVEAL);
      openRow = row;
    } else {
      closeSwipe(row);
    }
  }

  function setSwipeOffset(row, x) {
    const button = row.querySelector('.swipe-delete');
    // Pasado el umbral de borrado, el texto salta al borde izquierdo para avisar
    const full = x < -row.offsetWidth * SWIPE_DELETE_RATIO;
    row.querySelector('.note-front').style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    button.style.width = `${-x}px`;
    button.firstChild.style.transform = full ? `translate3d(${x + SWIPE_REVEAL}px, 0, 0)` : '';
  }

  function closeSwipe(row = openRow) {
    setSwipeOffset(row, 0);
    if (openRow === row) openRow = null;
  }

  function removeNote(row) {
    notes = notes.filter((n) => n.id !== row.dataset.id);
    save();
    if (openRow === row) openRow = null;

    // La fila sale por la izquierda y después se pliega
    row.style.height = `${row.getBoundingClientRect().height}px`;
    row.classList.add('removing');
    setSwipeOffset(row, -row.offsetWidth);
    row.getBoundingClientRect(); // fija la altura de partida antes de animarla
    row.style.height = '0';
    setTimeout(() => {
      row.remove();
      if (el.list.children.length) renderCount();
      else render(); // lista vacía: puede tocar cambiar de filtro o mostrar el aviso
    }, REMOVE_MS);
  }

  function startDrag() {
    if (!touch) return;
    touch.dragging = true;
    suppressClick = true;
    touch.grabOffset = touch.lastY - touch.row.getBoundingClientRect().top;
    touch.row.classList.add('dragging');
    autoScrollLoop();
  }

  function cancelDrag() {
    cancelAnimationFrame(touch.frame);
    touch.dragging = false;
    touch.row.classList.remove('dragging');
    touch.row.style.transform = '';
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

  function endTouch(e) {
    if (!touch) return;
    clearTimeout(touch.timer);
    if (touch.dragging) finishDrag();
    if (touch.swiping) finishSwipe(!e || e.type !== 'touchend');
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

  fillCategoryOptions(el.editCategory);
  render();
})();
