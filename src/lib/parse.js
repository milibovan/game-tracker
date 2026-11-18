const SCORE_RE = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g
const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/
const KM_RE = /(\d+(?:[.,]\d+)?)\s*km(?![\p{L}\p{N}])/iu

const num = (s) => Number(String(s).replace(',', '.'))

// Poređenje imena bez razmaka, interpunkcije i velikih slova ("Size It Up" = "SizeItUp").
export const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

// Izvlači "ostvareno/maksimum" iz teksta (ručni unos ili zalijepljeni share tekst).
// Redoslijed: prvi par x/y gdje je x <= y (pa datum "18/11" ne smeta), zatim sam broj
// uz podrazumijevani maksimum igrice, zatim kilometri ("659 km"), i na kraju procenat.
export function parseScore(text, defaultMax) {
  const t = String(text ?? '')
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
  const km = t.match(KM_RE)
  if (km) {
    const score = num(km[1])
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
// kome je drugi red samo taj broj ("Size It Up" / "#100"), ili koji počinje imenom poznate igrice.
// Vraća [{ title, raw, score, max, game }]; score je null kad rezultat nije prepoznat.
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
    const first = norm(lines[0])
    return keys.some((k) => first.startsWith(k))
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
    const parsed = parseScore(raw, game?.default_max)
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
    })
  }
  return items
}

export function fmt(n, digits = 1) {
  return Number(Number(n).toFixed(digits)).toString()
}
