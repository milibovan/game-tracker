import { createClient } from '@supabase/supabase-js'

const env = import.meta.env

// Prihvata i imena koja postavlja Vercel <-> Supabase integracija (NEXT_PUBLIC_*).
const rawUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const key =
  env.VITE_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

// Zadržava samo https://xxxx.supabase.co; višak poput /rest/v1/ izaziva grešku PGRST125.
function baseUrl(value) {
  try {
    return new URL(String(value).trim()).origin
  } catch {
    return null
  }
}

const url = rawUrl ? baseUrl(rawUrl) : null

// null kad okruženje nije podešeno; App tada prikazuje uputstvo.
export const supabase = url && key ? createClient(url, key.trim()) : null
