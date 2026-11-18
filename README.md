# Leaderboard tracker

Dnevni leaderboard za grupu prijatelja i više igrica (Eraly, Georiddle, SizeItUp, Dnevni kviz…).

- **Stack:** React + Vite (statički frontend), Supabase (Postgres + realtime), hosting na Vercelu ili Cloudflare Pages. Sve na besplatnim planovima.
- **Prijava:** ime + PIN. PIN se provjerava na serveru, pa svako može mijenjati samo svoje rezultate.
- **Unos:** ručno (`300/500`) ili lijepljenjem share teksta, iz kog se automatski čitaju igrica i rezultat.

## Podešavanje (jednom, oko 10 minuta)

1. Napravi besplatan projekat na <https://supabase.com>.
2. U projektu otvori **SQL Editor**, zalijepi sadržaj fajla `supabase/schema.sql` i pokreni ga.
3. U **Project Settings → API** kopiraj *Project URL* i *anon public* ključ.
4. Kopiraj `.env.example` u `.env` i upiši te dvije vrijednosti.
5. Pokreni lokalno:

   ```
   npm install
   npm run dev
   ```

## Hosting (besplatno)

1. Stavi projekat na GitHub (`.env` se ne šalje, već je u `.gitignore`).
2. Na <https://vercel.com> izaberi **Add New → Project** i uvezi repozitorijum (Vite se prepoznaje sam).
3. U **Environment Variables** dodaj `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY`, pa **Deploy**.
4. Link pošalji prijateljima. Svako prvi put izabere **+ Novi igrač** i postavi svoj PIN.

Napomena: Supabase na besplatnom planu pauzira projekat poslije 7 dana bez ikakve aktivnosti. Uz dnevno korišćenje se to ne dešava, a pauziran projekat se vraća jednim klikom u Supabase panelu.

## Kako se računa poredak

Logika je u `src/lib/ranking.js`.

1. Svaki rezultat se pretvara u procenat (445/700 = 63.6%).
2. Unutar igrice se procenat mjeri prema najboljem rezultatu tog dana (najbolji = 100). Ako je igricu igrao samo jedan igrač, ostaje čist procenat.
3. Propuštene igrice se ignorišu.
4. Ocjena dana je prosjek tih rezultata, blago povučen ka prosjeku grupe:
   `ocjena = (zbir + prosjek grupe) / (broj igrica + 1)`.
   Tako jedna jedina dobra igrica ne pobjeđuje nekoga ko je bio odličan u četiri.
   Za čist prosjek odigranih igrica postavi `PRIOR_WEIGHT = 0`.

## Administracija

- Zaboravljen PIN, brisanje igrača ili igrice: direktno u Supabase **Table Editor**. Za novi PIN obriši igrača iz tabele `players` ili u SQL Editoru pokreni:

  ```sql
  update player_secrets
  set pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')), locked_until = null
  where player_id = (select id from players where name = 'Ime');
  ```

- Svako ko ima link može napraviti novog igrača. Za zatvorenu grupu ne dijeli link javno.
