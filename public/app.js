const ME = {
  id: document.body.dataset.userId,
  displayName: document.body.dataset.userName,
};

const TYPE_LABELS = { show: 'Show', movie: 'Movie', book: 'Book' };

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

let allItems = { show: [], movie: [], book: [] };

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

function coverEl(coverUrl, fallbackEmoji) {
  if (coverUrl) return `<img class="cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" />`;
  return `<div class="cover">${fallbackEmoji}</div>`;
}

function fallbackEmoji(type) {
  return { show: '📺', movie: '🎬', book: '📖' }[type] || '✨';
}

function renderColumns() {
  for (const type of ['show', 'movie', 'book']) {
    const container = $(`[data-items="${type}"]`);
    const items = allItems[type] || [];
    if (items.length === 0) {
      container.innerHTML = `<p class="muted" style="padding: 0.5rem;">Nothing yet — be the first.</p>`;
      continue;
    }
    container.innerHTML = items.map(item => {
      const loved = item.lovers.some(l => l._id === ME.id);
      const subtitle = item.author ? `<div class="author">${escapeHtml(item.author)}</div>` : '';
      return `
        <div class="item" data-id="${item._id}">
          ${coverEl(item.coverUrl, fallbackEmoji(type))}
          <div class="body">
            <div class="title">${escapeHtml(item.title)}</div>
            ${subtitle}
            <div class="meta">
              <span class="heart">${loved ? '♥' : '♡'}</span>
              <span>${item.lovers.length}</span>
              <span>·</span>
              <span>added by ${escapeHtml(item.addedBy.displayName)}</span>
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
}

document.addEventListener('click', (e) => {
  const itemEl = e.target.closest('.item[data-id]');
  if (itemEl) openDetail(itemEl.dataset.id);
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
  // re-trigger autocomplete with new type
  if (titleInput.value.trim().length >= 2) runAutocomplete();
});

function syncTypeUI() {
  const isBook = typeSelect.value === 'book';
  authorLabel.classList.toggle('hidden', !isBook);
}

let acTimer = null;
let acAbort = null;
titleInput.addEventListener('input', () => {
  // user typed manually -> drop any previously chosen autocomplete data
  coverInput.value = '';
  externalInput.value = '';
  clearTimeout(acTimer);
  acTimer = setTimeout(runAutocomplete, 250);
});

titleInput.addEventListener('blur', () => {
  // delay so click on a result still fires
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
  renderDetail(item);
  detailModal.classList.remove('hidden');
}

detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) detailModal.classList.add('hidden');
});

function renderDetail(item) {
  const loved = item.lovers.some(l => l._id === ME.id);
  const isMine = item.addedBy._id === ME.id;
  const lovers = item.lovers.map(l => {
    const youCls = l._id === ME.id ? ' you' : '';
    return `<span class="lover-chip${youCls}">${escapeHtml(l.displayName)}</span>`;
  }).join('');
  detailContent.innerHTML = `
    <div class="detail-header">
      ${item.coverUrl
        ? `<img class="detail-cover" src="${escapeHtml(item.coverUrl)}" alt="" />`
        : `<div class="detail-cover" style="display:grid;place-items:center;font-size:2rem;">${fallbackEmoji(item.type)}</div>`}
      <div class="detail-info">
        <div class="muted">${TYPE_LABELS[item.type]}</div>
        <h2>${escapeHtml(item.title)}</h2>
        ${item.author ? `<div class="author">${escapeHtml(item.author)}</div>` : ''}
        <div class="added-by">added by ${escapeHtml(item.addedBy.displayName)}</div>
      </div>
    </div>
    ${item.notes ? `<div class="detail-notes">${escapeHtml(item.notes)}</div>` : ''}
    <div class="lovers-section">
      <h3>${item.lovers.length} love${item.lovers.length === 1 ? '' : 's'}</h3>
      <div class="lovers">${lovers || '<span class="muted">nobody yet</span>'}</div>
    </div>
    <div class="modal-actions">
      ${isMine ? `<button type="button" class="danger" data-action="delete">Delete</button>` : ''}
      <button type="button" class="ghost" data-close>Close</button>
      <button type="button" class="primary" data-action="love">${loved ? '♥ Unlove' : '♡ Love'}</button>
    </div>
  `;
  $$('button[data-action]', detailContent).forEach(b => {
    b.addEventListener('click', async () => {
      try {
        if (b.dataset.action === 'love') {
          const updated = await api(`/api/items/${item._id}/love`, { method: 'POST' });
          // splice the updated item into local cache and re-render
          for (const t of Object.keys(allItems)) {
            const i = allItems[t].findIndex(x => x._id === item._id);
            if (i !== -1) allItems[t][i] = updated;
          }
          // re-sort by love count
          for (const t of Object.keys(allItems)) {
            allItems[t].sort((a, b) =>
              (b.lovers.length - a.lovers.length) ||
              (new Date(b.createdAt) - new Date(a.createdAt))
            );
          }
          renderColumns();
          renderDetail(updated);
        } else if (b.dataset.action === 'delete') {
          if (!confirm('Delete this title?')) return;
          await api(`/api/items/${item._id}`, { method: 'DELETE' });
          detailModal.classList.add('hidden');
          await loadItems();
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });
  $('button[data-close]', detailContent)?.addEventListener('click', () => {
    detailModal.classList.add('hidden');
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    addModal.classList.add('hidden');
    detailModal.classList.add('hidden');
  }
});

loadItems();
