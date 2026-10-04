/**
 * Email notifications for form submissions.
 *
 * Designed to degrade gracefully: if SMTP credentials aren't set in .env,
 * this simply logs a warning and skips sending — the submission is still
 * saved to disk either way, so nothing is lost while email is being set up.
 */

const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // Not configured yet.
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return transporter;
}

/**
 * Send a plain-text notification email. Never throws — a failed email
 * should never fail the form submission itself, since the data is already
 * safely saved by the time this runs.
 */
async function notify({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[mailer] SMTP not configured — skipping email notification: "${subject}"`
    );
    return { sent: false, reason: "smtp_not_configured" };
  }

  try {
    await t.sendMail({
      from: process.env.FROM_EMAIL || "no-reply@sweetjesus.org",
      to,
      subject,
      text,
    });
    return { sent: true };
  } catch (err) {
    console.error("[mailer] Failed to send notification email:", err.message);
    return { sent: false, reason: "send_failed", error: err.message };
  }
}

module.exports = { notify };
