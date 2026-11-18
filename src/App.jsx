import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { fmt, norm, parseScore, splitShare } from './lib/parse.js'
import { pct, rankDay, rankGame } from './lib/ranking.js'

const SESSION_KEY = 'leaderboard-session'

const ERRORS = {
  bad_pin: 'Pogrešan PIN.',
  locked: 'Previše pogrešnih pokušaja. Probaj ponovo za 5 minuta.',
  unknown_player: 'Igrač ne postoji.',
}

const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => toISO(new Date())
const shiftDay = (iso, delta) => {
  const [y, m, d] = iso.split('-').map(Number)
  return toISO(new Date(y, m - 1, d + delta))
}
const prettyDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('sr-Latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null
  } catch {
    return null
  }
}

export default function App() {
  if (!supabase) return <Setup />
  return <Tracker />
}

function Setup() {
  return (
    <main className="wrap">
      <h1>Leaderboard</h1>
      <div className="panel">
        <p>
          Aplikacija još nije povezana sa bazom. Napravi <code>.env</code> fajl po uzoru na{' '}
          <code>.env.example</code> i upiši <code>VITE_SUPABASE_URL</code> i{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>. Koraci su u <code>README.md</code>.
        </p>
      </div>
    </main>
  )
}

function Tracker() {
  const [players, setPlayers] = useState([])
  const [games, setGames] = useState([])
  const [scores, setScores] = useState([])
  const [day, setDay] = useState(today)
  const [view, setView] = useState('all') // 'all' ili id igrice
  const [session, setSession] = useState(loadSession)
  const [selected, setSelected] = useState(null) // { playerId, gameId }
  const [draft, setDraft] = useState(null) // rezultat koji se uređuje u formi
  const [loadError, setLoadError] = useState('')
  const dayRef = useRef(day)
  dayRef.current = day

  const loadPlayers = useCallback(async () => {
    const { data, error } = await supabase.from('players').select('id,name').order('name')
    if (error) setLoadError(error.message)
    else setPlayers(data)
  }, [])

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase
      .from('games')
      .select('id,name,default_max')
      .order('created_at')
    if (error) setLoadError(error.message)
    else setGames(data)
  }, [])

  const loadScores = useCallback(async () => {
    const wanted = dayRef.current
    const { data, error } = await supabase
      .from('scores')
      .select('player_id,game_id,day,score,max_score,raw_text')
      .eq('day', wanted)
    if (error) setLoadError(error.message)
    else if (wanted === dayRef.current) setScores(data)
  }, [])

  useEffect(() => {
    loadPlayers()
    loadGames()
    const channel = supabase
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, loadScores)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, loadGames)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, loadPlayers)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadPlayers, loadGames, loadScores])

  useEffect(() => {
    setScores([])
    setSelected(null)
    setDraft(null)
    loadScores()
  }, [day, loadScores])

  const saveSession = (s) => {
    setSession(s)
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  }

  // Zajednička obrada odgovora funkcija koje provjeravaju PIN.
  const callRpc = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, {
      p_player: session.id,
      p_pin: session.pin,
      ...args,
    })
    if (error) return error.message
    if (data !== 'ok') {
      if (data === 'bad_pin' || data === 'unknown_player') saveSession(null)
      return ERRORS[data] || 'Greška.'
    }
    return null
  }

  const playerName = useMemo(() => {
    const map = new Map(players.map((p) => [p.id, p.name]))
    return (id) => map.get(id) || '?'
  }, [players])
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games])

  const playedGames = games.filter((g) => scores.some((s) => s.game_id === g.id))
  const activeView = view === 'all' || gameById.has(view) ? view : 'all'
  const selectedEntry =
    selected &&
    scores.find((s) => s.player_id === selected.playerId && s.game_id === selected.gameId)

  const removeScore = async (entry) => {
    const err = await callRpc('delete_score', { p_game: entry.game_id, p_day: entry.day })
    if (err) setLoadError(err)
    else {
      setSelected(null)
      loadScores()
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <h1>Leaderboard</h1>
        {session && (
          <div className="who">
            <strong>{session.name}</strong>
            <button className="link" onClick={() => saveSession(null)}>
              Odjava
            </button>
          </div>
        )}
      </header>

      <section className="daynav">
        <button onClick={() => setDay(shiftDay(day, -1))} aria-label="Prethodni dan">
          ←
        </button>
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button onClick={() => setDay(shiftDay(day, 1))} aria-label="Sljedeći dan">
          →
        </button>
        {day !== today() && <button onClick={() => setDay(today())}>Danas</button>}
        <span className="muted daylabel">{prettyDay(day)}</span>
      </section>

      {loadError && (
        <p className="error" role="alert">
          {loadError}{' '}
          <button className="link" onClick={() => setLoadError('')}>
            zatvori
          </button>
        </p>
      )}

      <nav className="tabs">
        <button className={activeView === 'all' ? 'on' : ''} onClick={() => setView('all')}>
          Ukupno
        </button>
        {games.map((g) => (
          <button
            key={g.id}
            className={activeView === g.id ? 'on' : ''}
            onClick={() => setView(g.id)}
          >
            {g.name}
          </button>
        ))}
      </nav>

      {activeView === 'all' ? (
        <TotalTable
          rows={rankDay(scores)}
          games={playedGames}
          playerName={playerName}
          me={session?.id}
          selected={selected}
          onSelect={setSelected}
        />
      ) : (
        <GameTable
          rows={rankGame(scores, activeView)}
          playerName={playerName}
          me={session?.id}
          selected={selected}
          onSelect={setSelected}
        />
      )}

      {selectedEntry && (
        <section className="panel">
          <div className="row between">
            <strong>
              {playerName(selectedEntry.player_id)} · {gameById.get(selectedEntry.game_id)?.name}
            </strong>
            <button className="link" onClick={() => setSelected(null)}>
              zatvori
            </button>
          </div>
          <p>
            {fmt(selectedEntry.score)}/{fmt(selectedEntry.max_score)} ({fmt(pct(selectedEntry))}%)
          </p>
          {selectedEntry.raw_text ? (
            <pre className="raw">{selectedEntry.raw_text}</pre>
          ) : (
            <p className="muted">Ručni unos, bez share teksta.</p>
          )}
          {session?.id === selectedEntry.player_id ? (
            <div className="row">
              <button onClick={() => setDraft({ ...selectedEntry })}>Izmijeni</button>
              <button className="danger" onClick={() => removeScore(selectedEntry)}>
                Obriši
              </button>
            </div>
          ) : (
            <p className="muted">🔒 Tuđi rezultat, samo za čitanje.</p>
          )}
        </section>
      )}

      {session ? (
        <EntryForm
          games={games}
          day={day}
          draft={draft}
          defaultGame={activeView === 'all' ? '' : activeView}
          callRpc={callRpc}
          onSaved={() => {
            setDraft(null)
            loadScores()
          }}
          onGameAdded={loadGames}
        />
      ) : (
        <Login players={players} onLogin={saveSession} onRegistered={loadPlayers} />
      )}

      <details className="help">
        <summary>Kako se računa ukupni poredak?</summary>
        <p>
          Svaki rezultat se pretvara u procenat, pa se unutar igrice mjeri prema najboljem
          rezultatu tog dana (najbolji dobija 100). Propuštene igrice se ne računaju. Ocjena dana
          je prosjek tih rezultata, blago povučen ka prosjeku grupe, tako da neko sa jednom
          odigranom igricom ne pretekne nekoga ko je bio odličan u više njih.
        </p>
      </details>
    </main>
  )
}

function ScoreCell({ entry, isSelected, onSelect }) {
  if (!entry) return <td className="muted">–</td>
  return (
    <td>
      <button
        className={`cell ${isSelected ? 'on' : ''}`}
        title={entry.raw_text || 'Ručni unos'}
        onClick={() => onSelect({ playerId: entry.player_id, gameId: entry.game_id })}
      >
        {fmt(entry.score)}/{fmt(entry.max_score)}
        {entry.raw_text ? ' 📋' : ''}
      </button>
    </td>
  )
}

const isSel = (selected, entry) =>
  !!selected && selected.playerId === entry.player_id && selected.gameId === entry.game_id

function TotalTable({ rows, games, playerName, me, selected, onSelect }) {
  if (!rows.length) return <p className="muted empty">Nema rezultata za ovaj dan.</p>
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Igrač</th>
            {games.map((g) => (
              <th key={g.id}>{g.name}</th>
            ))}
            <th>Igrica</th>
            <th>Prosjek</th>
            <th>Ocjena</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} className={r.playerId === me ? 'me' : ''}>
              <td>{r.rank === 1 ? '🏆' : r.rank}</td>
              <td>{playerName(r.playerId)}</td>
              {games.map((g) => (
                <ScoreCell
                  key={g.id}
                  entry={r.entries[g.id]}
                  isSelected={!!r.entries[g.id] && isSel(selected, r.entries[g.id])}
                  onSelect={onSelect}
                />
              ))}
              <td>{r.games}</td>
              <td>{fmt(r.avgPct)}%</td>
              <td>
                <strong>{fmt(r.rating)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GameTable({ rows, playerName, me, selected, onSelect }) {
  if (!rows.length) return <p className="muted empty">Niko još nije unio ovu igricu za ovaj dan.</p>
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Igrač</th>
            <th>Rezultat</th>
            <th>Procenat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} className={r.playerId === me ? 'me' : ''}>
              <td>{r.rank === 1 ? '🏆' : r.rank}</td>
              <td>{playerName(r.playerId)}</td>
              <ScoreCell entry={r.entry} isSelected={isSel(selected, r.entry)} onSelect={onSelect} />
              <td>{fmt(r.pct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Login({ players, onLogin, onRegistered }) {
  const [playerId, setPlayerId] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isNew = playerId === 'new'

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\d{4,8}$/.test(pin)) return setError('PIN mora imati 4 do 8 cifara.')
    setBusy(true)
    try {
      if (isNew) {
        const trimmed = name.trim()
        if (!trimmed) return setError('Upiši ime.')
        const { data, error: err } = await supabase.rpc('register_player', {
          p_name: trimmed,
          p_pin: pin,
        })
        if (err) {
          return setError(err.code === '23505' ? 'To ime je već zauzeto.' : err.message)
        }
        await onRegistered()
        onLogin({ id: data, name: trimmed, pin })
      } else {
        const { data, error: err } = await supabase.rpc('check_pin', {
          p_player: playerId,
          p_pin: pin,
        })
        if (err) return setError(err.message)
        if (data !== 'ok') return setError(ERRORS[data] || 'Greška.')
        onLogin({ id: playerId, name: players.find((p) => p.id === playerId)?.name, pin })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Prijava za unos rezultata</h2>
      <div className="row">
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} required>
          <option value="">Izaberi igrača…</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">+ Novi igrač</option>
        </select>
        {isNew && (
          <input
            placeholder="Ime"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder={isNew ? 'Novi PIN (4-8 cifara)' : 'PIN'}
          value={pin}
          maxLength={8}
          onChange={(e) => setPin(e.target.value)}
        />
        <button className="primary" disabled={busy || !playerId}>
          {isNew ? 'Napravi igrača' : 'Prijavi se'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function EntryForm({ games, day, draft, defaultGame, callRpc, onSaved, onGameAdded }) {
  const [gameId, setGameId] = useState(defaultGame)
  const [scoreText, setScoreText] = useState('')
  const [raw, setRaw] = useState('')
  const [message, setMessage] = useState(null) // { ok, text }
  const [busy, setBusy] = useState(false)
  const [newGame, setNewGame] = useState('')
  const [newMax, setNewMax] = useState('')
  const [skipped, setSkipped] = useState([]) // indeksi blokova izbačenih iz grupnog unosa

  useEffect(() => {
    if (defaultGame) setGameId(defaultGame)
  }, [defaultGame])

  // "Izmijeni" na postojećem rezultatu puni formu.
  useEffect(() => {
    if (!draft) return
    setGameId(draft.game_id)
    setScoreText(`${fmt(draft.score)}/${fmt(draft.max_score)}`)
    setRaw(draft.raw_text || '')
    setMessage(null)
  }, [draft])

  const game = games.find((g) => g.id === gameId)
  const parsed = parseScore(scoreText, game?.default_max)

  // Zalijepljen tekst sa više igrica odjednom: pregled svih blokova umjesto jednog unosa.
  const items = useMemo(() => splitShare(raw, games), [raw, games])
  const batch = items.length >= 2 ? items.filter((_, i) => !skipped.includes(i)) : null
  const batchReady = batch ? batch.filter((it) => it.score !== null) : []

  const onRawChange = (text) => {
    setRaw(text)
    setSkipped([])
    setMessage(null)
    const parts = splitShare(text, games)
    if (parts.length !== 1) return
    const [only] = parts
    if (only.score !== null) setScoreText(`${fmt(only.score)}/${fmt(only.max)}`)
    if (only.game) setGameId(only.game.id)
  }

  const saveBatch = async () => {
    setBusy(true)
    setMessage(null)
    const errors = []
    let known = games
    let saved = 0
    try {
      // Prvo se prave igrice koje još ne postoje, pa se lista učita ponovo.
      const missing = batchReady.filter((it) => !it.game)
      for (const it of missing) {
        const err = await callRpc('add_game', { p_name: it.title, p_default_max: it.max })
        if (err && !err.includes('games_name_key')) errors.push(`${it.title}: ${err}`)
      }
      if (missing.length) {
        const { data } = await supabase.from('games').select('id,name,default_max')
        if (data) known = data
        onGameAdded()
      }
      for (const it of batchReady) {
        const target = it.game || known.find((g) => norm(g.name) === norm(it.title))
        if (!target) continue
        const err = await callRpc('save_score', {
          p_game: target.id,
          p_day: day,
          p_score: it.score,
          p_max: it.max,
          p_raw: it.raw,
        })
        if (err) errors.push(`${it.title}: ${err}`)
        else saved += 1
      }
    } finally {
      setBusy(false)
    }
    if (saved) onSaved()
    if (errors.length) {
      return setMessage({ ok: false, text: `Sačuvano ${saved}. Greške: ${errors.join('; ')}` })
    }
    setMessage({ ok: true, text: `Sačuvano rezultata: ${saved}` })
    setRaw('')
    setSkipped([])
    setScoreText('')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (batch) return saveBatch()
    if (!game) return setMessage({ ok: false, text: 'Izaberi igricu.' })
    if (!parsed) {
      return setMessage({ ok: false, text: 'Upiši rezultat u formatu ostvareno/maksimum, npr. 300/500.' })
    }
    setBusy(true)
    const err = await callRpc('save_score', {
      p_game: game.id,
      p_day: day,
      p_score: parsed.score,
      p_max: parsed.max,
      p_raw: raw,
    })
    setBusy(false)
    if (err) return setMessage({ ok: false, text: err })
    setMessage({ ok: true, text: `Sačuvano: ${game.name} ${fmt(parsed.score)}/${fmt(parsed.max)}` })
    setScoreText('')
    setRaw('')
    onSaved()
  }

  const addGame = async (e) => {
    e.preventDefault()
    const name = newGame.trim()
    if (!name) return
    const max = newMax.trim() ? Number(newMax.replace(',', '.')) : null
    if (max !== null && !(max > 0)) {
      return setMessage({ ok: false, text: 'Maksimum mora biti pozitivan broj.' })
    }
    const err = await callRpc('add_game', { p_name: name, p_default_max: max })
    if (err) {
      return setMessage({
        ok: false,
        text: err.includes('games_name_key') ? 'Igrica sa tim imenom već postoji.' : err,
      })
    }
    setNewGame('')
    setNewMax('')
    setMessage({ ok: true, text: `Dodata igrica: ${name}` })
    onGameAdded()
  }

  return (
    <section className="panel">
      <h2>Unos rezultata za {day}</h2>
      <form onSubmit={submit}>
        <textarea
          rows={4}
          placeholder="Zalijepi share tekst iz igrice (igrica i rezultat se prepoznaju automatski)…"
          value={raw}
          onChange={(e) => onRawChange(e.target.value)}
        />
        {batch ? (
          <>
            <ul className="batch">
              {items.map((it, i) =>
                skipped.includes(i) ? null : (
                  <li key={i}>
                    <span>
                      <strong>{it.game ? it.game.name : it.title}</strong>
                      {!it.game && it.score !== null && <em className="tag">nova igrica</em>}
                    </span>
                    <span>
                      {it.score !== null ? (
                        `${fmt(it.score)}/${fmt(it.max)}`
                      ) : (
                        <span className="muted">rezultat nije prepoznat, preskače se</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setSkipped([...skipped, i])}
                    >
                      izbaci
                    </button>
                  </li>
                ),
              )}
            </ul>
            <button className="primary" disabled={busy || !batchReady.length}>
              Sačuvaj sve ({batchReady.length})
            </button>
          </>
        ) : (
          <div className="row">
            <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
              <option value="">Igrica…</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input
              placeholder={game?.default_max ? `npr. 8/${fmt(game.default_max)}` : 'npr. 300/500'}
              value={scoreText}
              onChange={(e) => {
                setScoreText(e.target.value)
                setMessage(null)
              }}
            />
            <button className="primary" disabled={busy}>
              Sačuvaj
            </button>
          </div>
        )}
      </form>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}

      <details>
        <summary>Dodaj novu igricu</summary>
        <form className="row" onSubmit={addGame}>
          <input
            placeholder="Naziv igrice"
            value={newGame}
            maxLength={40}
            onChange={(e) => setNewGame(e.target.value)}
          />
          <input
            placeholder="Maksimum (opciono)"
            inputMode="decimal"
            value={newMax}
            onChange={(e) => setNewMax(e.target.value)}
          />
          <button>Dodaj</button>
        </form>
      </details>
    </section>
  )
}
