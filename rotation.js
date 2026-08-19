function sortIdsByPointsDesc(ids, meta) {
  return [...ids].sort((a, b) => {
    const pa = meta.get(a)?.points ?? 0;
    const pb = meta.get(b)?.points ?? 0;
    if (pb !== pa) return pb - pa;
    return (meta.get(a)?.name || '').localeCompare(meta.get(b)?.name || '');
  });
}

function snakePairFour(fourIds, meta) {
  const sorted = sortIdsByPointsDesc(fourIds, meta);
  return { A: [sorted[0], sorted[3]], B: [sorted[1], sorted[2]] };
}

function idsEqual(a, b) {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

export function buildRotation(date, presentIds, meta) {
  const sorted = sortIdsByPointsDesc(presentIds, meta);
  return {
    date,
    onCourt: snakePairFour(sorted.slice(0, 4), meta),
    queue: sorted.slice(4),
    defenderIds: null,
    streak: 0,
  };
}

export function advanceRotation(rotation, winnerSide, meta) {
  if (!rotation || (winnerSide !== 'A' && winnerSide !== 'B')) return rotation;

  const loserSide = winnerSide === 'A' ? 'B' : 'A';
  const winners = rotation.onCourt[winnerSide];
  const losers = rotation.onCourt[loserSide];
  const isSameDefenders = rotation.defenderIds && idsEqual(winners, rotation.defenderIds);
  const newStreak = isSameDefenders ? rotation.streak + 1 : 1;

  if (newStreak >= 2) {
    const queue = [...rotation.queue, ...losers, ...winners];
    const next4 = queue.splice(0, 4);
    return { ...rotation, onCourt: snakePairFour(next4, meta), queue, defenderIds: null, streak: 0 };
  }

  const queue = [...rotation.queue, ...losers];
  const next2 = queue.splice(0, 2);
  return { ...rotation, onCourt: { A: winners, B: next2 }, queue, defenderIds: winners, streak: newStreak };
}

export function matchesOnCourt(rotation, teamAIds, teamBIds) {
  if (!rotation) return false;
  return idsEqual(teamAIds, rotation.onCourt.A) && idsEqual(teamBIds, rotation.onCourt.B);
}
