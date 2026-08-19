import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function addColumnIfMissing(table, column, definition) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

const SMASH_4M_COLUMNS = ['smash_a1_4m', 'smash_a2_4m', 'smash_b1_4m', 'smash_b2_4m'];
const SMASH_3M_COLUMNS = ['smash_a1_3m', 'smash_a2_3m', 'smash_b1_3m', 'smash_b2_3m'];

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
      // smash_a1..b2 predate the 3m/4m distinction and stay frozen as
      // "distancia no especificada" for matches logged before this changed.
      for (const col of [...SMASH_3M_COLUMNS, ...SMASH_4M_COLUMNS]) {
        await addColumnIfMissing('matches', col, 'INTEGER NOT NULL DEFAULT 0');
      }
      await client.execute(`
        CREATE TABLE IF NOT EXISTS attendance (
          played_at TEXT NOT NULL,
          player_id INTEGER NOT NULL REFERENCES players(id),
          PRIMARY KEY (played_at, player_id)
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS rotation_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    })();
  }
  return schemaReady;
}

export async function getRotationState() {
  await ensureSchema();
  const { rows } = await client.execute('SELECT state FROM rotation_state WHERE id = 1');
  return rows.length ? JSON.parse(rows[0].state) : null;
}

export async function saveRotationState(state) {
  await ensureSchema();
  if (state === null) {
    await client.execute('DELETE FROM rotation_state WHERE id = 1');
    return null;
  }
  await client.execute({
    sql: `
      INSERT INTO rotation_state (id, state, updated_at) VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
    `,
    args: [JSON.stringify(state)],
  });
  return state;
}

export async function getAttendance(date) {
  await ensureSchema();
  const { rows } = await client.execute({
    sql: 'SELECT player_id AS playerId FROM attendance WHERE played_at = ?',
    args: [date],
  });
  return rows.map((r) => Number(r.playerId));
}

export async function setAttendance(date, playerIds) {
  await ensureSchema();
  await client.batch(
    [
      { sql: 'DELETE FROM attendance WHERE played_at = ?', args: [date] },
      ...playerIds.map((id) => ({
        sql: 'INSERT INTO attendance (played_at, player_id) VALUES (?, ?)',
        args: [date, id],
      })),
    ],
    'write',
  );
  return { date, playerIds };
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

function computeStreaks(matchesDesc) {
  const resultsByPlayer = new Map();
  for (const m of matchesDesc) {
    const entries = [
      [Number(m.teamA1Id), m.winningTeam === 'A'],
      [Number(m.teamA2Id), m.winningTeam === 'A'],
      [Number(m.teamB1Id), m.winningTeam === 'B'],
      [Number(m.teamB2Id), m.winningTeam === 'B'],
    ];
    for (const [id, won] of entries) {
      if (!resultsByPlayer.has(id)) resultsByPlayer.set(id, []);
      resultsByPlayer.get(id).push(won);
    }
  }

  const streaks = new Map();
  for (const [id, results] of resultsByPlayer) {
    const first = results[0];
    let count = 0;
    for (const won of results) {
      if (won !== first) break;
      count++;
    }
    streaks.set(id, first ? count : -count);
  }
  return streaks;
}

const MIN_DATE = '0000-01-01';
const MAX_DATE = '9999-12-31';

export async function getPartnerships({ from = MIN_DATE, to = MAX_DATE } = {}) {
  await ensureSchema();
  const { rows } = await client.execute({
    sql: `
      SELECT team_a1_id AS p1, team_a2_id AS p2, winning_team = 'A' AS win
      FROM matches WHERE played_at >= ? AND played_at <= ?
      UNION ALL
      SELECT team_b1_id AS p1, team_b2_id AS p2, winning_team = 'B' AS win
      FROM matches WHERE played_at >= ? AND played_at <= ?
    `,
    args: [from, to, from, to],
  });

  const pairs = new Map();
  for (const r of rows) {
    const ids = [Number(r.p1), Number(r.p2)].sort((a, b) => a - b);
    const key = ids.join(',');
    if (!pairs.has(key)) pairs.set(key, { ids, played: 0, wins: 0 });
    const entry = pairs.get(key);
    entry.played += 1;
    entry.wins += Number(r.win);
  }

  const { rows: playerRows } = await client.execute('SELECT id, name FROM players');
  const nameById = new Map(playerRows.map((p) => [Number(p.id), p.name]));

  return [...pairs.values()]
    .map((e) => ({
      player1Id: e.ids[0],
      player1Name: nameById.get(e.ids[0]),
      player2Id: e.ids[1],
      player2Name: nameById.get(e.ids[1]),
      played: e.played,
      wins: e.wins,
      losses: e.played - e.wins,
      winRate: e.played ? e.wins / e.played : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.played - a.played);
}

export async function getRanking({ from = MIN_DATE, to = MAX_DATE } = {}) {
  await ensureSchema();
  const { rows } = await client.execute({
    sql: `
      WITH results AS (
        SELECT team_a1_id AS player_id, winning_team = 'A' AS win, loser_sets,
               smash_a1 + smash_a1_3m + smash_a1_4m AS smash
        FROM matches WHERE played_at >= ? AND played_at <= ?
        UNION ALL
        SELECT team_a2_id AS player_id, winning_team = 'A' AS win, loser_sets,
               smash_a2 + smash_a2_3m + smash_a2_4m AS smash
        FROM matches WHERE played_at >= ? AND played_at <= ?
        UNION ALL
        SELECT team_b1_id AS player_id, winning_team = 'B' AS win, loser_sets,
               smash_b1 + smash_b1_3m + smash_b1_4m AS smash
        FROM matches WHERE played_at >= ? AND played_at <= ?
        UNION ALL
        SELECT team_b2_id AS player_id, winning_team = 'B' AS win, loser_sets,
               smash_b2 + smash_b2_3m + smash_b2_4m AS smash
        FROM matches WHERE played_at >= ? AND played_at <= ?
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
    `,
    args: [from, to, from, to, from, to, from, to],
  });

  const { rows: matchRows } = await client.execute({
    sql: `
      SELECT team_a1_id AS teamA1Id, team_a2_id AS teamA2Id, team_b1_id AS teamB1Id, team_b2_id AS teamB2Id,
             winning_team AS winningTeam, played_at AS playedAt
      FROM matches
      WHERE played_at >= ? AND played_at <= ?
      ORDER BY played_at DESC, id DESC
    `,
    args: [from, to],
  });
  const bonusByPlayer = computeDailyChampionBonus(matchRows);
  const streakByPlayer = computeStreaks(matchRows);

  return rows
    .map((r) => {
      const wins = Number(r.wins);
      const losses = Number(r.losses);
      const played = wins + losses;
      const id = Number(r.id);
      return {
        id,
        name: r.name,
        played,
        wins,
        losses,
        winRate: played ? wins / played : 0,
        streak: streakByPlayer.get(id) || 0,
        points: Number(r.points) + (bonusByPlayer.get(id) || 0),
      };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
}

export async function getSmashLeaders({ from = MIN_DATE, to = MAX_DATE } = {}) {
  await ensureSchema();
  const { rows } = await client.execute({
    sql: `
      WITH smashes AS (
        SELECT team_a1_id AS player_id, smash_a1_3m AS m3, smash_a1_4m AS m4, smash_a1 AS legacy
        FROM matches WHERE played_at >= ? AND played_at <= ?
        UNION ALL
        SELECT team_a2_id AS player_id, smash_a2_3m AS m3, smash_a2_4m AS m4, smash_a2 AS legacy
        FROM matches WHERE played_at >= ? AND played_at <= ?
        UNION ALL
        SELECT team_b1_id AS player_id, smash_b1_3m AS m3, smash_b1_4m AS m4, smash_b1 AS legacy
        FROM matches WHERE played_at >= ? AND played_at <= ?
        UNION ALL
        SELECT team_b2_id AS player_id, smash_b2_3m AS m3, smash_b2_4m AS m4, smash_b2 AS legacy
        FROM matches WHERE played_at >= ? AND played_at <= ?
      )
      SELECT
        p.id,
        p.name,
        COALESCE(SUM(s.m3), 0) AS m3,
        COALESCE(SUM(s.m4), 0) AS m4,
        COALESCE(SUM(s.legacy), 0) AS legacy
      FROM players p
      LEFT JOIN smashes s ON s.player_id = p.id
      GROUP BY p.id, p.name
    `,
    args: [from, to, from, to, from, to, from, to],
  });

  return rows
    .map((r) => {
      const m3 = Number(r.m3);
      const m4 = Number(r.m4);
      const legacy = Number(r.legacy);
      return { id: Number(r.id), name: r.name, m3, m4, legacy, total: m3 + m4 + legacy };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
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

export async function listMatches({ from = MIN_DATE, to = MAX_DATE } = {}) {
  await ensureSchema();
  const { rows } = await client.execute({
    sql: `
      SELECT
        m.id,
        m.team_a1_id AS teamA1Id, pa1.name AS teamA1Name,
        m.team_a2_id AS teamA2Id, pa2.name AS teamA2Name,
        m.team_b1_id AS teamB1Id, pb1.name AS teamB1Name,
        m.team_b2_id AS teamB2Id, pb2.name AS teamB2Name,
        m.winning_team AS winningTeam,
        m.loser_sets AS loserSets,
        m.smash_a1_3m AS smashA1_3m, m.smash_a1_4m AS smashA1_4m,
        m.smash_a2_3m AS smashA2_3m, m.smash_a2_4m AS smashA2_4m,
        m.smash_b1_3m AS smashB1_3m, m.smash_b1_4m AS smashB1_4m,
        m.smash_b2_3m AS smashB2_3m, m.smash_b2_4m AS smashB2_4m,
        m.smash_a1 AS smashA1, m.smash_a2 AS smashA2, m.smash_b1 AS smashB1, m.smash_b2 AS smashB2,
        m.score_note AS scoreNote,
        m.played_at AS playedAt
      FROM matches m
      JOIN players pa1 ON pa1.id = m.team_a1_id
      JOIN players pa2 ON pa2.id = m.team_a2_id
      JOIN players pb1 ON pb1.id = m.team_b1_id
      JOIN players pb2 ON pb2.id = m.team_b2_id
      WHERE m.played_at >= ? AND m.played_at <= ?
      ORDER BY m.played_at DESC, m.id DESC
    `,
    args: [from, to],
  });
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
    smashA1_3m: Number(r.smashA1_3m),
    smashA1_4m: Number(r.smashA1_4m),
    smashA2_3m: Number(r.smashA2_3m),
    smashA2_4m: Number(r.smashA2_4m),
    smashB1_3m: Number(r.smashB1_3m),
    smashB1_4m: Number(r.smashB1_4m),
    smashB2_3m: Number(r.smashB2_3m),
    smashB2_4m: Number(r.smashB2_4m),
    smashA1Legacy: Number(r.smashA1),
    smashA2Legacy: Number(r.smashA2),
    smashB1Legacy: Number(r.smashB1),
    smashB2Legacy: Number(r.smashB2),
    scoreNote: r.scoreNote,
    playedAt: r.playedAt,
  }));
}

export async function addMatch({
  teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
  smashA1_3m, smashA1_4m, smashA2_3m, smashA2_4m,
  smashB1_3m, smashB1_4m, smashB2_3m, smashB2_4m,
  scoreNote, playedAt,
}) {
  await ensureSchema();
  const result = await client.execute({
    sql: `
      INSERT INTO matches (
        team_a1_id, team_a2_id, team_b1_id, team_b2_id, winning_team, loser_sets,
        smash_a1_3m, smash_a1_4m, smash_a2_3m, smash_a2_4m,
        smash_b1_3m, smash_b1_4m, smash_b2_3m, smash_b2_4m,
        score_note, played_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
      smashA1_3m || 0, smashA1_4m || 0, smashA2_3m || 0, smashA2_4m || 0,
      smashB1_3m || 0, smashB1_4m || 0, smashB2_3m || 0, smashB2_4m || 0,
      scoreNote || null, playedAt,
    ],
  });
  return { id: Number(result.lastInsertRowid) };
}

export async function updateMatch(id, {
  teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
  smashA1_3m, smashA1_4m, smashA2_3m, smashA2_4m,
  smashB1_3m, smashB1_4m, smashB2_3m, smashB2_4m,
  scoreNote, playedAt,
}) {
  await ensureSchema();
  await client.execute({
    sql: `
      UPDATE matches SET
        team_a1_id = ?, team_a2_id = ?, team_b1_id = ?, team_b2_id = ?,
        winning_team = ?, loser_sets = ?,
        smash_a1_3m = ?, smash_a1_4m = ?, smash_a2_3m = ?, smash_a2_4m = ?,
        smash_b1_3m = ?, smash_b1_4m = ?, smash_b2_3m = ?, smash_b2_4m = ?,
        score_note = ?, played_at = ?
      WHERE id = ?
    `,
    args: [
      teamA1Id, teamA2Id, teamB1Id, teamB2Id, winningTeam, loserSets,
      smashA1_3m || 0, smashA1_4m || 0, smashA2_3m || 0, smashA2_4m || 0,
      smashB1_3m || 0, smashB1_4m || 0, smashB2_3m || 0, smashB2_4m || 0,
      scoreNote || null, playedAt,
      id,
    ],
  });
  return { id };
}

export async function deleteMatch(id) {
  await ensureSchema();
  await client.execute({ sql: 'DELETE FROM matches WHERE id = ?', args: [id] });
}
