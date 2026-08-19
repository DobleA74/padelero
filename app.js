import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getRanking,
  getPartnerships,
  addPlayer,
  renamePlayer,
  deletePlayer,
  listMatches,
  addMatch,
  updateMatch,
  deleteMatch,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function requirePin(req, res, next) {
  const expected = process.env.APP_PIN;
  if (!expected) return next();
  if (req.header('X-Pin') !== expected) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  next();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRange(query) {
  const { from, to } = query || {};
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return { error: 'Rango de fechas inválido' };
  }
  const range = {};
  if (from) range.from = from;
  if (to) range.to = to;
  return { value: range };
}

app.get('/api/players', asyncHandler(async (req, res) => {
  const { error, value } = parseDateRange(req.query);
  if (error) return res.status(400).json({ error });
  res.json(await getRanking(value));
}));

app.post('/api/players', requirePin, asyncHandler(async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  res.status(201).json(await addPlayer(name));
}));

app.patch('/api/players/:id', requirePin, asyncHandler(async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  res.json(await renamePlayer(Number(req.params.id), name));
}));

app.delete('/api/players/:id', requirePin, asyncHandler(async (req, res) => {
  await deletePlayer(Number(req.params.id));
  res.status(204).end();
}));

app.get('/api/matches', asyncHandler(async (req, res) => {
  const { error, value } = parseDateRange(req.query);
  if (error) return res.status(400).json({ error });
  res.json(await listMatches(value));
}));

app.get('/api/partnerships', asyncHandler(async (req, res) => {
  const { error, value } = parseDateRange(req.query);
  if (error) return res.status(400).json({ error });
  res.json(await getPartnerships(value));
}));

function validateMatchInput(body) {
  const {
    teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
    smashA1, smashA2, smashB1, smashB2, scoreNote, playedAt,
  } = body || {};

  if (!teamA1Id || !teamA2Id || !teamB1Id || !teamB2Id) {
    return { error: 'Faltan jugadores' };
  }
  const ids = [teamA1Id, teamA2Id, teamB1Id, teamB2Id];
  if (new Set(ids).size !== 4) {
    return { error: 'Los cuatro jugadores deben ser distintos' };
  }
  if (winningTeam !== 'A' && winningTeam !== 'B') {
    return { error: 'Falta indicar el equipo ganador' };
  }
  if (loserSets !== 0 && loserSets !== 1) {
    return { error: 'Falta indicar el marcador (2-0 o 2-1)' };
  }
  const smashValues = [smashA1, smashA2, smashB1, smashB2].map((v) => (v === undefined ? 0 : v));
  if (smashValues.some((v) => !Number.isInteger(v) || v < 0)) {
    return { error: 'Los remates deben ser números enteros positivos' };
  }
  const resolvedPlayedAt = playedAt || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (resolvedPlayedAt > today) {
    return { error: 'La fecha no puede ser futura' };
  }

  return {
    value: {
      teamA1Id,
      teamA2Id,
      teamB1Id,
      teamB2Id,
      winningTeam,
      loserSets,
      smashA1: smashValues[0],
      smashA2: smashValues[1],
      smashB1: smashValues[2],
      smashB2: smashValues[3],
      scoreNote,
      playedAt: resolvedPlayedAt,
    },
  };
}

app.post('/api/matches', requirePin, asyncHandler(async (req, res) => {
  const { error, value } = validateMatchInput(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  res.status(201).json(await addMatch(value));
}));

app.patch('/api/matches/:id', requirePin, asyncHandler(async (req, res) => {
  const { error, value } = validateMatchInput(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  res.json(await updateMatch(Number(req.params.id), value));
}));

app.delete('/api/matches/:id', requirePin, asyncHandler(async (req, res) => {
  await deleteMatch(Number(req.params.id));
  res.status(204).end();
}));

app.use((err, req, res, next) => {
  if (err.code === 'PLAYER_IN_USE') {
    return res.status(409).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error inesperado del servidor' });
});

export default app;
