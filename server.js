require("dotenv").config();

const express = require("express");
const cors = require("cors");

const formsRouter = require("./routes/forms");
const adminRouter = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4000;

// --- CORS: only allow the website's own origin(s), not the whole internet ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (e.g. server-to-server, curl, Postman)
      // during setup/testing, but lock down browser requests to the allowlist.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json({ limit: "100kb" })); // small limit — these are text forms, not file uploads

// --- Health check (useful for uptime monitoring and deployment platforms) ---
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "sweet-jesus-backend", time: new Date().toISOString() });
});

// --- Routes ---
app.use("/api/forms", formsRouter);
app.use("/admin", adminRouter);

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
