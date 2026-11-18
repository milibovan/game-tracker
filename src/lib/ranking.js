// Dnevni poredak.
//
// 1. Svaki rezultat se pretvara u procenat (445/700 = 63.6%).
// 2. Unutar igrice procenat se mjeri prema najboljem tog dana ("relativni" rezultat,
//    najbolji = 100). Tako teška igrica ili težak dan ne kažnjavaju nikoga.
//    Ako je igricu taj dan igrao samo jedan igrač, nema poređenja pa ostaje čist procenat.
// 3. Propuštene igrice se ignorišu (ne računaju se kao 0).
// 4. Ocjena dana = prosjek relativnih rezultata, blago povučen ka prosjeku grupe:
//      ocjena = (zbir relativnih + PRIOR_WEIGHT * prosjek grupe) / (broj igrica + PRIOR_WEIGHT)
//    Što više igrica odigraš, to ocjena više zavisi samo od tebe, pa jedna jedina
//    dobra igrica ne pobjeđuje nekoga ko je bio odličan u četiri.
//    PRIOR_WEIGHT = 0 daje čist prosjek odigranih igrica.
export const PRIOR_WEIGHT = 1

export const pct = (s) => (Number(s.score) / Number(s.max_score)) * 100

function withRanks(rows, key) {
  let rank = 0
  return rows.map((row, i) => {
    if (i === 0 || Math.abs(key(row) - key(rows[i - 1])) > 1e-9) rank = i + 1
    return { ...row, rank }
  })
}

// Poredak unutar jedne igrice za dan.
export function rankGame(scores, gameId) {
  const rows = scores
    .filter((s) => s.game_id === gameId)
    .map((s) => ({ playerId: s.player_id, entry: s, pct: pct(s) }))
    .sort((a, b) => b.pct - a.pct)
  return withRanks(rows, (r) => r.pct)
}

// Ukupni poredak dana.
export function rankDay(scores) {
  const byGame = new Map()
  for (const s of scores) {
    if (!byGame.has(s.game_id)) byGame.set(s.game_id, [])
    byGame.get(s.game_id).push(s)
  }

  const players = new Map()
  let relSum = 0
  let relCount = 0
  for (const entries of byGame.values()) {
    const best = Math.max(...entries.map(pct))
    const compare = entries.length >= 2 && best > 0
    for (const s of entries) {
      const p = pct(s)
      const rel = compare ? (p / best) * 100 : p
      relSum += rel
      relCount += 1
      if (!players.has(s.player_id)) {
        players.set(s.player_id, { playerId: s.player_id, entries: {}, n: 0, pctSum: 0, relSum: 0 })
      }
      const row = players.get(s.player_id)
      row.entries[s.game_id] = s
      row.n += 1
      row.pctSum += p
      row.relSum += rel
    }
  }

  const dayMean = relCount ? relSum / relCount : 0
  const rows = [...players.values()]
    .map((r) => ({
      playerId: r.playerId,
      entries: r.entries,
      games: r.n,
      avgPct: r.pctSum / r.n,
      rating: (r.relSum + PRIOR_WEIGHT * dayMean) / (r.n + PRIOR_WEIGHT),
    }))
    .sort((a, b) => b.rating - a.rating || b.games - a.games || b.avgPct - a.avgPct)
  return withRanks(rows, (r) => r.rating)
}
