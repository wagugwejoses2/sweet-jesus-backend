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

const router = express.Router();

const ALLOWED_FORM_TYPES = [
  "contact",
  "volunteer",
  "church-partner",
  "teacher-academy",
  "safeguarding-concern",
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

module.exports = router;
