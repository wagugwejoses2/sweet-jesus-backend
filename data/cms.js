/**
 * CMS data layer — CRUD for the content tables defined in schema.sql:
 * stories, resources, impact_metrics.
 *
 * This is deliberately separate from data/store.js (which only ever
 * appends form submissions) because CMS content needs real editing:
 * update and delete, not just insert and list. Both modules share the
 * same underlying Supabase client via store.getClient(), so there's only
 * one place connection setup lives.
 *
 * Every function here uses the service-role client, which bypasses Row
 * Level Security — that's correct and intentional, since these functions
 * are only ever called from admin routes already protected by
 * requireAdminKey (see routes/admin.js). Never expose these functions,
 * or the service-role key they rely on, directly to the browser.
 */

const { getClient } = require("./store");

function unwrap(result, action) {
  if (result.error) {
    throw new Error(`Supabase ${action} failed: ${result.error.message}`);
  }
  return result.data;
}

// ---------- Stories ----------

async function listStories() {
  const client = getClient();
  const result = await client.from("stories").select("*").order("created_at", { ascending: false });
  return unwrap(result, "stories list");
}

async function getStoryById(id) {
  const client = getClient();
  const result = await client.from("stories").select("*").eq("id", id).maybeSingle();
  return unwrap(result, "story fetch");
}

async function createStory(fields) {
  const client = getClient();
  const result = await client.from("stories").insert(fields).select().single();
  return unwrap(result, "story create");
}

async function updateStory(id, fields) {
  const client = getClient();
  const result = await client.from("stories").update(fields).eq("id", id).select().single();
  return unwrap(result, "story update");
}

async function deleteStory(id) {
  const client = getClient();
  const result = await client.from("stories").delete().eq("id", id);
  return unwrap(result, "story delete");
}

// ---------- Resources ----------

async function listResources() {
  const client = getClient();
  const result = await client.from("resources").select("*").order("created_at", { ascending: false });
  return unwrap(result, "resources list");
}

async function createResource(fields) {
  const client = getClient();
  const result = await client.from("resources").insert(fields).select().single();
  return unwrap(result, "resource create");
}

async function updateResource(id, fields) {
  const client = getClient();
  const result = await client.from("resources").update(fields).eq("id", id).select().single();
  return unwrap(result, "resource update");
}

async function deleteResource(id) {
  const client = getClient();
  const result = await client.from("resources").delete().eq("id", id);
  return unwrap(result, "resource delete");
}

// ---------- Impact metrics ----------
// These are never created or deleted through the admin UI — the four rows
// are seeded once by schema.sql and only ever updated (value, verified).
// Deliberately no createImpactMetric/deleteImpactMetric: the homepage's
// counters are wired to four specific metric_key values, so adding or
// removing rows here wouldn't do anything without a matching frontend
// change anyway.

async function listImpactMetrics() {
  const client = getClient();
  const result = await client.from("impact_metrics").select("*").order("metric_key");
  return unwrap(result, "impact metrics list");
}

async function updateImpactMetric(id, fields) {
  const client = getClient();
  const result = await client.from("impact_metrics").update(fields).eq("id", id).select().single();
  return unwrap(result, "impact metric update");
}

module.exports = {
  listStories, getStoryById, createStory, updateStory, deleteStory,
  listResources, createResource, updateResource, deleteResource,
  listImpactMetrics, updateImpactMetric,
};
