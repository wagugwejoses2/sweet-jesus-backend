const express = require("express");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const store = require("../data/store");
const { notify } = require("../data/mailer");
const { validateBody } = require("../middleware/validate");

const router = express.Router();

// Forms are a classic spam target. This limits each IP to a modest number of
// submissions per window across all form endpoints below.
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, errors: ["Too many submissions. Please try again later."] },
});
router.use(formLimiter);

/**
 * Shared submission handling: validate -> (bot check) -> save -> notify -> respond.
 * Each route below defines its own schema and email content, then delegates here.
 */
async function handleSubmission({ req, res, formType, notifyEmail, buildSubject, buildBody }) {
  if (req.isBot) {
    // Pretend success to the bot; don't save or notify.
    return res.status(200).json({ ok: true });
  }

  const record = {
    id: uuidv4(),
    formType,
    submittedAt: new Date().toISOString(),
    ...req.cleanedBody,
  };

  try {
    await store.save(formType, record);
  } catch (err) {
    console.error(`[forms] Failed to save ${formType} submission:`, err.message);
    return res.status(500).json({ ok: false, errors: ["Something went wrong saving your submission. Please try again."] });
  }

  // Email notification is best-effort — its failure doesn't fail the request,
  // since the submission is already safely stored.
  await notify({
    to: notifyEmail || process.env.NOTIFY_EMAIL,
    subject: buildSubject(record),
    text: buildBody(record),
  });

  return res.status(200).json({ ok: true, id: record.id });
}

// ---------- Contact form ----------
router.post(
  "/contact",
  validateBody({
    name: { required: true },
    email: { required: true, type: "email" },
    organisation: { required: false },
    phone: { required: false },
    topic: { required: false },
    message: { required: true, maxLength: 5000 },
  }),
  async (req, res) => {
    await handleSubmission({
      req,
      res,
      formType: "contact",
      buildSubject: (r) => `New contact enquiry from ${r.name}${r.topic ? ` — ${r.topic}` : ""}`,
      buildBody: (r) =>
        [
          `Name: ${r.name}`,
          `Email: ${r.email}`,
          r.organisation ? `Organisation: ${r.organisation}` : null,
          r.phone ? `Phone: ${r.phone}` : null,
          r.topic ? `Topic: ${r.topic}` : null,
          "",
          "Message:",
          r.message,
        ]
          .filter(Boolean)
          .join("\n"),
    });
  }
);

// ---------- Volunteer application ----------
router.post(
  "/volunteer",
  validateBody({
    name: { required: true },
    email: { required: true, type: "email" },
    phone: { required: false },
    location: { required: false },
    availability: { required: false },
    experience: { required: false, maxLength: 3000 },
  }),
  async (req, res) => {
    await handleSubmission({
      req,
      res,
      formType: "volunteer",
      buildSubject: (r) => `New volunteer application from ${r.name}`,
      buildBody: (r) =>
        [
          `Name: ${r.name}`,
          `Email: ${r.email}`,
          r.phone ? `Phone: ${r.phone}` : null,
          r.location ? `Location: ${r.location}` : null,
          r.availability ? `Availability: ${r.availability}` : null,
          r.experience ? `\nRelevant experience:\n${r.experience}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
    });
  }
);

// ---------- Church partnership enquiry ----------
router.post(
  "/church-partner",
  validateBody({
    churchName: { required: true },
    contactName: { required: true },
    email: { required: true, type: "email" },
    phone: { required: false },
    location: { required: false },
    congregationSize: { required: false },
    message: { required: false, maxLength: 3000 },
  }),
  async (req, res) => {
    await handleSubmission({
      req,
      res,
      formType: "church-partner",
      buildSubject: (r) => `New church partnership enquiry: ${r.churchName}`,
      buildBody: (r) =>
        [
          `Church: ${r.churchName}`,
          `Contact: ${r.contactName}`,
          `Email: ${r.email}`,
          r.phone ? `Phone: ${r.phone}` : null,
          r.location ? `Location: ${r.location}` : null,
          r.congregationSize ? `Approx. congregation size: ${r.congregationSize}` : null,
          r.message ? `\nMessage:\n${r.message}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
    });
  }
);

// ---------- Teacher Academy application ----------
router.post(
  "/teacher-academy",
  validateBody({
    name: { required: true },
    email: { required: true, type: "email" },
    phone: { required: false },
    church: { required: false },
    priorExperience: { required: false, maxLength: 3000 },
  }),
  async (req, res) => {
    await handleSubmission({
      req,
      res,
      formType: "teacher-academy",
      buildSubject: (r) => `New Teacher Academy application from ${r.name}`,
      buildBody: (r) =>
        [
          `Name: ${r.name}`,
          `Email: ${r.email}`,
          r.phone ? `Phone: ${r.phone}` : null,
          r.church ? `Church: ${r.church}` : null,
          r.priorExperience ? `\nPrior experience:\n${r.priorExperience}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
    });
  }
);

// ---------- Safeguarding concern ----------
// Deliberately separate from the general contact form: routed to a distinct,
// more tightly monitored email address, and never rate-limited alongside
// general spam-prone forms in a way that could delay an urgent report.
// (It still shares the same limiter above for basic abuse protection, but
// notifications go to SAFEGUARDING_EMAIL, not the general inbox.)
router.post(
  "/safeguarding-concern",
  validateBody({
    name: { required: false }, // reporter may wish to remain anonymous
    email: { required: false, type: "email" },
    phone: { required: false },
    relationship: { required: false }, // e.g. "parent", "volunteer", "member of the public"
    concern: { required: true, maxLength: 5000 },
  }),
  async (req, res) => {
    await handleSubmission({
      req,
      res,
      formType: "safeguarding-concern",
      notifyEmail: process.env.SAFEGUARDING_EMAIL,
      buildSubject: () => `New safeguarding concern reported`,
      buildBody: (r) =>
        [
          r.name ? `Reporter name: ${r.name}` : "Reporter name: (not provided)",
          r.email ? `Reporter email: ${r.email}` : "Reporter email: (not provided)",
          r.phone ? `Reporter phone: ${r.phone}` : null,
          r.relationship ? `Relationship to Sweet Jesus: ${r.relationship}` : null,
          "",
          "Concern:",
          r.concern,
        ]
          .filter(Boolean)
          .join("\n"),
    });
  }
);

module.exports = router;
