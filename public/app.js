const ME = {
  id: document.body.dataset.userId,
  displayName: document.body.dataset.userName,
};

const TYPE_LABELS = { show: 'Show', movie: 'Movie', book: 'Book' };
const watchedLabel = (type) => type === 'book' ? 'read' : 'watched';
const watchedLabelCap = (type) => type === 'book' ? 'Read' : 'Watched';

const FILTER_KEY = 'sevheav-filter';
let currentFilter = localStorage.getItem(FILTER_KEY) || 'all';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const addBtn = $('#add-btn');
const addModal = $('#add-modal');
const addForm = $('#add-form');
const typeSelect = $('#type-select');
const titleInput = $('#title-input');
const authorInput = $('#author-input');
const authorLabel = $('#author-label');
const acResults = $('#autocomplete-results');
const coverInput = $('#cover-input');
const externalInput = $('#external-input');
const addError = $('#add-error');

const detailModal = $('#detail-modal');
const detailContent = $('#detail-content');
const columnsEl = $('main.columns');

let allItems = { show: [], movie: [], book: [] };
let openDetailId = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  return res.json();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fallbackEmoji(type) {
  return { show: '📺', movie: '🎬', book: '📖' }[type] || '✨';
}

function coverEl(coverUrl, type, size = 'cover') {
  if (coverUrl) return `<img class="${size}" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" />`;
  return `<div class="${size} cover-fallback">${fallbackEmoji(type)}</div>`;
}

const EYE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const BOOK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
const watchedIcon = (type) => type === 'book' ? BOOK_SVG : EYE_SVG;

function pillsFor(item) {
  const lovers = item.lovers || [];
  const watched = item.watched || [];
  const youLove = lovers.some(l => l._id === ME.id);
  const youWatched = watched.some(w => w._id === ME.id);
  const wLabel = watchedLabel(item.type);
  return `
    <button type="button" class="pill love-pill ${youLove ? 'on' : ''}" data-action="love" title="${youLove ? 'Unlove' : 'Love'}">
      <span class="pill-icon">${youLove ? '♥' : '♡'}</span>
      <span class="pill-count">${lovers.length}</span>
    </button>
    <button type="button" class="pill watched-pill ${youWatched ? 'on' : ''}" data-action="watched" title="${youWatched ? `Mark un${wLabel}` : `Mark ${wLabel}`}">
      <span class="pill-icon">${watchedIcon(item.type)}</span>
      <span class="pill-count">${watched.length}</span>
    </button>
  `;
}

function filterItems(items) {
  if (currentFilter === 'all') return items;
  return items.filter(item => {
    const youWatched = (item.watched || []).some(w => w._id === ME.id);
    return currentFilter === 'watched' ? youWatched : !youWatched;
  });
}

function renderColumns() {
  for (const type of ['show', 'movie', 'book']) {
    const container = $(`[data-items="${type}"]`);
    const allInColumn = allItems[type] || [];
    const items = filterItems(allInColumn);
    if (items.length === 0) {
      let message;
      if (allInColumn.length === 0) {
        message = 'Nothing yet — be the first.';
      } else if (currentFilter === 'unwatched') {
        message = `Nothing left to ${type === 'book' ? 'read' : 'watch'}.`;
      } else {
        message = `You haven't ${type === 'book' ? 'read' : 'watched'} anything here yet.`;
      }
      container.innerHTML = `<p class="muted" style="padding: 0.5rem;">${message}</p>`;
      continue;
    }
    container.innerHTML = items.map(item => {
      const subtitle = item.author ? `<div class="author">${escapeHtml(item.author)}</div>` : '';
      return `
        <div class="item" data-id="${item._id}">
          ${coverEl(item.coverUrl, type)}
          <div class="body">
            <div class="title">${escapeHtml(item.title)}</div>
            ${subtitle}
            <div class="action-row">
              ${pillsFor(item)}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

async function loadItems() {
  allItems = await api('/api/items');
  renderColumns();
  if (openDetailId) {
    const item = Object.values(allItems).flat().find(i => i._id === openDetailId);
    if (item) renderDetail(item); else closeDetail();
  }
}

function updateItemInCache(updated) {
  for (const t of Object.keys(allItems)) {
    const i = allItems[t].findIndex(x => x._id === updated._id);
    if (i !== -1) allItems[t][i] = updated;
  }
  // re-sort by total engagement (loves + watches) desc, then createdAt desc
  const score = (i) => (i.lovers || []).length + (i.watched || []).length;
  for (const t of Object.keys(allItems)) {
    allItems[t].sort((a, b) =>
      (score(b) - score(a)) ||
      (new Date(b.createdAt) - new Date(a.createdAt))
    );
  }
}

async function toggle(itemId, action) {
  const updated = await api(`/api/items/${itemId}/${action}`, { method: 'POST' });
  updateItemInCache(updated);
  renderColumns();
  if (openDetailId === itemId) renderDetail(updated);
}

// Click delegation: pills toggle, item body opens detail
columnsEl.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill[data-action]');
  const itemEl = e.target.closest('.item[data-id]');
  if (!itemEl) return;
  const itemId = itemEl.dataset.id;
  if (pill) {
    e.stopPropagation();
    toggle(itemId, pill.dataset.action).catch(err => alert(err.message));
    return;
  }
  openDetail(itemId);
});

// Add modal
addBtn.addEventListener('click', () => {
  addForm.reset();
  coverInput.value = '';
  externalInput.value = '';
  acResults.classList.add('hidden');
  acResults.innerHTML = '';
  addError.classList.add('hidden');
  syncTypeUI();
  addModal.classList.remove('hidden');
  setTimeout(() => titleInput.focus(), 50);
});

addModal.addEventListener('click', (e) => {
  if (e.target === addModal || e.target.dataset.close !== undefined) {
    addModal.classList.add('hidden');
  }
});

typeSelect.addEventListener('change', () => {
  syncTypeUI();
  if (titleInput.value.trim().length >= 2) runAutocomplete();
});

function syncTypeUI() {
  const isBook = typeSelect.value === 'book';
  authorLabel.classList.toggle('hidden', !isBook);
}

let acTimer = null;
let acAbort = null;
titleInput.addEventListener('input', () => {
  coverInput.value = '';
  externalInput.value = '';
  clearTimeout(acTimer);
  acTimer = setTimeout(runAutocomplete, 250);
});

titleInput.addEventListener('blur', () => {
  setTimeout(() => acResults.classList.add('hidden'), 150);
});

titleInput.addEventListener('focus', () => {
  if (acResults.children.length > 0) acResults.classList.remove('hidden');
});

async function runAutocomplete() {
  const q = titleInput.value.trim();
  const type = typeSelect.value;
  if (q.length < 2) {
    acResults.classList.add('hidden');
    acResults.innerHTML = '';
    return;
  }
  if (acAbort) acAbort.abort();
  acAbort = new AbortController();
  try {
    const r = await fetch(`/api/search?type=${type}&q=${encodeURIComponent(q)}`, {
      signal: acAbort.signal,
    });
    if (!r.ok) return;
    const { results, note } = await r.json();
    if (results.length === 0) {
      if (note) {
        acResults.innerHTML = `<div class="autocomplete-result"><div class="info"><div class="a">${escapeHtml(note)}</div></div></div>`;
        acResults.classList.remove('hidden');
      } else {
        acResults.classList.add('hidden');
      }
      return;
    }
    acResults.innerHTML = results.map((res, i) => `
      <div class="autocomplete-result" data-idx="${i}">
        ${res.coverUrl ? `<img src="${escapeHtml(res.coverUrl)}" alt="" />` : `<div style="width:30px;height:45px;background:#e0e0e5;border-radius:3px;"></div>`}
        <div class="info">
          <div class="t">${escapeHtml(res.title)}${res.year ? ` <span class="a">(${escapeHtml(res.year)})</span>` : ''}</div>
          ${res.author ? `<div class="a">${escapeHtml(res.author)}</div>` : ''}
        </div>
      </div>
    `).join('');
    acResults.classList.remove('hidden');
    $$('.autocomplete-result', acResults).forEach((el, i) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickAutocomplete(results[i]);
      });
    });
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

function pickAutocomplete(res) {
  titleInput.value = res.title;
  if (typeSelect.value === 'book' && res.author) authorInput.value = res.author;
  coverInput.value = res.coverUrl || '';
  externalInput.value = res.externalId || '';
  acResults.classList.add('hidden');
}

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addError.classList.add('hidden');
  const fd = new FormData(addForm);
  const payload = Object.fromEntries(fd.entries());
  try {
    await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    addModal.classList.add('hidden');
    await loadItems();
  } catch (err) {
    addError.textContent = err.message;
    addError.classList.remove('hidden');
  }
});

// Detail modal
function openDetail(itemId) {
  const item = Object.values(allItems).flat().find(i => i._id === itemId);
  if (!item) return;
  openDetailId = itemId;
  renderDetail(item);
  detailModal.classList.remove('hidden');
}

function closeDetail() {
  openDetailId = null;
  detailModal.classList.add('hidden');
}

detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) closeDetail();
});

function chipsFor(users) {
  if (!users || users.length === 0) return '<span class="muted">nobody yet</span>';
  return users.map(u => {
    const youCls = u._id === ME.id ? ' you' : '';
    return `<span class="chip${youCls}">${escapeHtml(u.displayName)}</span>`;
  }).join('');
}

function commentsHTML(item) {
  const comments = item.comments || [];
  if (comments.length === 0) return '<p class="muted comments-empty">No comments yet.</p>';
  return comments.map(c => {
    const mine = c.user && c.user._id === ME.id;
    return `
      <div class="comment">
        <div class="comment-text">${escapeHtml(c.text)} <span class="comment-author">-${escapeHtml(c.user?.displayName || 'unknown')}</span></div>
        ${mine ? `<button type="button" class="comment-delete" data-comment-id="${c._id}" title="Delete">×</button>` : ''}
      </div>
    `;
  }).join('');
}

function renderDetail(item) {
  const lovers = item.lovers || [];
  const watched = item.watched || [];
  const youLove = lovers.some(l => l._id === ME.id);
  const youWatched = watched.some(w => w._id === ME.id);
  const isMine = item.addedBy._id === ME.id;
  const wLabel = watchedLabel(item.type);
  const wLabelCap = watchedLabelCap(item.type);
  detailContent.innerHTML = `
    <div class="detail-header">
      ${coverEl(item.coverUrl, item.type, 'detail-cover')}
      <div class="detail-info">
        <div class="muted">${TYPE_LABELS[item.type]}</div>
        <h2>${escapeHtml(item.title)}</h2>
        ${item.author ? `<div class="author">${escapeHtml(item.author)}</div>` : ''}
        <div class="added-by muted">added by ${escapeHtml(item.addedBy.displayName)}</div>
      </div>
    </div>
    ${item.notes ? `<div class="detail-notes">${escapeHtml(item.notes)}</div>` : ''}

    <div class="action-row detail-actions">
      ${pillsFor(item)}
    </div>

    <div class="lovers-section">
      <h3>${lovers.length} love${lovers.length === 1 ? '' : 's'}</h3>
      <div class="chips love-chips">${chipsFor(lovers)}</div>
    </div>

    <div class="lovers-section">
      <h3>${watched.length} ${wLabel}</h3>
      <div class="chips watched-chips">${chipsFor(watched)}</div>
    </div>

    <div class="comments-section">
      <h3>Comments</h3>
      <div class="comments">${commentsHTML(item)}</div>
      <form class="comment-form">
        <textarea name="text" placeholder="Add a comment…" rows="2" required maxlength="500"></textarea>
        <button type="submit" class="primary">Post</button>
      </form>
    </div>

    <div class="modal-actions">
      ${isMine ? `<button type="button" class="danger" data-action="delete">Delete</button>` : ''}
      <button type="button" class="ghost" data-close>Close</button>
    </div>
  `;
  // pill toggles inside detail modal
  $$('.pill[data-action]', detailContent).forEach(b => {
    b.addEventListener('click', async () => {
      try { await toggle(item._id, b.dataset.action); }
      catch (err) { alert(err.message); }
    });
  });
  // delete button
  $('button[data-action="delete"]', detailContent)?.addEventListener('click', async () => {
    if (!confirm('Delete this title?')) return;
    try {
      await api(`/api/items/${item._id}`, { method: 'DELETE' });
      closeDetail();
      await loadItems();
    } catch (err) { alert(err.message); }
  });
  $('button[data-close]', detailContent)?.addEventListener('click', closeDetail);

  // Comment form
  const commentForm = $('.comment-form', detailContent);
  commentForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = commentForm.text.value.trim();
    if (!text) return;
    try {
      const updated = await api(`/api/items/${item._id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      updateItemInCache(updated);
      renderColumns();
      renderDetail(updated);
    } catch (err) { alert(err.message); }
  });

  // Comment delete (own comments only)
  $$('.comment-delete', detailContent).forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        const updated = await api(`/api/items/${item._id}/comments/${b.dataset.commentId}`, { method: 'DELETE' });
        updateItemInCache(updated);
        renderColumns();
        renderDetail(updated);
      } catch (err) { alert(err.message); }
    });
  });
}

// Watched filter — single eye-icon button cycling: all → unwatched → watched
const FILTER_STATES = ['all', 'unwatched', 'watched'];
const FILTER_EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const FILTER_EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

function applyFilterUI() {
  const btn = $('#filter-toggle');
  const icon = $('#filter-icon');
  btn.classList.remove('state-all', 'state-unwatched', 'state-watched');
  btn.classList.add(`state-${currentFilter}`);
  if (currentFilter === 'unwatched') {
    icon.innerHTML = FILTER_EYE_OFF_SVG;
    btn.title = 'Showing unwatched — tap for watched';
  } else if (currentFilter === 'watched') {
    icon.innerHTML = FILTER_EYE_SVG;
    btn.title = 'Showing watched — tap for all';
  } else {
    icon.innerHTML = FILTER_EYE_SVG;
    btn.title = 'Showing all — tap for unwatched';
  }
}

$('#filter-toggle').addEventListener('click', () => {
  const idx = FILTER_STATES.indexOf(currentFilter);
  currentFilter = FILTER_STATES[(idx + 1) % FILTER_STATES.length];
  localStorage.setItem(FILTER_KEY, currentFilter);
  applyFilterUI();
  renderColumns();
});

applyFilterUI();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    addModal.classList.add('hidden');
    closeDetail();
  }
});

loadItems();
