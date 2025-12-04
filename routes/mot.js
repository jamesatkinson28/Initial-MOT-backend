import express from "express";
import axios from "axios";
import qs from "qs";

const motRouter = express.Router();

// TOKEN CACHE
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && now < tokenExpiry - 60) {
    return cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/token`;

  const data = qs.stringify({
    grant_type: "client_credentials",
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    resource: "https://tapi.dvsa.gov.uk/"
  });

  let response;
  try {
    response = await axios.post(tokenUrl, data, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 8000,
    });
  } catch (err) {
    console.error("TOKEN ERROR:", err.response?.data || err.message);
    throw new Error("Token request failed");
  }

  cachedToken = response.data.access_token;
  tokenExpiry = now + response.data.expires_in;

  return cachedToken;
}

// VRM CACHE
const vrmCache = {};
const CACHE_LIFETIME = 60 * 5;

// MAIN ROUTE
motRouter.get("/", async (req, res) => {
  try {
    const vrm = req.query.vrm;
    if (!vrm) return res.status(400).json({ error: "Missing ?vrm=" });

    const now = Math.floor(Date.now() / 1000);

    if (vrmCache[vrm] && now < vrmCache[vrm].expires) {
      return res.json(vrmCache[vrm].data);
    }

    const token = await getToken();

    const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(vrm)}`;

    const result = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Key": process.env.API_KEY,
      },
      timeout: 8000,
    });

    vrmCache[vrm] = {
      data: result.data,
      expires: now + CACHE_LIFETIME,
    };

    return res.json(result.data);
  } catch (err) {
    console.error("MOT ERROR:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Failed to fetch MOT data",
      details: err.response?.data || err.message,
    });
  }
});

export default motRouter;
