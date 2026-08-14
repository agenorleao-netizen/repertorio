'use strict';

/* =========================================================
 * Repertório — app de cifras para tocar no iPad
 * ========================================================= */

// ---------- Estado ----------
const state = {
  songs: [],          // {id, title, artist}
  setlists: [],       // {id, name, songs:[id,...]}
  current: null,      // cifra aberta {id, title, artist, content}
  transpose: 0,
  fontSize: parseInt(localStorage.getItem('fontSize') || '18', 10),
  useFlats: false,
  editingSetId: null, // repertório em edição
  play: null,         // {songIds:[...], index} quando tocando um repertório
  scroll: { on: false, speed: 6, raf: null, acc: 0 },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- API ----------
async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const getSongs = () => api('/api/songs');
const getSong = (id) => api('/api/song/' + encodeURIComponent(id));
const getSetlists = () => api('/api/setlists');
const saveSetlists = () =>
  api('/api/setlists', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.setlists),
  }).catch((e) => console.warn('Falha ao salvar repertórios', e));

// ---------- Utilidades de acorde ----------
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_I = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

const ROOT = '[A-G][#b]?';
const SUFFIX = '(?:maj|min|sus|add|dim|aug|m|M|°|º|ø|\\+|-|[#b]?(?:13|11|9|7|6|5|4|3|2)|[#b])*';
const CHORD_RE = new RegExp('^(' + ROOT + ')(' + SUFFIX + ')(?:/(' + ROOT + '))?$');

const isChordToken = (t) => CHORD_RE.test(t);
const isStructural = (t) =>
  /^[|().\-]+$/.test(t) || /^\(?\d+x\)?$/i.test(t) || /^x\d+$/i.test(t);

function isChordLine(line) {
  const tokens = line.replace(/\t/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const t of tokens) {
    if (isChordToken(t)) chords++;
    else if (!isStructural(t)) return false;
  }
  return chords > 0;
}

function isSection(line) {
  const t = line.trim();
  if (/^\[.+\]$/.test(t)) return true;
  if (t.length <= 24 && /:$/.test(t) && !isChordLine(line) && !/[.!?]/.test(t)) return true;
  return false;
}

function shiftNote(note, semis) {
  const i = NOTE_I[note];
  if (i == null) return note;
  const scale = state.useFlats ? FLAT : SHARP;
  return scale[(((i + semis) % 12) + 12) % 12];
}

function transposeChord(tok, semis) {
  const m = tok.match(CHORD_RE);
  if (!m) return tok;
  let out = shiftNote(m[1], semis) + (m[2] || '');
  if (m[3]) out += '/' + shiftNote(m[3], semis);
  return out;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Transpõe acordes de uma linha preservando o alinhamento das colunas.
function transposeChordLine(line, semis) {
  return line.replace(/\S+/g, (tok) => {
    if (!isChordToken(tok)) return tok;
    const out = transposeChord(tok, semis);
    return out.length < tok.length ? out + ' '.repeat(tok.length - out.length) : out;
  });
}

function renderChart(content, semis) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const html = lines
    .map((line) => {
      if (isSection(line)) return '<span class="section">' + escapeHtml(line) + '</span>';
      if (isChordLine(line)) {
        const t = semis ? transposeChordLine(line, semis) : line;
        return escapeHtml(t).replace(/\S+/g, (tok) =>
          isChordToken(tok) ? '<span class="chord">' + tok + '</span>' : tok
        );
      }
      return escapeHtml(line);
    })
    .join('\n');
  $('#chart').innerHTML = html;
}

// ---------- Navegação entre telas ----------
function show(view) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#' + view).classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ---------- Lista de músicas ----------
function renderSongList(filter) {
  const ul = $('#song-list');
  const q = (filter || '').toLowerCase().trim();
  const items = state.songs.filter(
    (s) => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q)
  );
  ul.innerHTML = '';
  items.forEach((s) => {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'li-main';
    main.innerHTML =
      '<div class="li-title">' + escapeHtml(s.title) + '</div>' +
      (s.artist ? '<div class="li-sub">' + escapeHtml(s.artist) + '</div>' : '');
    main.onclick = () => openSong(s.id);
    li.appendChild(main);
    ul.appendChild(li);
  });
  $('#songs-empty').classList.toggle('hidden', state.songs.length !== 0);
}

// ---------- Visualizador ----------
async function openSong(id, playCtx) {
  stopScroll();
  try {
    state.current = await getSong(id);
  } catch (e) {
    alert('Não consegui abrir a cifra.');
    return;
  }
  state.play = playCtx || null;
  // preferência de bemol: se a cifra usa mais 'b' que '#'
  const sharps = (state.current.content.match(/[A-G]#/g) || []).length;
  const flats = (state.current.content.match(/[A-G]b/g) || []).length;
  state.useFlats = flats > sharps;
  state.transpose = parseInt(localStorage.getItem('tr:' + id) || '0', 10);

  $('#song-title').textContent = state.current.title;
  $('#song-artist').textContent = state.current.artist || '';
  updateTranspose(0);
  applyFontSize();
  renderSongNav();
  $('#chart').style.setProperty('--chart-fs', state.fontSize + 'px');
  show('view-song');
}

function updateTranspose(delta) {
  state.transpose = Math.max(-11, Math.min(11, state.transpose + delta));
  if (state.current) localStorage.setItem('tr:' + state.current.id, String(state.transpose));
  $('#transpose-val').textContent = (state.transpose > 0 ? '+' : '') + state.transpose;
  if (state.current) renderChart(state.current.content, state.transpose);
}

function applyFontSize() {
  document.documentElement.style.setProperty('--chart-fs', state.fontSize + 'px');
  localStorage.setItem('fontSize', String(state.fontSize));
}

function renderSongNav() {
  const nav = $('#song-nav');
  if (!state.play || state.play.songIds.length < 2) {
    nav.classList.add('hidden');
    return;
  }
  nav.classList.remove('hidden');
  const { index, songIds } = state.play;
  $('#song-pos').textContent = index + 1 + ' / ' + songIds.length;
  $('#prev-song').disabled = index <= 0;
  $('#next-song').disabled = index >= songIds.length - 1;
}

function navSong(delta) {
  if (!state.play) return;
  const i = state.play.index + delta;
  if (i < 0 || i >= state.play.songIds.length) return;
  openSong(state.play.songIds[i], { songIds: state.play.songIds, index: i });
}

// ---------- Rolagem automática ----------
function stepScroll() {
  if (!state.scroll.on) return;
  state.scroll.acc += state.scroll.speed / 10;
  if (state.scroll.acc >= 1) {
    const px = Math.floor(state.scroll.acc);
    window.scrollBy(0, px);
    state.scroll.acc -= px;
  }
  state.scroll.raf = requestAnimationFrame(stepScroll);
}
function startScroll() {
  if (state.scroll.on) return;
  state.scroll.on = true;
  $('#scroll-toggle').textContent = '⏸';
  $('#scroll-toggle').classList.add('on');
  state.scroll.raf = requestAnimationFrame(stepScroll);
}
function stopScroll() {
  state.scroll.on = false;
  if (state.scroll.raf) cancelAnimationFrame(state.scroll.raf);
  const btn = $('#scroll-toggle');
  if (btn) { btn.textContent = '▶'; btn.classList.remove('on'); }
}

// ---------- Repertórios (setlists) ----------
function uid() {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

function renderSetList() {
  const ul = $('#set-list');
  ul.innerHTML = '';
  state.setlists.forEach((set) => {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'li-main';
    main.innerHTML =
      '<div class="li-title">' + escapeHtml(set.name || 'Sem nome') + '</div>' +
      '<div class="li-sub">' + set.songs.length + ' música(s)</div>';
    main.onclick = () => editSet(set.id);
    const actions = document.createElement('div');
    actions.className = 'li-actions';
    const play = document.createElement('button');
    play.textContent = '▶';
    play.title = 'Tocar';
    play.onclick = (e) => { e.stopPropagation(); playSet(set.id); };
    actions.appendChild(play);
    li.appendChild(main);
    li.appendChild(actions);
    ul.appendChild(li);
  });
  $('#sets-empty').classList.toggle('hidden', state.setlists.length !== 0);
}

function editSet(id) {
  state.editingSetId = id;
  const set = state.setlists.find((s) => s.id === id);
  if (!set) return;
  $('#set-title-h').textContent = set.name || 'Repertório';
  $('#set-name').value = set.name || '';
  $('#set-add-search').value = '';
  renderSetSongs();
  renderSetAddList('');
  show('view-set');
}

function renderSetSongs() {
  const set = state.setlists.find((s) => s.id === state.editingSetId);
  const ul = $('#set-songs');
  ul.innerHTML = '';
  set.songs.forEach((sid, idx) => {
    const song = state.songs.find((s) => s.id === sid);
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'li-main';
    main.innerHTML =
      '<div class="li-title">' + escapeHtml(song ? song.title : sid) + '</div>' +
      (song && song.artist ? '<div class="li-sub">' + escapeHtml(song.artist) + '</div>' : '');
    main.onclick = () => openSong(sid, { songIds: set.songs.slice(), index: idx });
    const actions = document.createElement('div');
    actions.className = 'li-actions';
    actions.innerHTML =
      '<button data-up>↑</button><button data-down>↓</button><button data-rm>✕</button>';
    actions.querySelector('[data-up]').onclick = () => moveSetSong(idx, -1);
    actions.querySelector('[data-down]').onclick = () => moveSetSong(idx, 1);
    actions.querySelector('[data-rm]').onclick = () => removeSetSong(idx);
    li.appendChild(main);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

function moveSetSong(idx, delta) {
  const set = state.setlists.find((s) => s.id === state.editingSetId);
  const j = idx + delta;
  if (j < 0 || j >= set.songs.length) return;
  const [x] = set.songs.splice(idx, 1);
  set.songs.splice(j, 0, x);
  saveSetlists();
  renderSetSongs();
}

function removeSetSong(idx) {
  const set = state.setlists.find((s) => s.id === state.editingSetId);
  set.songs.splice(idx, 1);
  saveSetlists();
  renderSetSongs();
}

function renderSetAddList(filter) {
  const set = state.setlists.find((s) => s.id === state.editingSetId);
  const q = (filter || '').toLowerCase().trim();
  const ul = $('#set-add-list');
  ul.innerHTML = '';
  state.songs
    .filter((s) => !q || (s.title + ' ' + s.artist).toLowerCase().includes(q))
    .slice(0, 60)
    .forEach((s) => {
      const inSet = set.songs.includes(s.id);
      const li = document.createElement('li');
      const main = document.createElement('div');
      main.className = 'li-main';
      main.innerHTML =
        '<div class="li-title">' + escapeHtml(s.title) + '</div>' +
        (s.artist ? '<div class="li-sub">' + escapeHtml(s.artist) + '</div>' : '');
      const actions = document.createElement('div');
      actions.className = 'li-actions';
      const b = document.createElement('button');
      b.textContent = inSet ? '✓' : '＋';
      b.onclick = () => {
        if (!set.songs.includes(s.id)) {
          set.songs.push(s.id);
          saveSetlists();
          renderSetSongs();
          renderSetAddList(filter);
        }
      };
      actions.appendChild(b);
      li.appendChild(main);
      li.appendChild(actions);
      ul.appendChild(li);
    });
}

function playSet(id) {
  const set = state.setlists.find((s) => s.id === id);
  if (!set || !set.songs.length) {
    alert('Adicione músicas ao repertório primeiro.');
    return;
  }
  openSong(set.songs[0], { songIds: set.songs.slice(), index: 0 });
}

// ---------- Modal: adicionar a um repertório ----------
function openAddToSetModal() {
  if (!state.current) return;
  const ul = $('#modal-list');
  ul.innerHTML = '';
  if (!state.setlists.length) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="li-main">Nenhum repertório. Crie um na aba Repertórios.</div>';
    ul.appendChild(li);
  }
  state.setlists.forEach((set) => {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'li-main';
    const has = set.songs.includes(state.current.id);
    main.innerHTML =
      '<div class="li-title">' + escapeHtml(set.name || 'Sem nome') + '</div>' +
      '<div class="li-sub">' + (has ? 'já contém esta música' : set.songs.length + ' música(s)') + '</div>';
    main.onclick = () => {
      if (!set.songs.includes(state.current.id)) {
        set.songs.push(state.current.id);
        saveSetlists();
      }
      $('#modal').classList.add('hidden');
    };
    li.appendChild(main);
    ul.appendChild(li);
  });
  $('#modal').classList.remove('hidden');
}

// ---------- Eventos ----------
function wire() {
  // abas
  $('#tab-songs').onclick = () => {
    $('#tab-songs').classList.add('active');
    $('#tab-sets').classList.remove('active');
    $('#pane-songs').classList.remove('hidden');
    $('#pane-sets').classList.add('hidden');
  };
  $('#tab-sets').onclick = () => {
    $('#tab-sets').classList.add('active');
    $('#tab-songs').classList.remove('active');
    $('#pane-sets').classList.remove('hidden');
    $('#pane-songs').classList.add('hidden');
    renderSetList();
  };

  $('#search').oninput = (e) => renderSongList(e.target.value);

  // criar repertório
  $('#new-set').onclick = () => {
    const set = { id: uid(), name: 'Novo repertório', songs: [] };
    state.setlists.push(set);
    saveSetlists();
    editSet(set.id);
  };

  // edição de repertório
  $$('[data-back-to-sets]').forEach((b) => (b.onclick = () => { show('view-list'); renderSetList(); }));
  $('#set-name').oninput = (e) => {
    const set = state.setlists.find((s) => s.id === state.editingSetId);
    set.name = e.target.value;
    $('#set-title-h').textContent = set.name || 'Repertório';
    saveSetlists();
  };
  $('#delete-set').onclick = () => {
    if (!confirm('Excluir este repertório?')) return;
    state.setlists = state.setlists.filter((s) => s.id !== state.editingSetId);
    saveSetlists();
    show('view-list');
    renderSetList();
  };
  $('#set-add-search').oninput = (e) => renderSetAddList(e.target.value);
  $('#play-set').onclick = () => playSet(state.editingSetId);

  // visualizador
  $('#song-back').onclick = () => { stopScroll(); show('view-list'); };
  $('#toggle-tools').onclick = () => $('#tools').classList.toggle('hidden');
  $('#tr-down').onclick = () => updateTranspose(-1);
  $('#tr-up').onclick = () => updateTranspose(1);
  $('#tr-reset').onclick = () => { state.transpose = 0; updateTranspose(0); };
  $('#fs-down').onclick = () => { state.fontSize = Math.max(11, state.fontSize - 1); applyFontSize(); };
  $('#fs-up').onclick = () => { state.fontSize = Math.min(40, state.fontSize + 1); applyFontSize(); };
  $('#scroll-toggle').onclick = () => (state.scroll.on ? stopScroll() : startScroll());
  $('#scroll-speed').oninput = (e) => (state.scroll.speed = parseInt(e.target.value, 10));
  $('#add-to-set').onclick = openAddToSetModal;
  $('#prev-song').onclick = () => navSong(-1);
  $('#next-song').onclick = () => navSong(1);

  $('#modal-close').onclick = () => $('#modal').classList.add('hidden');
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };

  // parar rolagem ao tocar na tela da cifra
  $('#chart').addEventListener('pointerdown', () => { if (state.scroll.on) stopScroll(); });
}

// ---------- Boot ----------
async function boot() {
  wire();
  applyFontSize();
  try {
    state.songs = await getSongs();
  } catch (e) {
    state.songs = [];
  }
  try {
    state.setlists = await getSetlists();
    if (!Array.isArray(state.setlists)) state.setlists = [];
  } catch (e) {
    state.setlists = [];
  }
  renderSongList('');
}

boot();
