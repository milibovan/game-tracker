const SCORE_RE = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g
const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/
const KM_RE = /(\d+(?:[.,]\d+)?)\s*km(?![\p{L}\p{N}])/iu

const FINAL_RE = /\bscore\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i
// Adresa na početku reda ("www.maptap.gg November 18"): hvata se ime domena.
const SITE_RE = /^(?:https?:\/\/)?(?:www\.)?([\p{L}\p{N}-]+)\.[a-z]{2,}(?![\p{L}\p{N}])/iu
// Red na kome je samo broj ("Krillion #127 🦐" / "280").
const LINE_RE = /^[ \t]*(\d+(?:[.,]\d+)?)[ \t]*$/m

const num = (s) => Number(String(s).replace(',', '.'))

// Maksimumi igrica čiji share tekst ne ispisuje maksimum. Ključ je norm(ime).
// Krillion: 7 pitanja, najviše 100 poena po pitanju.
const KNOWN_MAX = {
  krillion: 700,
}

// Podrazumijevani maksimum: onaj iz baze, a ako ga nema, poznati maksimum po imenu.
export const maxOf = (game, title) =>
  game?.default_max ?? KNOWN_MAX[norm(game?.name ?? title)] ?? null

// Poređenje imena bez razmaka, interpunkcije i velikih slova ("Size It Up" = "SizeItUp").
export const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

// Vremenske igrice: rezultat je vrijeme rješavanja i manje je bolje. Ključ je norm(ime).
// U bazi se čuva score = max_score = vrijeme u sekundama, a poredak ih poredi obrnuto
// (vidi ranking.js).
const TIME_GAMES = ['sumplete']

// Prima igricu ili naslov bloka ("🧩 #Sumplete Daily 5x5").
export const isTimed = (game) => {
  const key = norm(typeof game === 'string' ? game : game?.name)
  return TIME_GAMES.some((k) => key.startsWith(k))
}

// "01:06.34", "1:06" ili "1:02:03.5" (sati su opcioni).
const TIME_RE = /(?:(\d+):)?(\d{1,2}):([0-5]\d)(?:[.,](\d{1,3}))?(?!\d)/

// Vrijeme u sekundama iz teksta; sam broj ("66.34") se čita kao sekunde.
export function parseTime(text) {
  const t = String(text ?? '')
  const m = t.match(TIME_RE)
  let sec = null
  if (m) sec = num(m[1] ?? 0) * 3600 + num(m[2]) * 60 + num(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0)
  else if (/^\d+(?:[.,]\d+)?$/.test(t.trim())) sec = num(t.trim())
  if (!(sec > 0)) return null
  return Math.round(sec * 1000) / 1000
}

// 66.34 -> "1:06.34"
export function fmtTime(sec) {
  const total = Math.round(Number(sec) * 100) / 100
  const m = Math.floor(total / 60)
  const s = (total - m * 60).toFixed(2).padStart(5, '0').replace(/\.00$/, '')
  return `${m}:${s}`
}

// Prikaz rezultata: vrijeme za vremenske igrice, inače "ostvareno/maksimum".
export const showScore = (score, max, timed) =>
  timed ? fmtTime(score) : `${fmt(score)}/${fmt(max)}`

// Izvlači "ostvareno/maksimum" iz teksta (ručni unos ili zalijepljeni share tekst).
// Redoslijed: prvi par x/y gdje je x <= y (pa datum "18/11" ne smeta), zatim sam broj
// uz podrazumijevani maksimum igrice, zatim kilometri ("659 km"), i na kraju procenat.
// Za vremenske igrice (timed) traži se samo vrijeme.
export function parseScore(text, defaultMax, timed = false) {
  const t = String(text ?? '')
  if (timed) {
    const sec = parseTime(t)
    return sec === null ? null : { score: sec, max: sec }
  }
  for (const m of t.matchAll(SCORE_RE)) {
    const score = num(m[1])
    const max = num(m[2])
    if (max > 0 && score <= max) return { score, max }
  }
  const only = t.trim()
  if (defaultMax && /^\d+(?:[.,]\d+)?$/.test(only)) {
    const score = num(only)
    if (score <= defaultMax) return { score, max: Number(defaultMax) }
  }
  // Kilometri bez maksimuma ("Докле, бре? #16 · 659 km"): maksimum je podrazumijevani
  // maksimum igrice, a ako ga nema ili je premašen, prva veća hiljada.
  // Isto važi za "Final score: 939" (maptap.gg) i za broj sam na svom redu (Krillion),
  // gdje se maksimum takođe ne ispisuje.
  const open = t.match(KM_RE) || t.match(FINAL_RE) || t.match(LINE_RE)
  if (open) {
    const score = num(open[1])
    const max = defaultMax && score <= defaultMax ? Number(defaultMax) : Math.max(1, Math.ceil(score / 1000)) * 1000
    return { score, max }
  }
  const p = t.match(PERCENT_RE)
  if (p && num(p[1]) <= 100) return { score: num(p[1]), max: 100 }
  return null
}

// Prepoznaje igricu po imenu koje se pojavljuje u tekstu (najranije pojavljivanje pobjeđuje).
export function detectGame(text, games) {
  const hay = norm(text)
  let best = null
  for (const g of games) {
    const key = norm(g.name)
    if (key.length < 3) continue
    const idx = hay.indexOf(key)
    if (idx === -1) continue
    if (!best || idx < best.idx || (idx === best.idx && key.length > best.key.length)) {
      best = { idx, key, game: g }
    }
  }
  return best ? best.game : null
}

// Naslov bloka: prvi red do broja zagonetke ili separatora ("Eraly #33 · ..." -> "Eraly").
function titleOf(paragraph) {
  const first = paragraph.split('\n')[0].trim()
  const site = first.match(SITE_RE)
  if (site) return site[1].slice(0, 40)
  const cut = first.split(/#\d|\s[·–|-]\s/)[0].trim()
  return (cut || first).slice(0, 40)
}

function sameTitle(a, b) {
  const x = norm(a)
  const y = norm(b)
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x))
}

function matchGame(title, raw, games) {
  const byTitle = games.find((g) => norm(g.name).length >= 3 && sameTitle(g.name, title))
  return byTitle || detectGame(raw, games)
}

// Dijeli zalijepljeni tekst na blokove, po jedan za svaku igricu.
// Novi blok počinje pasusom čiji prvi red sadrži broj zagonetke ("Reborder #321"),
// kome je drugi red samo taj broj ("Size It Up" / "#100"), ili koji počinje imenom poznate igrice
// (i kad je ono dio adrese: "www.maptap.gg November 18").
// Vraća [{ title, raw, score, max, game, timed }]; score je null kad rezultat nije prepoznat.
export function splitShare(text, games) {
  const paragraphs = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const keys = games.map((g) => norm(g.name)).filter((k) => k.length >= 3)

  const isStart = (p) => {
    const lines = p.split('\n').map((l) => l.trim())
    if (/\p{L}.*#\d+/u.test(lines[0])) return true
    if (lines[1] && /^#\d+$/.test(lines[1]) && /\p{L}/u.test(lines[0])) return true
    const site = lines[0].match(SITE_RE)
    const first = norm(site ? site[1] : lines[0])
    // Igrica može biti nazvana i po cijeloj adresi ("maptap.gg").
    return keys.some((k) => first.startsWith(k) || (site && k.startsWith(first)))
  }

  const segments = []
  for (const p of paragraphs) {
    if (!segments.length || isStart(p)) segments.push({ title: titleOf(p), parts: [p] })
    else segments[segments.length - 1].parts.push(p)
  }

  const items = []
  for (const seg of segments) {
    const raw = seg.parts.join('\n\n')
    const game = matchGame(seg.title, raw, games)
    const timed = isTimed(game ?? seg.title)
    const parsed = parseScore(raw, maxOf(game, seg.title), timed)
    const prev = items[items.length - 1]
    // Potpis na kraju ("Size It Up – Daily Size Guessing Game") pripada prethodnom bloku.
    if (!parsed && prev && sameTitle(seg.title, prev.title)) {
      prev.raw += `\n\n${raw}`
      continue
    }
    items.push({
      title: seg.title,
      raw,
      score: parsed ? parsed.score : null,
      max: parsed ? parsed.max : null,
      game,
      timed,
    })
  }
  return items
}

export function fmt(n, digits = 1) {
  return Number(Number(n).toFixed(digits)).toString()
}
