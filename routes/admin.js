/**
 * Minimal admin endpoint for viewing form submissions.
 *
 * This is intentionally basic — a single shared API key, not a full user
 * login system. That's a reasonable trade-off for a small team checking
 * submissions occasionally, but it is NOT sufficient once:
 *   - more than a couple of trusted people need access, or
 *   - submissions include anything more sensitive than what's collected here.
 * At that point, replace this with real authenticated user accounts.
 */

const express = require("express");
const store = require("../data/store");
const cms = require("../data/cms");

const router = express.Router();

const ALLOWED_FORM_TYPES = [
  "contact",
  "volunteer",
  "church-partner",
  "teacher-academy",
  "safeguarding-concern",
];

const ALLOWED_RESOURCE_CATEGORIES = [
  "Curriculum",
  "Teacher resources",
  "Parent resources",
  "Safeguarding",
  "Research & learning",
];

function requireAdminKey(req, res, next) {
  const providedKey = req.header("x-admin-key");
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey) {
    return res.status(503).json({
      ok: false,
      errors: ["Admin access is not configured yet. Set ADMIN_API_KEY in .env."],
    });
  }

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ ok: false, errors: ["Unauthorized."] });
  }

  next();
}

router.use(requireAdminKey);

// GET /admin/submissions/:formType
router.get("/submissions/:formType", async (req, res) => {
  const { formType } = req.params;

  if (!ALLOWED_FORM_TYPES.includes(formType)) {
    return res.status(400).json({
      ok: false,
      errors: [`Unknown form type. Expected one of: ${ALLOWED_FORM_TYPES.join(", ")}`],
    });
  }

  try {
    const submissions = await store.list(formType);
    res.json({ ok: true, count: submissions.length, submissions });
  } catch (err) {
    console.error("[admin] Failed to list submissions:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to retrieve submissions."] });
  }
});

// ==========================================================
// CMS: Stories
// ==========================================================

function validateStoryFields(body, { partial = false } = {}) {
  const errors = [];
  const fields = {};

  const requiredIfNotPartial = (key) => !partial && (body[key] === undefined || body[key] === null || body[key] === "");

  if (requiredIfNotPartial("slug")) errors.push("slug is required.");
  if (body.slug !== undefined) {
    if (typeof body.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
      errors.push("slug must be lowercase letters, numbers and hyphens only (e.g. marys-story).");
    } else {
      fields.slug = body.slug;
    }
  }

  if (requiredIfNotPartial("tag")) errors.push("tag is required.");
  if (body.tag !== undefined) {
    if (typeof body.tag !== "string" || !body.tag.trim()) errors.push("tag must be text.");
    else fields.tag = body.tag.trim();
  }

  if (requiredIfNotPartial("title")) errors.push("title is required.");
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) errors.push("title must be text.");
    else fields.title = body.title.trim();
  }

  if (body.summary !== undefined) fields.summary = typeof body.summary === "string" ? body.summary.trim() : null;

  if (requiredIfNotPartial("body")) errors.push("body is required.");
  if (body.body !== undefined) {
    if (typeof body.body !== "string" || !body.body.trim()) errors.push("body must be text.");
    else fields.body = body.body;
  }

  if (body.consent_confirmed !== undefined) {
    if (typeof body.consent_confirmed !== "boolean") errors.push("consent_confirmed must be true or false.");
    else fields.consent_confirmed = body.consent_confirmed;
  }

  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") errors.push("published must be true or false.");
    else fields.published = body.published;
  }

  // NOTE: the consent-vs-publish guardrail is NOT fully enforced here.
  // This function only sees the current request body, not the story's
  // existing row — so it can correctly catch `{published:true,
  // consent_confirmed:false}` in the same request, but it CANNOT catch
  // `{published:true}` sent alone against a row whose stored
  // consent_confirmed is still false, since that requires a database read.
  // That case is handled by the caller (see the PATCH /stories/:id route),
  // which fetches the current row first. The POST /stories route doesn't
  // have this gap, since there's no "existing row" for a create — every
  // field not sent defaults safely via validateStoryFields' own defaults.
  if (body.published === true && body.consent_confirmed === false) {
    errors.push("Cannot publish a story while consent_confirmed is false.");
  }

  return { errors, fields };
}

router.get("/stories", async (req, res) => {
  try {
    const stories = await cms.listStories();
    res.json({ ok: true, count: stories.length, stories });
  } catch (err) {
    console.error("[admin] Failed to list stories:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to retrieve stories."] });
  }
});

router.post("/stories", async (req, res) => {
  const { errors, fields } = validateStoryFields(req.body, { partial: false });
  if (errors.length) return res.status(400).json({ ok: false, errors });

  // Publishing on create must still pass the same consent check even
  // though consent_confirmed may not have been explicitly sent — default
  // it to false unless the caller set it true, so a bare {published:true}
  // POST can never slip through.
  if (fields.published === true && fields.consent_confirmed !== true) {
    return res.status(400).json({ ok: false, errors: ["Cannot publish a story while consent_confirmed is false."] });
  }

  try {
    const story = await cms.createStory(fields);
    res.status(201).json({ ok: true, story });
  } catch (err) {
    console.error("[admin] Failed to create story:", err.message);
    const isConflict = /duplicate key|unique constraint/i.test(err.message);
    res.status(isConflict ? 409 : 500).json({
      ok: false,
      errors: [isConflict ? "A story with that slug already exists." : "Failed to create story."],
    });
  }
});

router.patch("/stories/:id", async (req, res) => {
  const { errors, fields } = validateStoryFields(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ ok: false, errors });
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ ok: false, errors: ["No valid fields provided to update."] });
  }

  try {
    // Safeguarding guardrail, continued: if this update would set
    // published=true but doesn't also set consent_confirmed=true in the
    // same request, we must check the story's EXISTING stored value —
    // otherwise {published:true} alone could silently publish a story
    // whose consent was never confirmed. validateStoryFields can't catch
    // this on its own since it never sees the current row.
    if (fields.published === true && fields.consent_confirmed !== true) {
      const existing = await cms.getStoryById(req.params.id);
      if (!existing) {
        return res.status(404).json({ ok: false, errors: ["Story not found."] });
      }
      const willBeConfirmed = fields.consent_confirmed !== undefined ? fields.consent_confirmed : existing.consent_confirmed;
      if (willBeConfirmed !== true) {
        return res.status(400).json({ ok: false, errors: ["Cannot publish a story while consent_confirmed is false."] });
      }
    }

    const story = await cms.updateStory(req.params.id, fields);
    res.json({ ok: true, story });
  } catch (err) {
    console.error("[admin] Failed to update story:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to update story."] });
  }
});

router.delete("/stories/:id", async (req, res) => {
  try {
    await cms.deleteStory(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] Failed to delete story:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to delete story."] });
  }
});

// ==========================================================
// CMS: Resources
// ==========================================================

function validateResourceFields(body, { partial = false } = {}) {
  const errors = [];
  const fields = {};

  const requiredIfNotPartial = (key) => !partial && (body[key] === undefined || body[key] === null || body[key] === "");

  if (requiredIfNotPartial("title")) errors.push("title is required.");
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) errors.push("title must be text.");
    else fields.title = body.title.trim();
  }

  if (requiredIfNotPartial("category")) errors.push("category is required.");
  if (body.category !== undefined) {
    if (!ALLOWED_RESOURCE_CATEGORIES.includes(body.category)) {
      errors.push(`category must be one of: ${ALLOWED_RESOURCE_CATEGORIES.join(", ")}`);
    } else {
      fields.category = body.category;
    }
  }

  if (requiredIfNotPartial("format")) errors.push("format is required.");
  if (body.format !== undefined) {
    if (typeof body.format !== "string" || !body.format.trim()) errors.push("format must be text.");
    else fields.format = body.format.trim();
  }

  if (body.age_range !== undefined) fields.age_range = typeof body.age_range === "string" ? body.age_range.trim() : null;

  if (body.file_url !== undefined) {
    if (body.file_url && !/^https?:\/\//i.test(body.file_url)) {
      errors.push("file_url must start with http:// or https:// (never javascript: or another scheme).");
    } else {
      fields.file_url = body.file_url || null;
    }
  }

  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") errors.push("published must be true or false.");
    else fields.published = body.published;
  }

  return { errors, fields };
}

router.get("/resources", async (req, res) => {
  try {
    const resources = await cms.listResources();
    res.json({ ok: true, count: resources.length, resources });
  } catch (err) {
    console.error("[admin] Failed to list resources:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to retrieve resources."] });
  }
});

router.post("/resources", async (req, res) => {
  const { errors, fields } = validateResourceFields(req.body, { partial: false });
  if (errors.length) return res.status(400).json({ ok: false, errors });

  try {
    const resource = await cms.createResource(fields);
    res.status(201).json({ ok: true, resource });
  } catch (err) {
    console.error("[admin] Failed to create resource:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to create resource."] });
  }
});

router.patch("/resources/:id", async (req, res) => {
  const { errors, fields } = validateResourceFields(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ ok: false, errors });
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ ok: false, errors: ["No valid fields provided to update."] });
  }

  try {
    const resource = await cms.updateResource(req.params.id, fields);
    res.json({ ok: true, resource });
  } catch (err) {
    console.error("[admin] Failed to update resource:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to update resource."] });
  }
});

router.delete("/resources/:id", async (req, res) => {
  try {
    await cms.deleteResource(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] Failed to delete resource:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to delete resource."] });
  }
});

// ==========================================================
// CMS: Impact metrics
// ==========================================================
// Update-only — see data/cms.js for why create/delete aren't exposed.

router.get("/impact-metrics", async (req, res) => {
  try {
    const metrics = await cms.listImpactMetrics();
    res.json({ ok: true, metrics });
  } catch (err) {
    console.error("[admin] Failed to list impact metrics:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to retrieve impact metrics."] });
  }
});

router.patch("/impact-metrics/:id", async (req, res) => {
  const fields = {};
  const errors = [];

  if (req.body.value !== undefined) {
    const n = Number(req.body.value);
    if (!Number.isInteger(n) || n < 0) errors.push("value must be a non-negative whole number.");
    else fields.value = n;
  }
  if (req.body.verified !== undefined) {
    if (typeof req.body.verified !== "boolean") errors.push("verified must be true or false.");
    else fields.verified = req.body.verified;
  }
  if (errors.length) return res.status(400).json({ ok: false, errors });
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ ok: false, errors: ["No valid fields provided to update."] });
  }

  try {
    const metric = await cms.updateImpactMetric(req.params.id, fields);
    res.json({ ok: true, metric });
  } catch (err) {
    console.error("[admin] Failed to update impact metric:", err.message);
    res.status(500).json({ ok: false, errors: ["Failed to update impact metric."] });
  }
});

module.exports = router;
