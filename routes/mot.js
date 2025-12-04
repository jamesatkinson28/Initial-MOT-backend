import express from "express";
import axios from "axios";
import qs from "qs";

const motRouter = express.Router();

// TOKEN CACHE
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const now = Math.floor(Date.now() / 1000);

  // Reuse cached token if still valid
  if (cachedToken && now < tokenExpiry - 60) {
    return cachedToken;
  }

  // CORRECT DVSA TOKEN URL (v2.0)
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

  return cachedToken;
}

// CACHE FOR VRM LOOKUPS
const vrmCache = {};
const CACHE_LIFETIME = 60 * 5;

// /mot?vrm=ABC123
motRouter.get("/", async (req, res) => {
  try {
    const vrm = req.query.vrm;

    if (!vrm) {
      return res.status(400).json({ error: "Missing ?vrm=" });
    }

    const now = Math.floor(Date.now() / 1000);

    // Cached?
    if (vrmCache[vrm] && now < vrmCache[vrm].expires) {
      return res.json(vrmCache[vrm].data);
    }

    const token = await getToken();
    const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(vrm)}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Key": process.env.API_KEY
      }
    });

    // Store cache
    vrmCache[vrm] = {
      data: response.data,
      expires: now + CACHE_LIFETIME
    };

    return res.json(response.data);

  } catch (err) {
    console.error("❌ MOT API ERROR:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Failed to fetch MOT data",
      details: err.response?.data || err.message
    });
  }
});

export default motRouter;
