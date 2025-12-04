import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// =====================================================
//   IMPORT ROUTERS
// =====================================================
import authRouter from "./routes/auth.js";
import garageRouter from "./routes/garage.js";
import specRouter from "./routes/spec.js";

// =====================================================
//   MOUNT ROUTES
// =====================================================
app.use("/api/auth", authRouter);
app.use("/api/garage", garageRouter);
app.use("/api", specRouter);

// =====================================================
//   MOT ENDPOINT (FULL WORKING VERSION)
// =====================================================

import axios from "axios";
import qs from "qs";

// TOKEN CACHE
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    const now = Math.floor(Date.now() / 1000);

    if (cachedToken && now < tokenExpiry - 60) {
        return cachedToken;
    }

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

    console.log("🔐 New DVSA token fetched");

    return cachedToken;
}

const vrmCache = {};
const CACHE_LIFETIME = 60 * 5;

// MAIN MOT ROUTE — EXACTLY LIKE THE WORKING VERSION
app.get("/mot", async (req, res) => {
    try {
        const vrm = req.query.vrm;

        if (!vrm) {
            return res.status(400).json({ error: "Missing ?vrm=" });
        }

        const now = Math.floor(Date.now() / 1000);

        if (vrmCache[vrm] && now < vrmCache[vrm].expires) {
            console.log(`⚡ Cache hit for ${vrm}`);
            return res.json(vrmCache[vrm].data);
        }

        console.log(`🌐 Cache MISS for ${vrm}`);

        const token = await getToken();

        const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(
            vrm
        )}`;

        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                "X-API-Key": process.env.API_KEY
            }
        });

        vrmCache[vrm] = {
            data: response.data,
            expires: now + CACHE_LIFETIME
        };

        return res.json(response.data);

    } catch (err) {
        console.error("❌ MOT ERROR:", err.response?.data || err.message);
        return res.status(500).json({
            error: "Failed to fetch MOT data",
            details: err.response?.data || err.message
        });
    }
});

// =====================================================
//   ROOT
// =====================================================
app.get("/", (req, res) => {
    res.send("GarageGPT Backend Running");
});

// =====================================================
//   START SERVER
// =====================================================
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
});
