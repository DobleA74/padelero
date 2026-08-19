const rankingBody = document.getElementById('ranking-body');
const teamSelects = {
  A1: document.getElementById('teamA1'),
  A2: document.getElementById('teamA2'),
  B1: document.getElementById('teamB1'),
  B2: document.getElementById('teamB2'),
};
const smashInputs = {
  A1: document.getElementById('smashA1'),
  A2: document.getElementById('smashA2'),
  B1: document.getElementById('smashB1'),
  B2: document.getElementById('smashB2'),
};
const matchForm = document.getElementById('match-form');
const matchSubmitBtn = document.getElementById('match-submit');
const matchCancelEditBtn = document.getElementById('match-cancel-edit');
const matchError = document.getElementById('match-error');
const scoreNoteInput = document.getElementById('scoreNote');
const playedAtInput = document.getElementById('playedAt');
const winnerButtons = document.querySelectorAll('#winner-fieldset .winner-btn');
const scoreButtons = document.querySelectorAll('#score-fieldset .score-btn');
const playerForm = document.getElementById('player-form');
const newPlayerNameInput = document.getElementById('newPlayerName');
const playerError = document.getElementById('player-error');
const playersList = document.getElementById('players-list');
const matchesList = document.getElementById('matches-list');
const pinStatusBtn = document.getElementById('pin-status');
const rangeFromInput = document.getElementById('rangeFrom');
const rangeToInput = document.getElementById('rangeTo');
const rangeApplyBtn = document.getElementById('range-apply');
const rangeResetBtn = document.getElementById('range-reset');
const rangeLabel = document.getElementById('range-label');

let selectedWinner = null; // 'A' | 'B'
let selectedLoserSets = null; // 0 | 1
let players = [];
let matches = [];
let editingMatchId = null;
let rangeFrom = '';
let rangeTo = '';

playedAtInput.value = new Date().toISOString().slice(0, 10);

const PIN_STORAGE_KEY = 'padelero_pin';
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

function getStoredPin() {
  return localStorage.getItem(PIN_STORAGE_KEY);
}

function setStoredPin(pin) {
  if (pin) localStorage.setItem(PIN_STORAGE_KEY, pin);
  else localStorage.removeItem(PIN_STORAGE_KEY);
}

function updatePinStatus() {
  const pin = getStoredPin();
  pinStatusBtn.textContent = pin ? '🔓 PIN' : '🔒 PIN';
  pinStatusBtn.classList.toggle('unlocked', Boolean(pin));
}

function ensurePin() {
  let pin = getStoredPin();
  if (!pin) {
    const entered = prompt('Ingresá el PIN de la peña para poder editar');
    if (entered && entered.trim()) {
      pin = entered.trim();
      setStoredPin(pin);
      updatePinStatus();
    }
  }
  return pin;
}

pinStatusBtn.addEventListener('click', () => {
  const current = getStoredPin();
  const next = prompt(current ? 'Cambiar PIN (vacío para borrarlo)' : 'Ingresá el PIN de la peña');
  if (next === null) return;
  setStoredPin(next.trim() || null);
  updatePinStatus();
});

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (MUTATING_METHODS.has(method)) {
    const pin = ensurePin();
    if (!pin) throw new Error('Se necesita el PIN para esta acción');
    headers['X-Pin'] = pin;
  }
  const res = await fetch(path, { ...options, method, headers });
  if (res.status === 401) {
    setStoredPin(null);
    updatePinStatus();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'PIN incorrecto');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Error inesperado');
  }
  return res.status === 204 ? null : res.json();
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const second = parts.length > 1 ? parts[1][0] : parts[0]?.[1] || '';
  return (first + second).toUpperCase();
}

function avatarHtml(name) {
  const hue = hashString(name) % 360;
  return `<span class="avatar" style="background:hsl(${hue}, 55%, 45%)">${escapeHtml(initials(name))}</span>`;
}

function streakBadge(streak) {
  if (streak >= 2) return ` <span class="streak streak-up">🔥${streak}</span>`;
  if (streak <= -2) return ` <span class="streak streak-down">🧊${-streak}</span>`;
  return '';
}

function renderRanking(ranking) {
  if (ranking.length === 0) {
    rankingBody.innerHTML = '<tr><td colspan="7" class="empty">Sin jugadores todavía</td></tr>';
    return;
  }
  rankingBody.innerHTML = ranking
    .map(
      (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${avatarHtml(r.name)}${escapeHtml(r.name)}${streakBadge(r.streak)}</td>
        <td>${r.played}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td>${Math.round(r.winRate * 100)}%</td>
        <td>${r.points}</td>
      </tr>`
    )
    .join('');
}

function renderPartnerships(partnerships) {
  const list = document.getElementById('partnerships-list');
  const eligible = partnerships.filter((p) => p.played >= 3).slice(0, 5);
  if (eligible.length === 0) {
    list.innerHTML = '<li class="empty">Todavía no hay suficientes partidos</li>';
    return;
  }
  list.innerHTML = eligible
    .map(
      (p) => `
      <li>
        <span>${escapeHtml(p.player1Name)} / ${escapeHtml(p.player2Name)}</span>
        <span>${p.wins}-${p.losses} · ${Math.round(p.winRate * 100)}%</span>
      </li>`
    )
    .join('');
}

function renderPlayerSelects() {
  const options = players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  Object.values(teamSelects).forEach((select) => {
    select.innerHTML = options;
  });
  if (players.length > 3) {
    teamSelects.A2.selectedIndex = 1;
    teamSelects.B1.selectedIndex = 2;
    teamSelects.B2.selectedIndex = 3;
  }
}

function renderPlayersList() {
  if (players.length === 0) {
    playersList.innerHTML = '<li class="empty">Sin jugadores todavía</li>';
    return;
  }
  playersList.innerHTML = players
    .map(
      (p) => `
      <li data-id="${p.id}">
        <span>${avatarHtml(p.name)}${escapeHtml(p.name)}</span>
        <span class="item-actions">
          <button class="edit-btn" data-action="edit-player" data-id="${p.id}">Editar</button>
          <button class="delete-btn" data-action="delete-player" data-id="${p.id}">Borrar</button>
        </span>
      </li>`
    )
    .join('');
}

function renderMatches(matches) {
  if (matches.length === 0) {
    matchesList.innerHTML = '<li class="empty">Sin partidos cargados todavía</li>';
    return;
  }
  matchesList.innerHTML = matches
    .slice(0, 15)
    .map((m) => {
      const teamA = `${escapeHtml(m.teamA1Name)} / ${escapeHtml(m.teamA2Name)}`;
      const teamB = `${escapeHtml(m.teamB1Name)} / ${escapeHtml(m.teamB2Name)}`;
      const winners = m.winningTeam === 'A' ? teamA : teamB;
      const setScore = m.loserSets === 0 ? '2-0' : '2-1';
      const smashes = [
        [m.teamA1Name, m.smashA1],
        [m.teamA2Name, m.smashA2],
        [m.teamB1Name, m.smashB1],
        [m.teamB2Name, m.smashB2],
      ].filter(([, count]) => count > 0);
      const smashNote = smashes.length
        ? ` · 🎯 ${smashes.map(([name, count]) => `${escapeHtml(name)} x${count}`).join(', ')}`
        : '';
      return `
      <li data-id="${m.id}">
        <div class="match-info">
          <span>${teamA} vs ${teamB} — ganó ${winners} ${setScore}${
        m.scoreNote ? ` (${escapeHtml(m.scoreNote)})` : ''
      }${smashNote}</span>
          <span class="match-date">${m.playedAt}</span>
        </div>
        <span class="item-actions">
          <a class="edit-btn" href="${whatsappShareUrl(m)}" target="_blank" rel="noopener">📤</a>
          <button class="edit-btn" data-action="edit-match" data-id="${m.id}">Editar</button>
          <button class="delete-btn" data-action="delete-match" data-id="${m.id}">Borrar</button>
        </span>
      </li>`;
    })
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function buildRangeQuery() {
  const params = new URLSearchParams();
  if (rangeFrom) params.set('from', rangeFrom);
  if (rangeTo) params.set('to', rangeTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function updateRangeLabel() {
  if (!rangeFrom && !rangeTo) {
    rangeLabel.textContent = 'Mostrando: ranking global (histórico completo)';
    rangeResetBtn.hidden = true;
  } else {
    rangeLabel.textContent = `Mostrando: partidos desde ${rangeFrom || 'el inicio'} hasta ${rangeTo || 'hoy'}`;
    rangeResetBtn.hidden = false;
  }
}

async function loadRanking() {
  const ranking = await api(`/api/players${buildRangeQuery()}`);
  players = ranking;
  renderRanking(ranking);
  renderPlayerSelects();
  renderPlayersList();
}

async function loadMatches() {
  matches = await api(`/api/matches${buildRangeQuery()}`);
  renderMatches(matches);
}

async function loadPartnerships() {
  const partnerships = await api(`/api/partnerships${buildRangeQuery()}`);
  renderPartnerships(partnerships);
}

async function loadAll() {
  await Promise.all([loadRanking(), loadMatches(), loadPartnerships()]);
}

rangeApplyBtn.addEventListener('click', async () => {
  rangeFrom = rangeFromInput.value;
  rangeTo = rangeToInput.value;
  updateRangeLabel();
  await loadAll();
});

rangeResetBtn.addEventListener('click', async () => {
  rangeFrom = '';
  rangeTo = '';
  rangeFromInput.value = '';
  rangeToInput.value = '';
  updateRangeLabel();
  await loadAll();
});

function whatsappShareUrl(m) {
  const teamA = `${m.teamA1Name}/${m.teamA2Name}`;
  const teamB = `${m.teamB1Name}/${m.teamB2Name}`;
  const winners = m.winningTeam === 'A' ? teamA : teamB;
  const losers = m.winningTeam === 'A' ? teamB : teamA;
  const setScore = m.loserSets === 0 ? '2-0' : '2-1';
  const scorePart = m.scoreNote ? ` (${m.scoreNote})` : '';
  const text = `🎾 ${winners} le ganaron a ${losers} ${setScore}${scorePart}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function enterMatchEditMode(match) {
  editingMatchId = match.id;
  teamSelects.A1.value = String(match.teamA1Id);
  teamSelects.A2.value = String(match.teamA2Id);
  teamSelects.B1.value = String(match.teamB1Id);
  teamSelects.B2.value = String(match.teamB2Id);
  smashInputs.A1.value = match.smashA1;
  smashInputs.A2.value = match.smashA2;
  smashInputs.B1.value = match.smashB1;
  smashInputs.B2.value = match.smashB2;
  scoreNoteInput.value = match.scoreNote || '';
  playedAtInput.value = match.playedAt;

  selectedWinner = match.winningTeam;
  winnerButtons.forEach((b) => b.classList.toggle('selected', b.dataset.target === match.winningTeam));
  selectedLoserSets = match.loserSets;
  scoreButtons.forEach((b) => b.classList.toggle('selected', Number(b.dataset.sets) === match.loserSets));

  matchSubmitBtn.textContent = 'Guardar cambios';
  matchCancelEditBtn.hidden = false;
  matchForm.scrollIntoView({ behavior: 'smooth' });
}

function exitMatchEditMode() {
  editingMatchId = null;
  matchSubmitBtn.textContent = 'Guardar resultado';
  matchCancelEditBtn.hidden = true;
}

winnerButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedWinner = btn.dataset.target;
    winnerButtons.forEach((b) => b.classList.toggle('selected', b === btn));
  });
});

scoreButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedLoserSets = Number(btn.dataset.sets);
    scoreButtons.forEach((b) => b.classList.toggle('selected', b === btn));
  });
});

matchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  matchError.textContent = '';

  const teamA1Id = Number(teamSelects.A1.value);
  const teamA2Id = Number(teamSelects.A2.value);
  const teamB1Id = Number(teamSelects.B1.value);
  const teamB2Id = Number(teamSelects.B2.value);
  const ids = [teamA1Id, teamA2Id, teamB1Id, teamB2Id];

  if (ids.some((id) => !id)) {
    matchError.textContent = 'Agregá al menos 4 jugadores primero';
    return;
  }
  if (new Set(ids).size !== 4) {
    matchError.textContent = 'Los cuatro jugadores deben ser distintos';
    return;
  }
  if (!selectedWinner) {
    matchError.textContent = 'Marcá qué equipo ganó';
    return;
  }
  if (selectedLoserSets === null) {
    matchError.textContent = 'Marcá el marcador (2-0 o 2-1)';
    return;
  }

  try {
    const path = editingMatchId ? `/api/matches/${editingMatchId}` : '/api/matches';
    await api(path, {
      method: editingMatchId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        teamA1Id,
        teamA2Id,
        teamB1Id,
        teamB2Id,
        winningTeam: selectedWinner,
        loserSets: selectedLoserSets,
        smashA1: Number(smashInputs.A1.value) || 0,
        smashA2: Number(smashInputs.A2.value) || 0,
        smashB1: Number(smashInputs.B1.value) || 0,
        smashB2: Number(smashInputs.B2.value) || 0,
        scoreNote: scoreNoteInput.value.trim() || undefined,
        playedAt: playedAtInput.value,
      }),
    });
    window.location.reload();
  } catch (err) {
    matchError.textContent = err.message;
  }
});

matchCancelEditBtn.addEventListener('click', () => {
  exitMatchEditMode();
  matchForm.reset();
  playedAtInput.value = new Date().toISOString().slice(0, 10);
  selectedWinner = null;
  selectedLoserSets = null;
  winnerButtons.forEach((b) => b.classList.remove('selected'));
  scoreButtons.forEach((b) => b.classList.remove('selected'));
  matchError.textContent = '';
});

playerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  playerError.textContent = '';
  const name = newPlayerNameInput.value.trim();
  if (!name) return;

  try {
    await api('/api/players', { method: 'POST', body: JSON.stringify({ name }) });
    newPlayerNameInput.value = '';
    await loadRanking();
  } catch (err) {
    playerError.textContent = err.message;
  }
});

document.addEventListener('click', async (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.action === 'edit-player') {
    const id = Number(target.dataset.id);
    const player = players.find((p) => p.id === id);
    if (!player) return;
    const newName = prompt('Nuevo nombre', player.name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === player.name) return;
    try {
      await api(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify({ name: trimmed }) });
      await Promise.all([loadRanking(), loadMatches()]);
    } catch (err) {
      playerError.textContent = err.message;
    }
  }

  if (target.dataset.action === 'edit-match') {
    const id = Number(target.dataset.id);
    const match = matches.find((m) => m.id === id);
    if (match) enterMatchEditMode(match);
  }

  if (target.dataset.action === 'delete-player') {
    const id = target.dataset.id;
    if (!confirm('¿Borrar este jugador?')) return;
    try {
      await api(`/api/players/${id}`, { method: 'DELETE' });
      await loadRanking();
    } catch (err) {
      playerError.textContent = err.message;
    }
  }

  if (target.dataset.action === 'delete-match') {
    const id = target.dataset.id;
    if (!confirm('¿Borrar este partido?')) return;
    await api(`/api/matches/${id}`, { method: 'DELETE' });
    await Promise.all([loadRanking(), loadMatches()]);
  }
});

(async function init() {
  updatePinStatus();
  updateRangeLabel();
  await loadAll();
})();
