require("dotenv").config();

const express = require("express");
const cors = require("cors");

const formsRouter = require("./routes/forms");
const adminRouter = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4000;

// --- CORS ---
// Two different policies for two different kinds of route:
//
// /api/forms/* — the public-facing form endpoints. Locked to
// ALLOWED_ORIGINS (the public website's own domain) since this is where
// spam/abuse protection actually matters: a stranger's website should not
// be able to submit forms through this backend on a visitor's behalf.
//
// /admin/* — already protected by the ADMIN_API_KEY header check in
// routes/admin.js, which is the real security boundary for this path, not
// the browser's origin. The admin dashboard may be hosted on a different
// domain than the public site (or opened as a local file, which sends no
// origin at all) — restricting it to ALLOWED_ORIGINS would make it
// unusable from anywhere except the exact public-site domain, for no
// actual security benefit, since the key check already gates access.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const publicCors = cors({
  origin(origin, callback) {
    // Allow requests with no origin (e.g. server-to-server, curl, Postman)
    // during setup/testing, but lock down browser requests to the allowlist.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
});

const adminCors = cors(); // reflects any origin; the admin key is the real gate

app.use(express.json({ limit: "100kb" })); // small limit — these are text forms, not file uploads

// --- Health check (useful for uptime monitoring and deployment platforms) ---
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "sweet-jesus-backend", time: new Date().toISOString() });
});

// --- Routes (each with its own CORS policy, see above) ---
app.use("/api/forms", publicCors, formsRouter);
app.use("/admin", adminCors, adminRouter);

// --- 404 fallback ---
app.use((req, res) => {
  res.status(404).json({ ok: false, errors: ["Not found."] });
});

// --- Error handler (catches CORS rejection and anything unhandled) ---
app.use((err, req, res, next) => {
  console.error("[server] Unhandled error:", err.message);
  res.status(err.message === "Not allowed by CORS" ? 403 : 500).json({
    ok: false,
    errors: [err.message === "Not allowed by CORS" ? "Origin not allowed." : "Something went wrong."],
  });
});

app.listen(PORT, () => {
  console.log(`Sweet Jesus backend listening on port ${PORT}`);
  if (allowedOrigins.length === 0) {
    console.warn("[server] Warning: ALLOWED_ORIGINS is empty — no browser origins will be permitted. Set it in .env.");
  }
});
