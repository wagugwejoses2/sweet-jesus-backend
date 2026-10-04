/**
 * Lightweight validation for form submissions. No external validation
 * library dependency — the rules here are simple enough to hand-roll and
 * keep dependency count low for a small backend like this.
 */

const MAX_FIELD_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value, maxLen = MAX_FIELD_LENGTH) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLen;
}

/**
 * Strips characters that have no legitimate place in a name/text field and
 * could indicate an injection attempt or bot payload (e.g. raw HTML tags).
 * This is a light defensive pass, not a substitute for output-escaping
 * wherever this data is later rendered (e.g. in an admin dashboard).
 */
function sanitize(value) {
  if (typeof value !== "string") return value;
  return value.replace(/<[^>]*>/g, "").trim();
}

/**
 * Builds an Express middleware that validates a submission body against a
 * schema describing which fields are required and their type.
 *
 * schema example:
 * {
 *   name: { required: true },
 *   email: { required: true, type: 'email' },
 *   message: { required: false, maxLength: 5000 },
 * }
 */
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    const cleaned = {};

    for (const [field, rules] of Object.entries(schema)) {
      const rawValue = req.body[field];

      if (rules.required && !isNonEmptyString(rawValue, rules.maxLength)) {
        errors.push(`${field} is required.`);
        continue;
      }

      if (rawValue === undefined || rawValue === null || rawValue === "") {
        continue; // optional and not provided
      }

      if (typeof rawValue !== "string") {
        errors.push(`${field} must be text.`);
        continue;
      }

      if (rawValue.length > (rules.maxLength || MAX_FIELD_LENGTH)) {
        errors.push(`${field} is too long.`);
        continue;
      }

      if (rules.type === "email" && !EMAIL_RE.test(rawValue.trim())) {
        errors.push(`${field} must be a valid email address.`);
        continue;
      }

      cleaned[field] = sanitize(rawValue);
    }

    // Honeypot field: a hidden input real users never fill in. If it has a
    // value, silently accept the request (so the bot thinks it worked) but
    // don't actually save or notify anyone.
    if (req.body.website) {
      req.isBot = true;
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    req.cleanedBody = cleaned;
    next();
  };
}

module.exports = { validateBody, MAX_MESSAGE_LENGTH, sanitize };
