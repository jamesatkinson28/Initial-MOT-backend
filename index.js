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

  // Use cached token if it's still valid
  if (cachedToken && now < tokenExpiry - 60) {
    return cachedToken;
  }

  // Use the same token URL you use in curl
  const tokenUrl =
    process.env.TOKEN_URL ||
    `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

  // This MUST match your working curl command
  const form = {
    grant_type: "client_credentials",
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope: "https://tapi.dvsa.gov.uk/.default",
  };

  try {
    const response = await axios.post(tokenUrl, qs.stringify(form), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    cachedToken = response.data.access_token;
    tokenExpiry = now + (response.data.expires_in || 3600);

    console.log("🔐 New token fetched from Azure AD");
    return cachedToken;
  } catch (err) {
    console.error(
      "❌ Token request failed:",
      err.response?.status,
      err.response?.data || err.message
    );
    throw new Error("Token request failed");
  }
}

// =========================
//  MOT API ENDPOINT
// =========================
app.get("/mot", async (req, res) => {
  const vrm = req.query.vrm;
  if (!vrm) {
    return res.status(400).json({ error: "Missing vrm query parameter" });
  }

  try {
    const token = await getToken();

    const url = `https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?registration=${encodeURIComponent(
      vrm
    )}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-key": process.env.API_KEY,
        Accept: "application/json",
      },
    });

    res.json(response.data);
  } catch (err) {
    console.error(
      "❌ MOT API error:",
      err.response?.status,
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch MOT data",
      details: err.response?.data || err.message,
    });
  }
});

// Simple health check
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// =========================
//  START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`🚀 MOT Backend running on port ${PORT}`);
});
