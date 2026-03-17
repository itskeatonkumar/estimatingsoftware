# Standalone Estimating SaaS — Complete Setup Guide

This guide walks you through setting up a standalone construction estimating SaaS product from scratch. When you're done, you'll have a deployed web app where subcontractors can sign up, upload plans, draw takeoffs, and generate estimates.

---

## WHAT YOU'LL HAVE WHEN DONE

```
https://your-app.vercel.app
├── Login / Signup (Supabase Auth)
├── Project List (create, search, delete)
├── Takeoff Workspace
│   ├── Plan Viewer (PDF/image upload, pan/zoom)
│   ├── Drawing Tools (area, linear, count, cutout, eraser)
│   ├── Scale Calibration
│   ├── Takeoff Sidebar (categories, items, quantities)
│   ├── Reports Tab (sortable table, CSV export)
│   └── Estimates Tab (summary, worksheet, download proposal)
└── Billing (Stripe — free tier + paid plans)
```

---

## PREREQUISITES

- Node.js 18+ installed
- Git installed
- GitHub account
- Supabase account (free): https://supabase.com
- Vercel account (free): https://vercel.com
- Stripe account (when ready for billing): https://stripe.com

---

## STEP 1: CREATE THE PROJECT

Open PowerShell and run:

```powershell
cd C:\Users\itske
mkdir estimator
cd estimator
npm create vite@latest . -- --template react
npm install
npm install @supabase/supabase-js zustand immer
npm install -D vitest @vitest/coverage-v8 jsdom
```

Test it works:
```powershell
npm run dev
```
You should see the Vite welcome page at http://localhost:5173. Stop the server (Ctrl+C).

---

## STEP 2: CREATE THE FILE STRUCTURE

Delete the default Vite files and create our structure:

```powershell
# Delete defaults
del src\App.css
del src\App.jsx
del src\index.css

# Create our folders
mkdir src\lib
mkdir src\lib\__tests__
mkdir src\stores
mkdir src\components\ui
mkdir src\features\takeoff
mkdir src\features\auth
mkdir api\webhooks
mkdir supabase\migrations
```

---

## STEP 3: PLACE THE FILES

Download all files from the output and place them exactly like this:

```
estimator/
│
├── api/                          ← Vercel serverless functions
│   ├── create-checkout.js        ← Stripe checkout session
│   ├── create-portal.js          ← Stripe billing portal
│   └── webhooks/
│       └── stripe.js             ← Stripe webhook handler
│
├── public/                       ← Static assets (favicon etc)
│
├── src/
│   ├── main.jsx                  ← Entry point (keep Vite default, edit slightly)
│   ├── index.css                 ← Global styles
│   ├── App.jsx                   ← Root component (11 lines)
│   │
│   ├── components/ui/
│   │   ├── Modal.jsx             ← Shared modal component
│   │   └── ErrorBoundary.jsx     ← Crash recovery wrapper
│   │
│   ├── lib/
│   │   ├── supabase.js           ← Supabase client + helpers
│   │   ├── constants.js          ← Business constants (categories, scales)
│   │   ├── geometry.js           ← Area/linear/bezier calculations
│   │   ├── theme.jsx             ← Dark/light theme system
│   │   ├── utils.js              ← Date formatting, debounce
│   │   ├── billing.js            ← Stripe plan checking hook
│   │   └── __tests__/
│   │       └── geometry.test.js  ← Unit tests for calculations
│   │
│   ├── stores/
│   │   └── takeoffStore.js       ← Zustand state management
│   │
│   └── features/
│       ├── auth/
│       │   └── LoginScreen.jsx   ← Email/password login
│       └── takeoff/
│           ├── TakeoffComponents.jsx  ← Modals, inline editors
│           ├── TakeoffWorkspace.jsx   ← Core canvas + drawing
│           └── ProjectList.jsx        ← Project list page
│
├── supabase/
│   └── migrations/
│       └── 001_multi_tenant.sql  ← Database schema
│
├── vite.config.js
├── vitest.config.js
├── .env                          ← Environment variables (DO NOT COMMIT)
├── .env.example                  ← Template for env vars
└── .gitignore
```

---

## STEP 4: SET UP SUPABASE

### 4a. Create a Supabase project
1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Name: "estimator" (or your product name)
4. Region: US East (closest to your users)
5. Generate a strong database password — save it somewhere safe
6. Wait for project to provision (~2 minutes)

### 4b. Get your keys
1. Go to Settings → API
2. Copy "Project URL" → this is VITE_SUPABASE_URL
3. Copy "anon public" key → this is VITE_SUPABASE_ANON_KEY
4. Copy "service_role" key → this is SUPABASE_SERVICE_ROLE_KEY (for webhooks only)

### 4c. Create the database tables
1. Go to SQL Editor in Supabase Dashboard
2. Open the file `supabase/migrations/001_multi_tenant.sql`
3. Copy the ENTIRE contents
4. Paste into SQL Editor
5. Click "Run"
6. You should see "Success" with a table of RLS policies

### 4d. Enable Auth
1. Go to Authentication → Settings
2. Under "Email", make sure "Enable Email Signup" is ON
3. Under "Email OTP" / confirm email — for development, you can turn off "Confirm email" to make signup instant

### 4e. Create your .env file
In the project root, create `.env`:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## STEP 5: TEST LOCALLY

```powershell
npm run dev
```

1. Open http://localhost:5173
2. You should see the login screen
3. Sign up with an email/password
4. After signup, you should see the project list (empty)
5. Click "+ New Project" to create your first project
6. Upload a plan PDF or image
7. Set the scale
8. Draw an area measurement
9. Check the Reports and Estimates tabs

---

## STEP 6: SET UP GITHUB

```powershell
git init
git add .
git commit -m "initial commit: standalone estimating SaaS"
git branch -M main
git remote add origin https://github.com/itskeatonkumar/estimator.git
git push -u origin main
```

(Create the repo on GitHub first at https://github.com/new)

---

## STEP 7: DEPLOY TO VERCEL

### 7a. Connect to Vercel
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. Framework: Vite
4. Build command: `npm run build`
5. Output directory: `dist`

### 7b. Add environment variables
In Vercel project settings → Environment Variables, add:
```
VITE_SUPABASE_URL = (your Supabase URL)
VITE_SUPABASE_ANON_KEY = (your anon key)
SUPABASE_SERVICE_ROLE_KEY = (your service role key — for API routes only)
```

### 7c. Deploy
Click "Deploy". Your app is now live at `https://estimator-xxx.vercel.app`.

### 7d. Add custom domain (when ready)
1. Buy domain (Namecheap, Cloudflare, etc.)
2. In Vercel → Settings → Domains → Add your domain
3. Update DNS: add CNAME pointing to `cname.vercel-dns.com`

---

## STEP 8: SET UP STRIPE (When Ready for Billing)

### 8a. Create Stripe products
1. Go to Stripe Dashboard → Products
2. Create "Pro Plan" — $199/month (or $1,999/year)
3. Note the Price ID (starts with `price_`)

### 8b. Add Stripe env vars to Vercel
```
STRIPE_SECRET_KEY = sk_live_... (or sk_test_... for testing)
STRIPE_WEBHOOK_SECRET = whsec_...
```

### 8c. Set up webhook
1. Stripe Dashboard → Webhooks → Add endpoint
2. URL: `https://your-app.vercel.app/api/webhooks/stripe`
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the signing secret → that's STRIPE_WEBHOOK_SECRET

### 8d. Update price IDs
In `api/webhooks/stripe.js`, update the `PRICE_TO_PLAN` mapping with your actual Stripe price IDs.

---

## STEP 9: RUN UNIT TESTS

```powershell
npx vitest run
```

All geometry tests should pass. These verify the area/linear calculations that directly affect bid totals.

---

## ONGOING DEVELOPMENT

Every time you make changes:
```powershell
git add .
git commit -m "description of change"
git push
```
Vercel auto-deploys on every push to main.

---

## FILE REFERENCE

| File | Lines | What it does |
|---|---|---|
| `src/App.jsx` | 24 | Root: auth check → Login or ProjectList |
| `src/components/ui/Modal.jsx` | 30 | Reusable modal overlay |
| `src/components/ui/ErrorBoundary.jsx` | 81 | Catches crashes, shows recovery UI |
| `src/lib/supabase.js` | 59 | Supabase client + safe helpers |
| `src/lib/constants.js` | 90 | Categories, scales, assemblies |
| `src/lib/geometry.js` | 216 | Area, linear, bezier, clipping math |
| `src/lib/theme.jsx` | 93 | Dark/light theme with CSS vars |
| `src/lib/utils.js` | 40 | Date formatting, debounce |
| `src/lib/billing.js` | 133 | Plan limits, Stripe checkout hook |
| `src/stores/takeoffStore.js` | 144 | Zustand store for workspace state |
| `src/features/auth/LoginScreen.jsx` | 57 | Email/password auth screen |
| `src/features/takeoff/ProjectList.jsx` | ~250 | Project list, create, search |
| `src/features/takeoff/TakeoffComponents.jsx` | ~1350 | Modals, editors, bid summary |
| `src/features/takeoff/TakeoffWorkspace.jsx` | ~4140 | Canvas, drawing, measurements |
| `api/create-checkout.js` | 41 | Creates Stripe Checkout session |
| `api/create-portal.js` | 33 | Stripe billing portal |
| `api/webhooks/stripe.js` | 144 | Subscription lifecycle handler |
| `supabase/migrations/001_multi_tenant.sql` | 218 | Full database schema |
