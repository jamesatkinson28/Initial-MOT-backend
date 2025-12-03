// index.js
import express from "express";
import axios from "axios";
import qs from "qs";
import cors from "cors";
import dotenv from "dotenv";

import { authRouter } from "./routes/auth.js";
import { specRouter } from "./routes/spec.js";
import { garageRouter } from "./routes/garage.js";

// ❌ IMPORTANT: this was causing the crash because `app` didn't exist yet
// app.use("/api", specRouter);

// Load .env if present (locally)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ───────────────────────────────────────────────
// MIDDLEWARE
// ───────────────────────────────────────────────
app.use(cors()); // for now allow all origins – you can lock this down later
app.use(express.json());

// Simple health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "GarageGPT MOT/Spec backend" });
});

// ───────────────────────────────────────────────
// AUTH, SPEC, GARAGE ROUTES
// ───────────────────────────────────────────────
app.use("/auth", authRouter);
app.use("/spec", specRouter);
app.use("/garage", garageRouter);

// ───────────────────────────────────────────────
// DVSA MOT API (your existing working endpoint)
// ───────────────────────────────────────────────

// TOKEN CACHE (1 hour)
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const now = Math.floor(Date.now() / 1000);

  // Reuse token if still valid
  if (cachedToken && now < tokenExpiry - 60) {
    return cachedToken;
  }

  // Fetch new token
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

  const data = qs.stringify({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://tapi.dvsa.gov.uk/.default",
  });

  const res = await axios.post(tokenUrl, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  cachedToken = res.data.access_token;
  tokenExpiry = now + res.data.expires_in;

  console.log("🔐 New token fetched");
  return cachedToken;
}

// VRM CACHE (5 minutes)
const vrmCache = {}; // vrmCache["X6ATK"] = { data, expires }
const CACHE_LIFETIME = 60 * 5; // 5 minutes

// MOT API ENDPOINT
app.get("/mot", async (req, res) => {
  try {
    const vrm = req.query.vrm;

    if (!vrm) {
      return res.status(400).json({ error: "Missing ?vrm=" });
    }

    const clean = String(vrm).trim().toUpperCase();
    const now = Math.floor(Date.now() / 1000);

    // Return cached result if exists AND not expired
    if (vrmCache[clean] && now < vrmCache[clean].expires) {
      console.log(`⚡ Cache hit for ${clean}`);
      return res.json(vrmCache[clean].data);
    }

    console.log(`🌐 Cache MISS for ${clean} — fetching from DVSA`);

    // Get token
    const token = await getToken();

    // Request DVSA MOT API
    const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(
      clean
    )}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Use DVSA key here. If you still use API_KEY, this will fallback to it.
        "X-API-Key": process.env.DVSA_API_KEY || process.env.API_KEY,
      },
    });

    // Store in cache
    vrmCache[clean] = {
      data: response.data,
      expires: now + CACHE_LIFETIME,
    };

    return res.json(response.data);
  } catch (err) {
    console.error("❌ MOT API ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch MOT data",
      details: err.response?.data || err.message,
    });
  }
});

// ───────────────────────────────────────────────
// START SERVER
// ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 MOT Backend + Auth/Spec running on port ${PORT}`);
});
