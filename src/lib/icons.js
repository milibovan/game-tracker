import { norm } from './parse.js'

// Ikonice igrica. Ključ je ime igrice bez razmaka, interpunkcije i velikih slova.
// Vrijednost je emoji ili { url: 'https://...' } za pravu sliku (logo igrice).
// Igrica koje nema ovdje dobija pločicu sa početnim slovom.
const ICONS = {
  eraly: '⏳',
  georiddle: '🌍',
  sizeitup: '📏',
  dnevnikviz: '❓',
  доклебре: '🚌',
  farflung: '✈️',
  reborder: '🗺️',
  krillion: '🦐',
  sumplete: '🧩'
}

export function gameIcon(name) {
  const icon = ICONS[norm(name)]
  if (!icon) return { letter: (String(name).trim()[0] || '?').toUpperCase() }
  return typeof icon === 'string' ? { emoji: icon } : icon
}
