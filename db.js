import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let schemaReady;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_a1_id INTEGER NOT NULL REFERENCES players(id),
          team_a2_id INTEGER NOT NULL REFERENCES players(id),
          team_b1_id INTEGER NOT NULL REFERENCES players(id),
          team_b2_id INTEGER NOT NULL REFERENCES players(id),
          winning_team TEXT NOT NULL CHECK (winning_team IN ('A', 'B')),
          loser_sets INTEGER NOT NULL CHECK (loser_sets IN (0, 1)),
          smash_a1 INTEGER NOT NULL DEFAULT 0,
          smash_a2 INTEGER NOT NULL DEFAULT 0,
          smash_b1 INTEGER NOT NULL DEFAULT 0,
          smash_b2 INTEGER NOT NULL DEFAULT 0,
          score_note TEXT,
          played_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    })();
  }
  return schemaReady;
}

const CHAMPION_BONUS = 2;

function computeDailyChampionBonus(matches) {
  const byDay = new Map();
  for (const m of matches) {
    const teamAKey = [Number(m.teamA1Id), Number(m.teamA2Id)].sort((a, b) => a - b).join(',');
    const teamBKey = [Number(m.teamB1Id), Number(m.teamB2Id)].sort((a, b) => a - b).join(',');
    const winningKey = m.winningTeam === 'A' ? teamAKey : teamBKey;

    if (!byDay.has(m.playedAt)) byDay.set(m.playedAt, new Map());
    const pairWins = byDay.get(m.playedAt);
    pairWins.set(winningKey, (pairWins.get(winningKey) || 0) + 1);
  }

  const bonus = new Map();
  for (const pairWins of byDay.values()) {
    let bestKey = null;
    let bestWins = 0;
    let tie = false;
    for (const [key, wins] of pairWins) {
      if (wins > bestWins) {
        bestWins = wins;
        bestKey = key;
        tie = false;
      } else if (wins === bestWins) {
        tie = true;
      }
    }
    if (bestKey && !tie) {
      for (const idStr of bestKey.split(',')) {
        const id = Number(idStr);
        bonus.set(id, (bonus.get(id) || 0) + CHAMPION_BONUS);
      }
    }
  }
  return bonus;
}

export async function getRanking() {
  await ensureSchema();
  const { rows } = await client.execute(`
    WITH results AS (
      SELECT team_a1_id AS player_id, winning_team = 'A' AS win, loser_sets, smash_a1 AS smash FROM matches
      UNION ALL
      SELECT team_a2_id AS player_id, winning_team = 'A' AS win, loser_sets, smash_a2 AS smash FROM matches
      UNION ALL
      SELECT team_b1_id AS player_id, winning_team = 'B' AS win, loser_sets, smash_b1 AS smash FROM matches
      UNION ALL
      SELECT team_b2_id AS player_id, winning_team = 'B' AS win, loser_sets, smash_b2 AS smash FROM matches
    )
    SELECT
      p.id,
      p.name,
      COALESCE(SUM(r.win), 0) AS wins,
      COALESCE(SUM(1 - r.win), 0) AS losses,
      COALESCE(SUM(r.win * (3 - r.loser_sets) + (1 - r.win) * r.loser_sets + r.smash), 0) AS points
    FROM players p
    LEFT JOIN results r ON r.player_id = p.id
    GROUP BY p.id, p.name
  `);

  const { rows: matchRows } = await client.execute(`
    SELECT team_a1_id AS teamA1Id, team_a2_id AS teamA2Id, team_b1_id AS teamB1Id, team_b2_id AS teamB2Id,
           winning_team AS winningTeam, played_at AS playedAt
    FROM matches
  `);
  const bonusByPlayer = computeDailyChampionBonus(matchRows);

  return rows
    .map((r) => {
      const wins = Number(r.wins);
      const losses = Number(r.losses);
      const id = Number(r.id);
      return {
        id,
        name: r.name,
        played: wins + losses,
        wins,
        losses,
        points: Number(r.points) + (bonusByPlayer.get(id) || 0),
      };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
}

export async function addPlayer(name) {
  await ensureSchema();
  const result = await client.execute({
    sql: 'INSERT INTO players (name) VALUES (?)',
    args: [name],
  });
  return { id: Number(result.lastInsertRowid), name };
}

export async function renamePlayer(id, name) {
  await ensureSchema();
  await client.execute({
    sql: 'UPDATE players SET name = ? WHERE id = ?',
    args: [name, id],
  });
  return { id, name };
}

export async function deletePlayer(id) {
  await ensureSchema();
  const { rows } = await client.execute({
    sql: `
      SELECT 1 FROM matches
      WHERE team_a1_id = ? OR team_a2_id = ? OR team_b1_id = ? OR team_b2_id = ?
      LIMIT 1
    `,
    args: [id, id, id, id],
  });
  if (rows.length) {
    const err = new Error('No se puede borrar un jugador con partidos cargados');
    err.code = 'PLAYER_IN_USE';
    throw err;
  }
  await client.execute({ sql: 'DELETE FROM players WHERE id = ?', args: [id] });
}

export async function listMatches() {
  await ensureSchema();
  const { rows } = await client.execute(`
    SELECT
      m.id,
      m.team_a1_id AS teamA1Id, pa1.name AS teamA1Name,
      m.team_a2_id AS teamA2Id, pa2.name AS teamA2Name,
      m.team_b1_id AS teamB1Id, pb1.name AS teamB1Name,
      m.team_b2_id AS teamB2Id, pb2.name AS teamB2Name,
      m.winning_team AS winningTeam,
      m.loser_sets AS loserSets,
      m.smash_a1 AS smashA1, m.smash_a2 AS smashA2, m.smash_b1 AS smashB1, m.smash_b2 AS smashB2,
      m.score_note AS scoreNote,
      m.played_at AS playedAt
    FROM matches m
    JOIN players pa1 ON pa1.id = m.team_a1_id
    JOIN players pa2 ON pa2.id = m.team_a2_id
    JOIN players pb1 ON pb1.id = m.team_b1_id
    JOIN players pb2 ON pb2.id = m.team_b2_id
    ORDER BY m.played_at DESC, m.id DESC
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    teamA1Id: Number(r.teamA1Id),
    teamA1Name: r.teamA1Name,
    teamA2Id: Number(r.teamA2Id),
    teamA2Name: r.teamA2Name,
    teamB1Id: Number(r.teamB1Id),
    teamB1Name: r.teamB1Name,
    teamB2Id: Number(r.teamB2Id),
    teamB2Name: r.teamB2Name,
    winningTeam: r.winningTeam,
    loserSets: Number(r.loserSets),
    smashA1: Number(r.smashA1),
    smashA2: Number(r.smashA2),
    smashB1: Number(r.smashB1),
    smashB2: Number(r.smashB2),
    scoreNote: r.scoreNote,
    playedAt: r.playedAt,
  }));
}

export async function addMatch({
  teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
  smashA1, smashA2, smashB1, smashB2, scoreNote, playedAt,
}) {
  await ensureSchema();
  const result = await client.execute({
    sql: `
      INSERT INTO matches (
        team_a1_id, team_a2_id, team_b1_id, team_b2_id, winning_team, loser_sets,
        smash_a1, smash_a2, smash_b1, smash_b2, score_note, played_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
      smashA1 || 0, smashA2 || 0, smashB1 || 0, smashB2 || 0, scoreNote || null, playedAt,
    ],
  });
  return { id: Number(result.lastInsertRowid) };
}

export async function updateMatch(id, {
  teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
  smashA1, smashA2, smashB1, smashB2, scoreNote, playedAt,
}) {
  await ensureSchema();
  await client.execute({
    sql: `
      UPDATE matches SET
        team_a1_id = ?, team_a2_id = ?, team_b1_id = ?, team_b2_id = ?,
        winning_team = ?, loser_sets = ?,
        smash_a1 = ?, smash_a2 = ?, smash_b1 = ?, smash_b2 = ?,
        score_note = ?, played_at = ?
      WHERE id = ?
    `,
    args: [
      teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
      smashA1 || 0, smashA2 || 0, smashB1 || 0, smashB2 || 0, scoreNote || null, playedAt,
      id,
    ],
  });
  return { id };
}

export async function deleteMatch(id) {
  await ensureSchema();
  await client.execute({ sql: 'DELETE FROM matches WHERE id = ?', args: [id] });
}
