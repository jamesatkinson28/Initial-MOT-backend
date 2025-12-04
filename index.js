import express from "express";
import axios from "axios";
import qs from "qs";

import authRouter from "./routes/auth.js";

app.use("/api/auth", authRouter);

import { query } from "./db/db.js";

app.get("/test-db", async (req, res) => {
  try {
    const result = await query("SELECT NOW()");
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error("DB TEST ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


const app = express();
const PORT = process.env.PORT || 3000;

// =============================
//   TOKEN CACHE (1 hour)
// =============================
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
        scope: "https://tapi.dvsa.gov.uk/.default"
    });

    const res = await axios.post(tokenUrl, data, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    cachedToken = res.data.access_token;
    tokenExpiry = now + res.data.expires_in;

    console.log("🔐 New token fetched");
    return cachedToken;
}

// =============================
//   VRM CACHE (5 minutes)
// =============================
const vrmCache = {};  
// Format: vrmCache["X6ATK"] = { data: {...}, expires: timestamp }

const CACHE_LIFETIME = 60 * 5; // 5 minutes

// =============================
//   MOT API ENDPOINT
// =============================
app.get("/mot", async (req, res) => {
    try {
        const vrm = req.query.vrm;

        if (!vrm) {
            return res.status(400).json({ error: "Missing ?vrm=" });
        }

        const now = Math.floor(Date.now() / 1000);

        // 1️⃣ Return cached result if exists AND not expired
        if (vrmCache[vrm] && now < vrmCache[vrm].expires) {
            console.log(`⚡ Cache hit for ${vrm}`);
            return res.json(vrmCache[vrm].data);
        }

        console.log(`🌐 Cache MISS for ${vrm} — fetching from DVSA`);

        // 2️⃣ Get token
        const token = await getToken();

        // 3️⃣ Request DVSA MOT API
        const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(vrm)}`;

        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-API-Key": process.env.API_KEY
            }
        });

        // 4️⃣ Store in cache
        vrmCache[vrm] = {
            data: response.data,
            expires: now + CACHE_LIFETIME
        };

        return res.json(response.data);

    } catch (err) {
        console.error("❌ MOT API ERROR:", err.response?.data || err.message);
        res.status(500).json({
            error: "Failed to fetch MOT data",
            details: err.response?.data || err.message
        });
    }
});

// =============================
//   START SERVER
// =============================
app.listen(PORT, () => {
    console.log(`🚀 MOT Backend running on port ${PORT}`);
});
