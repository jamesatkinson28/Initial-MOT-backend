import express from "express";
import axios from "axios";
import qs from "qs";
import dotenv from "dotenv";
import cors from "cors";
import Stripe from "stripe";
import { query } from "./db/db.js";

dotenv.config();

// ==================================
// APP INITIALISATION
// ==================================
const app = express();
const PORT = process.env.PORT || 3000;

// ==================================
// STRIPE INITIALISATION (CREATE ONCE)
// ==================================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

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
import stripeWebhook from "./routes/stripeWebhook.js";

// ==================================
// STRIPE WEBHOOK — MUST COME BEFORE express.json()
// ==================================
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("[Stripe] Bad webhook signature:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const userId = session.metadata?.userId;

          const subscriptionId = session.subscription;
          const subscription =
            typeof subscriptionId === "string"
              ? await stripe.subscriptions.retrieve(subscriptionId)
              : null;

          const expiry = subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null;

          await query(
            `
              UPDATE users
              SET premium = true,
                  premium_until = $2,
                  monthly_unlocks_remaining = 3,
                  last_unlock_reset = NOW()
              WHERE id = $1
            `,
            [userId, expiry]
          );

          break;
        }

        case "customer.subscription.deleted":
        case "customer.subscription.cancelled": {
          const sub = event.data.object;
          const userId = sub.metadata?.userId;

          await query(
            `UPDATE users SET premium = false WHERE id = $1`,
            [userId]
          );

          break;
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error("[Webhook Error]", err);
      res.status(500).send("Webhook handler crashed");
    }
  }
);

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
app.use("/api", stripeWebhook);

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
// DVSA TOKEN CACHE
// ==================================
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
    scope: "https://tapi.dvsa.gov.uk/.default",
  });

  const res = await axios.post(tokenUrl, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  cachedToken = res.data.access_token;
  tokenExpiry = now + res.data.expires_in;

  console.log("🔐 New DVSA token fetched");

  return cachedToken;
}

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
