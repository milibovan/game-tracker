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
//
// Vremenske igrice (Sumplete): score je vrijeme u sekundama i manje je bolje. Nemaju
// maksimum, pa ni procenat; relativni rezultat je najbrže vrijeme / tvoje vrijeme * 100
// (duplo sporiji od najbržeg = 50). Kad je igricu taj dan igrao samo jedan igrač, nema
// s čim da se poredi, pa se taj rezultat prikazuje, ali ne ulazi u ocjenu dana.
// Funkcije primaju `timed`: Set id-jeva vremenskih igrica.
export const PRIOR_WEIGHT = 1

const NONE = new Set()
const TIME_SCALE = 1e6

export const pct = (s) => (Number(s.score) / Number(s.max_score)) * 100

const speed = (seconds) => (seconds > 0 ? TIME_SCALE / seconds : 0)

// Učinak rezultata, veće je bolje: procenat, a za vremenske igrice brzina (obrnuto
// srazmjerna vremenu). Brzina ima smisla samo u poređenju unutar iste igrice.
export const perf = (s, timed = NONE) => (timed.has(s.game_id) ? speed(Number(s.score)) : pct(s))

function withRanks(rows, key) {
  let rank = 0
  return rows.map((row, i) => {
    if (i === 0 || Math.abs(key(row) - key(rows[i - 1])) > 1e-9) rank = i + 1
    return { ...row, rank }
  })
}

// Poredak unutar jedne igrice za dan. Za vremenske igrice pct je odnos prema najbržem
// tog dana (najbrži = 100).
export function rankGame(scores, gameId, timed = NONE) {
  const mine = scores.filter((s) => s.game_id === gameId)
  const isTimed = timed.has(gameId)
  const best = Math.max(0, ...mine.map((s) => perf(s, timed)))
  const rows = mine
    .map((s) => ({
      playerId: s.player_id,
      entry: s,
      pct: isTimed ? (best > 0 ? (perf(s, timed) / best) * 100 : 0) : pct(s),
    }))
    .sort((a, b) => b.pct - a.pct)
  return withRanks(rows, (r) => r.pct)
}

// Najbolji učinak po igrici: Map(gameId -> perf). Računa se samo kad igrica ima
// bar dva rezultata, jer jedini rezultat nema s čim da se poredi. Od skupa rezultata
// zavisi šta se dobija: rezultati jednog dana daju najbolje tog dana, a svi rezultati
// rekorde svih vremena.
export function bestByGame(scores, timed = NONE) {
  const agg = new Map()
  for (const s of scores) {
    const a = agg.get(s.game_id) || { n: 0, best: 0 }
    a.n += 1
    a.best = Math.max(a.best, perf(s, timed))
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
// Za vremenske igrice poredi se prosječno vrijeme: najbolji prosjek / tvoj prosjek * 100.
//
// Vraća:
//   byPlayer: Map(playerId -> { overall, games: { gameId: { n, avgScore, strength, isBest } } })
//   byGame:   Map(gameId -> { groupAvg, players })   groupAvg = prosječna jačina grupe
export function strengths(scores, timed = NONE) {
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
    const isTimed = timed.has(gameId)
    const rows = [...perPlayer].map(([playerId, a]) => ({
      playerId,
      n: a.n,
      avgPct: isTimed ? speed(a.scoreSum / a.n) : a.pctSum / a.n,
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

// Ukupni poredak dana. avgPct je prosjek čistih procenata, bez vremenskih igrica
// (null kad igrač ima samo njih).
export function rankDay(scores, timed = NONE) {
  const byGame = new Map()
  for (const s of scores) {
    if (!byGame.has(s.game_id)) byGame.set(s.game_id, [])
    byGame.get(s.game_id).push(s)
  }

  const players = new Map()
  let relSum = 0
  let relCount = 0
  for (const [gameId, entries] of byGame) {
    const isTimed = timed.has(gameId)
    const best = Math.max(...entries.map((s) => perf(s, timed)))
    const compare = entries.length >= 2 && best > 0
    for (const s of entries) {
      const p = perf(s, timed)
      // Vremenski rezultat bez poređenja nema ni procenat, pa ne ulazi u ocjenu.
      const rel = compare ? (p / best) * 100 : isTimed ? null : p
      if (!players.has(s.player_id)) {
        players.set(s.player_id, {
          playerId: s.player_id,
          entries: {},
          n: 0,
          rated: 0,
          pctN: 0,
          pctSum: 0,
          relSum: 0,
        })
      }
      const row = players.get(s.player_id)
      row.entries[s.game_id] = s
      row.n += 1
      if (!isTimed) {
        row.pctN += 1
        row.pctSum += p
      }
      if (rel !== null) {
        relSum += rel
        relCount += 1
        row.rated += 1
        row.relSum += rel
      }
    }
  }

  const dayMean = relCount ? relSum / relCount : 0
  const rows = [...players.values()]
    .map((r) => ({
      playerId: r.playerId,
      entries: r.entries,
      games: r.n,
      avgPct: r.pctN ? r.pctSum / r.pctN : null,
      rating:
        r.rated + PRIOR_WEIGHT > 0 ? (r.relSum + PRIOR_WEIGHT * dayMean) / (r.rated + PRIOR_WEIGHT) : dayMean,
    }))
    .sort((a, b) => b.rating - a.rating || b.games - a.games || (b.avgPct ?? 0) - (a.avgPct ?? 0))
  return withRanks(rows, (r) => r.rating)
}
