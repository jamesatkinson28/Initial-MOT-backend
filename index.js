import express from "express";
import axios from "axios";
import qs from "qs";
import dotenv from "dotenv";
import cors from "cors";
import { query } from "./db/db.js";
import { getToken } from "./lib/dvsaToken.js";


dotenv.config();

// ==================================
// APP INITIALISATION
// ==================================
const app = express();
const PORT = process.env.PORT || 3000;

// ==================================
// IMPORT ROUTES
// ==================================
import authRouter from "./routes/auth.js";
import garageRouter from "./routes/garage.js";
import specRouter from "./routes/spec.js";
import passwordResetRoutes from "./routes/passwordReset.js";
import premiumRoutes from "./routes/premium.js";
import accountRoutes from "./routes/account.js";
import refreshRoutes from "./routes/refresh.js";
import motInsightAi from "./routes/motInsightAi.js";
import motExplainRoutes from "./routes/motExplain.js";
import diagnoseAi from "./routes/diagnoseAi.js";
import emailVerificationRoutes from "./routes/emailVerification.js";
import dvlaRoutes from "./routes/dvla.js";
import iapRoutes from "./routes/iap.js";
import lookupRoutes from "./routes/lookup.js";
import appleNotifications from "./routes/appleNotifications.js";


// ==================================
// NORMAL MIDDLEWARE (AFTER WEBHOOK)
// ==================================
app.use(express.json());
app.use(cors());

// ==================================
// ROUTES
// ==================================
app.use("/api/auth", authRouter);
app.use("/api/garage", garageRouter);
app.use("/api", specRouter);
app.use("/api/auth", passwordResetRoutes);
app.use("/api", premiumRoutes);
app.use("/api", accountRoutes);
app.use("/api/auth", refreshRoutes);
app.use("/api", motInsightAi);
app.use("/api", motExplainRoutes);
app.use("/api", diagnoseAi);
app.use("/api/auth", emailVerificationRoutes);
app.use("/api", dvlaRoutes);
app.use("/api/iap", iapRoutes);
app.use("/api/lookup", lookupRoutes);
app.use("/api", appleNotifications);

// ==================================
// DATABASE TEST ENDPOINT
// ==================================
app.get("/test-db", async (req, res) => {
  try {
    const result = await query("SELECT NOW()");
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error("DB TEST ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});



// ==================================
// VRM CACHE
// ==================================
const vrmCache = {};
const CACHE_LIFETIME = 60 * 5;

// ==================================
// MOT ENDPOINT
// ==================================
app.get("/mot", async (req, res) => {
  try {
    const vrm = req.query.vrm;

    if (!vrm) return res.status(400).json({ error: "Missing ?vrm=" });

    const now = Math.floor(Date.now() / 1000);

    // Cache hit
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
        "X-API-Key": process.env.API_KEY,
      },
    });

    vrmCache[vrm] = {
      data: response.data,
      expires: now + CACHE_LIFETIME,
    };

    res.json(response.data);
  } catch (err) {
    console.error("❌ MOT API ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch MOT data",
      details: err.response?.data || err.message,
    });
  }
});

// ==================================
// START SERVER
// ==================================
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
