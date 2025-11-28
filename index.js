import express from "express";
import axios from "axios";
import qs from "qs";

const app = express();
const PORT = process.env.PORT || 8080;

// ================================
// TOKEN CACHE
// ================================
let cachedToken = null;
let tokenExpiry = 0; // unix timestamp

async function getToken() {
    const now = Math.floor(Date.now() / 1000);

    // If token exists + not expired → use it
    if (cachedToken && now < tokenExpiry - 60) {
        return cachedToken;
    }

    console.log("🔐 Fetching NEW token from Azure AD...");

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
    tokenExpiry = now + res.data.expires_in; // usually 3600 seconds

    console.log("✅ Token cached for 60 minutes.");

    return cachedToken;
}

// ================================
// MOT RESULT CACHE (optional)
// ================================
// VRM → Cached API response
const motCache = new Map();
const MOT_CACHE_SECONDS = 600; // cache vehicle lookup for 10 min (adjust if you want)

function getCachedMot(vrm) {
    const entry = motCache.get(vrm);
    if (!entry) return null;

    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > MOT_CACHE_SECONDS) {
        motCache.delete(vrm);
        return null;
    }

    return entry.data;
}

function setCachedMot(vrm, data) {
    motCache.set(vrm, {
        data,
        timestamp: Date.now()
    });
}

// ================================
// MAIN API ENDPOINT
// ================================
app.get("/mot", async (req, res) => {
    try {
        const vrm = req.query.vrm;
        if (!vrm) return res.status(400).json({ error: "Missing vrm" });

        // CHECK MOT CACHE FIRST
        const cached = getCachedMot(vrm);
        if (cached) {
            return res.json({
                cached: true,
                ...cached
            });
        }

        const token = await getToken();

        const response = await axios.get(
            `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${vrm}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "X-API-Key": process.env.API_KEY
                }
            }
        );

        // SAVE TO CACHE
        setCachedMot(vrm, response.data);

        res.json({
            cached: false,
            ...response.data
        });

    } catch (err) {
        console.error("❌ MOT API error:", err.response?.data || err.message);
        res.status(500).json({
            error: "Failed to fetch MOT data",
            details: err.response?.data || err.message
        });
    }
});

// ================================
// START SERVER
// ================================
app.listen(PORT, () => {
    console.log(`🚀 MOT Backend running on port ${PORT}`);
});
