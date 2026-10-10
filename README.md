# Sweet Jesus — Backend

A small Node/Express API that handles the Sweet Jesus website's forms
(contact, volunteer, church partnership, Teacher Academy, safeguarding
concerns), backed by a Supabase (Postgres) database. The same database also
holds the CMS content — stories, resources, and impact numbers — which the
website's frontend reads directly.

## What this is (and isn't)

This is **forms + light CMS infrastructure** — not payment processing, not
a full admin web app. It:

- Validates and saves form submissions to Postgres (via Supabase)
- Sends an email notification per submission (once you configure SMTP)
- Blocks basic spam via a honeypot field and rate limiting
- Gives you a simple, key-protected way to view submissions
- Provides the database tables the website reads for Stories, Resources,
  and the homepage impact counters

It does **not** include user accounts or a web admin dashboard for editing
content — for now, you edit stories/resources/impact numbers directly in
Supabase's own dashboard (its built-in table editor works fine for this).
See "Growing this later" for what to add and when.

## One-time setup: Supabase

1. Go to [supabase.com](https://supabase.com), create a free account, and
   create a new project. Pick a region close to your users if given a
   choice (Europe is usually the closest option to Uganda on the free tier).
2. Once the project is ready, open the **SQL Editor** in the Supabase
   dashboard, paste in the entire contents of `schema.sql` from this folder,
   and run it. This creates all the tables (`submissions`, `stories`,
   `resources`, `impact_metrics`) with the right security policies already
   applied.
3. Go to **Settings → API** in the Supabase dashboard and copy three values:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role secret key** → this is `SUPABASE_SERVICE_ROLE_KEY`
     (this key bypasses all security rules — it belongs only in the
     backend's environment variables, never in frontend code)
   - **anon public key** → this is used by the *frontend* (see
     "Connecting the frontend" below), not the backend

## Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase setup
  above.
- `ALLOWED_ORIGINS` — your website's domain(s), e.g.
  `https://sweetjesus.org,https://www.sweetjesus.org`. Without this, no
  browser can call the API at all (intentional — this is what stops other
  websites from submitting forms through your backend).
- `SMTP_*` — your email provider's credentials, if you want email
  notifications. Leave blank to skip email for now; submissions are still
  saved either way.
- `ADMIN_API_KEY` — a long random string for viewing submissions. Generate
  one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Run it:

```bash
npm start
```

The API listens on the port set in `.env` (default `4000`).

## Deploying to Render

This project includes `render.yaml`, so Render can pick up the
configuration automatically:

1. Push this backend folder to a GitHub repository.
2. In the [Render dashboard](https://dashboard.render.com), choose
   **New → Blueprint**, and point it at your repository. Render will read
   `render.yaml` and set up the service.
3. Render will prompt you to fill in the environment variables marked
   `sync: false` in `render.yaml` — this is where you paste in your real
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, SMTP
   credentials, `ADMIN_API_KEY`, etc.
4. Deploy. Render gives you a URL like `https://sweet-jesus-backend.onrender.com`.

**Note on the free tier:** Render's free plan spins the service down after
15 minutes of no traffic, and the next request wakes it back up — which
takes roughly 30–50 seconds. For a low-traffic contact form this is a minor
tradeoff (occasionally the first submission of the day takes a bit longer
to confirm), not a functional problem. If that delay ever becomes
unacceptable, Render's paid tier removes it.

Once deployed, update the frontend's `SWEET_JESUS_API_BASE` (see below) to
point at your real Render URL instead of `localhost`.

## Connecting the frontend

**Forms** (contact, volunteer, church partner, Teacher Academy,
safeguarding) each post to `API_BASE + '/api/forms/<form-name>'`. The
contact page (`contact.html`) already does this — see the inline
`<script>` near the bottom of that page for the pattern to copy into the
other form pages once they get real `<form>` markup.

Set the deployed API's real address once, in `frontend/site-config.js`
(every page loads that file):

```js
window.SWEET_JESUS_API_BASE = 'https://sweet-jesus-backend.onrender.com';
```

Left unset, it defaults to `http://localhost:4000` — fine for local testing
only.

**CMS content** (Stories, Resources, homepage impact numbers) is read
directly from Supabase by the browser, using `cms-client.js` (in the
frontend folder) and the public **anon key** — not through this backend at
all, and not the service role key. Set both once, in
`frontend/site-config.js`:

```js
window.SWEET_JESUS_SUPABASE_URL = 'https://your-project.supabase.co';
window.SWEET_JESUS_SUPABASE_ANON_KEY = 'your-anon-public-key';
```

Left blank, pages fall back to whatever static placeholder content already
exists in the HTML — nothing breaks, it just won't reflect real content
until these are set.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Uptime check |
| POST | `/api/forms/contact` | General contact form |
| POST | `/api/forms/volunteer` | Volunteer application |
| POST | `/api/forms/church-partner` | Church partnership enquiry |
| POST | `/api/forms/teacher-academy` | Teacher Academy application |
| POST | `/api/forms/safeguarding-concern` | Safeguarding report (routes to `SAFEGUARDING_EMAIL`, not the general inbox) |
| GET | `/admin/submissions/:formType` | View saved submissions (requires `x-admin-key` header) |

## Viewing submissions

```bash
curl https://your-api-domain/admin/submissions/contact \
  -H "x-admin-key: your-admin-key-here"
```

Valid `formType` values: `contact`, `volunteer`, `church-partner`,
`teacher-academy`, `safeguarding-concern`.

You can also browse `submissions`, `stories`, `resources`, and
`impact_metrics` directly in Supabase's own **Table Editor** — useful for
quickly checking data without writing a curl command.

## Admin dashboard

A small admin dashboard lives in `admin/` — open `admin/index.html` in a
browser (locally, or host the `admin/` folder anywhere; it's a static page
with no build step). It covers:

- **Stories** — create, edit, delete, publish. The "Consent confirmed"
  checkbox is enforced server-side: a story cannot be published unless
  consent is confirmed, whether you try to publish it on creation or by
  editing an existing draft later — the backend checks the story's actual
  stored consent value either way, not just what's in the current request.
- **Resources** — create, edit, delete, publish, with the category
  dropdown and file URL validation (must be `http://`/`https://`) matching
  what `schema.sql` allows.
- **Impact numbers** — update the value and verified status of the four
  homepage metrics. Update-only by design (see `data/cms.js`) — the four
  rows are fixed because the homepage's counters are wired to those four
  specific `metric_key` values.
- **Form submissions** — a UI wrapper around the existing
  `/admin/submissions/:formType` endpoint.

**Logging in:** enter your deployed backend's URL and your `ADMIN_API_KEY`.
Neither is saved anywhere (not localStorage, not cookies) — this is
deliberate, so a shared or public computer never ends up with an admin key
sitting in browser storage. You'll need to re-enter both each time you open
the dashboard.

**Where to host it:** anywhere that serves static files — it doesn't need
to live on the same domain as the backend or the public website. The
backend's CORS policy allows the `/admin/*` API from any origin, since the
`ADMIN_API_KEY` check (not the browser's origin) is what actually protects
those routes.

## Editing CMS content without the dashboard

The dashboard above is the easiest way to manage content, but you can also
edit content directly in Supabase's Table Editor (Dashboard → Table
Editor) if you ever need to:

- **stories** — add a row, fill in `slug`, `tag`, `title`, `summary`,
  `body`; set `consent_confirmed = true` only once you've actually
  confirmed consent for that story; set `published = true` when ready to
  go live. The `slug` becomes the URL: the website links to a story as
  `story-detail.html?slug=your-slug-here`, so keep slugs URL-safe
  (lowercase, hyphens, no spaces) — e.g. `marys-story`, not `Mary's Story!`.
  `body` is rendered as plain paragraphs (split on blank lines) — it does
  not support markdown or HTML formatting yet.
- **resources** — add a row with `title`, `category` (must be one of the
  five allowed values — see `schema.sql`), `format`, optionally
  `age_range` and `file_url`; set `published = true` to show it. `file_url`
  is rendered directly as a link on the public site — always use a real
  `http://` or `https://` link, never a `javascript:` URI.
- **impact_metrics** — four rows already exist (seeded by `schema.sql`).
  Update `value` with real confirmed numbers, and set `verified = true`
  only once the number is actually confirmed through your monitoring
  process — the homepage will keep showing the placeholder figure for any
  metric where `verified` is still `false`.

**Note on the frontend fallback:** the Stories, Resources, and story detail
pages all ship with static placeholder content already in their HTML. If
Supabase isn't configured, or a fetch fails, or zero rows come back, the
page quietly keeps showing that placeholder content rather than breaking
or showing an empty page. Once you publish real rows, they replace the
placeholders automatically — nothing else needs to change on the frontend.

## Growing this later

- **Real admin UI** — a simple authenticated dashboard for editing stories/
  resources/impact numbers without touching Supabase's table editor
  directly. Worth building once non-technical staff need to publish
  content regularly.
- **Real admin accounts for form submissions** — the current single shared
  API key is fine for one or two trusted people. Replace it with proper
  login/roles once more people need access.
- **File attachments** — if a form later needs uploads (e.g. a CV for a
  Teacher Academy application), that needs separate handling (size limits,
  virus scanning, storage) not present here. Supabase Storage is a natural
  fit if you go this route, since it's already part of the same platform.
- **Payments/donations** — entirely separate from this backend. Needs a
  payment processor (Stripe, Flutterwave, Paystack are all viable for
  Uganda) integrated with its own careful handling of compliance and
  security — don't bolt this onto the forms API.

## Safeguarding note

The safeguarding concern form routes to a **separate** email address
(`SAFEGUARDING_EMAIL`) from general enquiries, and its submissions are
tagged with a distinct `form_type` in the database rather than mixed in
with other forms. Whoever monitors that inbox should check it promptly and
reliably — this backend doesn't add any additional urgency handling (like
SMS alerts) beyond email. Consider adding that if safeguarding response
time is critical.

Separately: the `stories` table has a `consent_confirmed` column as a
deliberate safeguard against publishing a child's story before consent is
actually confirmed. This is a data field, not an enforced technical
control — it relies on whoever adds a story actually checking it honestly.
Treat it as a reminder, not a guarantee.
