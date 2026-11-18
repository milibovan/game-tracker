import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // NEXT_PUBLIC_ je prefiks koji koristi Vercel <-> Supabase integracija.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
})
