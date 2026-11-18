const SCORE_RE = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g

const num = (s) => Number(String(s).replace(',', '.'))

// Izvlači "ostvareno/maksimum" iz teksta (ručni unos ili zalijepljeni share tekst).
// Uzima prvi par gdje je ostvareno <= maksimum, pa npr. datum "18/11" ne smeta.
// Ako je unesen samo broj, koristi podrazumijevani maksimum igrice.
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
  return null
}

// Prepoznaje igricu po imenu koje se pojavljuje u tekstu (najranije pojavljivanje pobjeđuje).
export function detectGame(text, games) {
  const lower = String(text ?? '').toLowerCase()
  let best = null
  for (const g of games) {
    const idx = lower.indexOf(g.name.trim().toLowerCase())
    if (idx === -1) continue
    if (!best || idx < best.idx || (idx === best.idx && g.name.length > best.game.name.length)) {
      best = { idx, game: g }
    }
  }
  return best ? best.game : null
}

export function fmt(n, digits = 1) {
  return Number(Number(n).toFixed(digits)).toString()
}
