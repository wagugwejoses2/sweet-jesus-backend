/**
 * Storage layer for form submissions — backed by Supabase (Postgres).
 *
 * This replaces the original file-based JSON storage. The interface is
 * unchanged (`save(formType, record)` and `list(formType)`), which is why
 * swapping the implementation didn't require touching form-handling logic
 * in routes/forms.js — only routes/admin.js needed a one-line change to
 * await list(), since it's now a network call instead of a local file read.
 *
 * We use the Supabase JS client with a project URL + service role key
 * rather than a raw Postgres connection string, since that's simpler to
 * set up and matches Supabase's own recommended pattern for server-side
 * backends. See .env.example for the two variables needed: SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY.
 *
 * IMPORTANT: the service role key bypasses Row Level Security entirely.
 * Never expose it to the frontend/browser — it belongs only in this
 * backend's environment variables.
 */

const { createClient } = require("@supabase/supabase-js");

let supabase = null;

function getClient() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env — see README.md for setup."
    );
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false }, // server-side, no browser session to persist
  });

  return supabase;
}

/**
 * Save a submission. `record` is the full object routes/forms.js builds
 * (id, formType, submittedAt, plus the validated form fields) — we store
 * the form-specific fields in a single `data` jsonb column, keeping the
 * schema simple and not requiring a migration every time a form gains a
 * new field.
 */
async function save(formType, record) {
  const client = getClient();

  const { id, formType: _ignored, submittedAt, ...fields } = record;

  const { error } = await client.from("submissions").insert({
    id,
    form_type: formType,
    data: fields,
    submitted_at: submittedAt,
  });

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return record;
}

/**
 * List all submissions of a given type, most recent first.
 */
async function list(formType) {
  const client = getClient();

  const { data, error } = await client
    .from("submissions")
    .select("id, form_type, data, submitted_at")
    .eq("form_type", formType)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  // Flatten back to the same shape the old file-based store returned, so
  // nothing downstream (the admin JSON response) needs to change either.
  return data.map((row) => ({
    id: row.id,
    formType: row.form_type,
    submittedAt: row.submitted_at,
    ...row.data,
  }));
}

module.exports = { save, list };
