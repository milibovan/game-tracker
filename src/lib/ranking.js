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

// Najbolji procenat po igrici: Map(gameId -> procenat). Računa se samo kad igrica ima
// bar dva rezultata, jer jedini rezultat nema s čim da se poredi. Od skupa rezultata
// zavisi šta se dobija: rezultati jednog dana daju najbolje tog dana, a svi rezultati
// rekorde svih vremena.
export function bestByGame(scores) {
  const agg = new Map()
  for (const s of scores) {
    const a = agg.get(s.game_id) || { n: 0, best: 0 }
    a.n += 1
    a.best = Math.max(a.best, pct(s))
    agg.set(s.game_id, a)
  }
  const out = new Map()
  for (const [gameId, a] of agg) if (a.n >= 2 && a.best > 0) out.set(gameId, a.best)
  return out
}

// Jačina igrača po igricama, za profile. Računa se iz svih rezultata na sajtu.
//
// Za svaku igricu: prosjek igrača se dijeli prosjekom najboljeg igrača u toj igrici
// (najbolji = 100). Mjeri se dakle prema drugim igračima, a ne prema mogućem maksimumu:
// ako je maksimum 1000, a najbolji u grupi ima prosjek 500, onda je 500 jačina 100.
//
// Vraća:
//   byPlayer: Map(playerId -> { overall, games: { gameId: { n, avgScore, strength, isBest } } })
//   byGame:   Map(gameId -> { groupAvg, players })   groupAvg = prosječna jačina grupe
export function strengths(scores) {
  const agg = new Map()
  for (const s of scores) {
    if (!agg.has(s.game_id)) agg.set(s.game_id, new Map())
    const perPlayer = agg.get(s.game_id)
    if (!perPlayer.has(s.player_id)) perPlayer.set(s.player_id, { n: 0, pctSum: 0, scoreSum: 0 })
    const a = perPlayer.get(s.player_id)
    a.n += 1
    a.pctSum += pct(s)
    a.scoreSum += Number(s.score)
  }

  const byPlayer = new Map()
  const byGame = new Map()
  for (const [gameId, perPlayer] of agg) {
    const rows = [...perPlayer].map(([playerId, a]) => ({
      playerId,
      n: a.n,
      avgPct: a.pctSum / a.n,
      avgScore: a.scoreSum / a.n,
    }))
    const best = Math.max(...rows.map((r) => r.avgPct))
    let sum = 0
    for (const r of rows) {
      const strength = best > 0 ? (r.avgPct / best) * 100 : 0
      sum += strength
      if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, { overall: 0, games: {} })
      byPlayer.get(r.playerId).games[gameId] = {
        n: r.n,
        avgScore: r.avgScore,
        strength,
        isBest: rows.length > 1 && best > 0 && r.avgPct >= best - 1e-9,
      }
    }
    byGame.set(gameId, { groupAvg: sum / rows.length, players: rows.length })
  }
  for (const p of byPlayer.values()) {
    const list = Object.values(p.games)
    p.overall = list.reduce((t, g) => t + g.strength, 0) / list.length
  }
  return { byPlayer, byGame }
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
