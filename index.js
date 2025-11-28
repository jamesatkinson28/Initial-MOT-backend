import express from "express";
import axios from "axios";
import qs from "qs";

const app = express();
const PORT = process.env.PORT || 8080;

// =========================
//  TOKEN CACHE
// =========================
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    const now = Math.floor(Date.now() / 1000);

    // Return cached token if valid
    if (cachedToken && now < tokenExpiry - 60) {
        return cachedToken;
    }

    console.log("🔐 Fetching new Azure AD token...");

    const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

    const data = qs.stringify({
        grant_type: "client_credentials",
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        scope: "https://tapi.dvsa.gov.uk/.default"
    });

    const res = await axios.post(tokenUrl, data, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    });

    cachedToken = res.data.access_token;
    tokenExpiry = now + res.data.expires_in;

    console.log("🔐 New token fetched successfully");

    return cachedToken;
}

// =========================
//  MOT API ENDPOINT
// =========================
app.get("/mot", async (req, res) => {
    try {
        const vrm = req.query.vrm;
        if (!vrm) {
            return res.status(400).json({ error: "Missing vrm parameter" });
        }

        const token = await getToken();

        const motUrl = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${vrm}`;

        const response = await axios.get(motUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "X-API-Key": process.env.API_KEY
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
//  START SERVER
// =========================
app.listen(PORT, () => {
    console.log(`🚀 MOT Backend running on port ${PORT}`);
});
