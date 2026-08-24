# Work Log — Attendance & Wage Tracker

Simple, polished, mobile-first Work Attendance and Wage Tracker with cloud sync, monthly locking, and overtime support.

**Live features:**
- Monthly calendar (Mon–Sun), tap to log work
- Regular (OK), Weekend (2× auto), Overtime (OT 2× via edit icon)
- Edit button on worked weekdays → menu: Regular / Overtime / Remove
- Daily rate default ₦16,000, weekend/overtime 2× (configurable)
- Monthly locking: only current month editable, previous months locked as final salary, future months upcoming
- Start month = present month when you first used app, previous months removed
- Year view: total earned this year, locked/active/upcoming breakdown, monthly final salaries
- Name display: full name from auth, welcome banner, avatar
- Light/dark theme toggle (persists)
- Hybrid offline-first + Supabase cloud sync (email/password auth)
- Forgot password + recovery flow

## Stack
- React + Vite
- Supabase (auth + `user_data` table with jsonb attendance + settings)
- No Redux, no backend complexity

## Local dev

```bash
npm install
npm run dev
# open http://localhost:5173
```

Env vars needed (see `.env.example`):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Supabase setup: run `supabase-setup.sql` in SQL Editor.

## Deploy to Vercel (GitHub → Vercel)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Work Log - ready for Vercel"
# create empty repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/work-log.git
git branch -M main
git push -u origin main
```

### 2. Import in Vercel
- Go to https://vercel.com/new
- Import your GitHub repo `work-log`
- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`
- Add Environment Variables:
  - `VITE_SUPABASE_URL` = `https://kwedhxmparriekjnwlal.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = `eyJhbG...` (your anon key)
- Click Deploy

### 3. Supabase redirect URLs
- Supabase Dashboard → Authentication → URL Configuration
- Add your Vercel URL to **Site URL** and **Redirect URLs**:
  - `https://your-vercel-app.vercel.app`
  - `https://your-vercel-app.vercel.app/`

### 4. Test
- Open Vercel URL, Sign up with Full name, log days, see `synced ✓`
- Data syncs across devices via Supabase

## Project structure
- `src/App.jsx` — all core logic + auth + locking + overtime
- `src/lib/supabase.js` — Supabase client
- `src/index.css` — redesign with light/dark + bigger cards
- `supabase-setup.sql` — table + RLS
- `CLOUD_SYNC_GUIDE.md` — detailed cloud setup

## License
MIT
