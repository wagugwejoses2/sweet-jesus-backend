-- Sweet Jesus — Database schema
-- Run this in Supabase's SQL Editor (Dashboard → SQL Editor → New query) once,
-- after creating your Supabase project.

-- ============================================================
-- FORM SUBMISSIONS
-- Replaces the old file-based JSON storage. One table, a `form_type` column
-- distinguishes contact / volunteer / church-partner / teacher-academy /
-- safeguarding-concern — simpler than five separate tables, and easy enough
-- to filter by type in queries.
-- ============================================================

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  form_type text not null check (form_type in (
    'contact', 'volunteer', 'church-partner', 'teacher-academy', 'safeguarding-concern'
  )),
  data jsonb not null,           -- the validated form fields, as submitted
  submitted_at timestamptz not null default now()
);

create index if not exists idx_submissions_form_type on submissions (form_type);
create index if not exists idx_submissions_submitted_at on submissions (submitted_at desc);

-- Row Level Security: the backend connects with the service role key (which
-- bypasses RLS entirely), so these policies matter only if you ever expose
-- this table to a client using the public/anon key. Enabling RLS with no
-- policies is a safe default — it means "no public access unless explicitly
-- granted," which is exactly right for form submissions (they should only
-- ever be read via the backend's admin-key-protected endpoint).
alter table submissions enable row level security;


-- ============================================================
-- CMS: STORIES
-- Powers the Stories index page and the story-detail article template.
-- ============================================================

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,              -- used in the URL, e.g. /story/ruths-story
  tag text not null,                       -- e.g. "Child's story", "Teacher's story"
  title text not null,
  summary text,                            -- short teaser shown on the Stories index
  body text not null,                      -- full article content (markdown or plain text)
  consent_confirmed boolean not null default false, -- safeguarding: must be true before publish
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stories_published on stories (published, published_at desc);
create index if not exists idx_stories_slug on stories (slug);

alter table stories enable row level security;

-- Public (anon key) can read only published stories — this is the one table
-- where public read access make sense, since stories are meant to be shown
-- on the live site. Nothing is writable by the public.
create policy "Public can read published stories"
  on stories for select
  using (published = true);


-- ============================================================
-- CMS: RESOURCES
-- Powers the Resources hub page.
-- ============================================================

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in (
    'Curriculum', 'Teacher resources', 'Parent resources', 'Safeguarding', 'Research & learning'
  )),
  format text not null,                    -- e.g. "PDF", "Video", "Podcast"
  age_range text,                          -- e.g. "Ages 2-3", null if not age-specific
  file_url text,                           -- link to the actual downloadable/viewable file (http(s):// only — never enter a javascript: URI here, since this value is rendered directly as a link href on the public site)
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_resources_category on resources (category);
create index if not exists idx_resources_published on resources (published);

alter table resources enable row level security;

create policy "Public can read published resources"
  on resources for select
  using (published = true);


-- ============================================================
-- CMS: IMPACT NUMBERS
-- Powers the homepage impact counters. A single row per metric, so the
-- number can be updated without touching code or redeploying anything.
-- ============================================================

create table if not exists impact_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,         -- e.g. "children_reached", "teachers_trained"
  label text not null,                     -- e.g. "Children reached"
  value integer not null default 0,
  verified boolean not null default false, -- true once confirmed by the monitoring system
  updated_at timestamptz not null default now()
);

alter table impact_metrics enable row level security;

create policy "Public can read verified impact metrics"
  on impact_metrics for select
  using (verified = true);

-- Seed the four metrics currently shown on the homepage, unverified (value 0)
-- until real figures are confirmed. The site should keep showing "—"
-- placeholders for any metric where verified = false.
insert into impact_metrics (metric_key, label, value, verified) values
  ('children_reached', 'Children reached', 0, false),
  ('teachers_trained', 'Teachers trained', 0, false),
  ('church_partners', 'Church partners', 0, false),
  ('communities_reached', 'Communities reached', 0, false)
on conflict (metric_key) do nothing;


-- ============================================================
-- updated_at auto-touch trigger (applies to stories, resources, impact_metrics)
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_stories_updated_at
  before update on stories
  for each row execute function set_updated_at();

create trigger trg_resources_updated_at
  before update on resources
  for each row execute function set_updated_at();

create trigger trg_impact_metrics_updated_at
  before update on impact_metrics
  for each row execute function set_updated_at();
