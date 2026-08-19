import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getRanking,
  addPlayer,
  deletePlayer,
  listMatches,
  addMatch,
  deleteMatch,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/players', async (req, res) => {
  res.json(await getRanking());
});

app.post('/api/players', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  res.status(201).json(await addPlayer(name));
});

app.delete('/api/players/:id', async (req, res) => {
  try {
    await deletePlayer(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    if (err.code === 'PLAYER_IN_USE') {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
});

app.get('/api/matches', async (req, res) => {
  res.json(await listMatches());
});

app.post('/api/matches', async (req, res) => {
  const {
    teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
    smashA1, smashA2, smashB1, smashB2, scoreNote, playedAt,
  } = req.body || {};

  if (!teamA1Id || !teamA2Id || !teamB1Id || !teamB2Id) {
    return res.status(400).json({ error: 'Faltan jugadores' });
  }
  const ids = [teamA1Id, teamA2Id, teamB1Id, teamB2Id];
  if (new Set(ids).size !== 4) {
    return res.status(400).json({ error: 'Los cuatro jugadores deben ser distintos' });
  }
  if (winningTeam !== 'A' && winningTeam !== 'B') {
    return res.status(400).json({ error: 'Falta indicar el equipo ganador' });
  }
  if (loserSets !== 0 && loserSets !== 1) {
    return res.status(400).json({ error: 'Falta indicar el marcador (2-0 o 2-1)' });
  }
  const smashValues = [smashA1, smashA2, smashB1, smashB2].map((v) => (v === undefined ? 0 : v));
  if (smashValues.some((v) => !Number.isInteger(v) || v < 0)) {
    return res.status(400).json({ error: 'Los remates deben ser números enteros positivos' });
  }

  const result = await addMatch({
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
    playedAt: playedAt || new Date().toISOString().slice(0, 10),
  });
  res.status(201).json(result);
});

app.delete('/api/matches/:id', async (req, res) => {
  await deleteMatch(Number(req.params.id));
  res.status(204).end();
});

export default app;
