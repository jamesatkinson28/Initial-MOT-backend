import express from "express";
import axios from "axios";
import qs from "qs";

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// TOKEN CACHE
// =========================
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    const now = Math.floor(Date.now() / 1000);

    // Reuse token if not expired
    if (cachedToken && now < tokenExpiry - 60) {
        return cachedToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

    const data = qs.stringify({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "https://tapi.dvsa.gov.uk/.default"   // 🔥 DVSA CORRECT SCOPE
    });

    const response = await axios.post(tokenUrl, data, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    cachedToken = response.data.access_token;
    tokenExpiry = now + response.data.expires_in;

    console.log("🔐 New token fetched from DVSA / Azure");
    return cachedToken;
}

// =========================
// MOT API ENDPOINT
// =========================
app.get("/mot", async (req, res) => {
    try {
        const vrm = req.query.vrm;
        if (!vrm) {
            return res.status(400).json({ error: "Missing vrm query parameter" });
        }

        const token = await getToken();

        const motUrl =
            `https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?registration=${vrm}`;

        const response = await axios.get(motUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                "x-api-key": process.env.API_KEY
            }
        });

        res.json(response.data);

    } catch (err) {
        console.error("❌ MOT API error:", err.response?.data || err.message);
        res.status(500).json({
            error: "Failed to fetch MOT data",
            details: err.response?.data || err.message
        });
    }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
    console.log(`🚀 MOT Backend running on port ${PORT}`);
});
