// index.js
import express from "express";
import axios from "axios";
import qs from "qs";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ───────────────────────────────────────────────
//   MIDDLEWARE
// ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ───────────────────────────────────────────────
//   AUTH HELPERS
// ───────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      premium: user.premium,
    },
    JWT_SECRET,
    { expiresIn: "365d" }
  );
}

async function findUserByEmail(email) {
  const result = await query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0] || null;
}

// Simple auth middleware for protected routes
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [, token] = header.split(" ");

    if (!token) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId, email: payload.email, premium: payload.premium };
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ───────────────────────────────────────────────
//   AUTH ROUTES
// ───────────────────────────────────────────────

// Register
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "Account already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, premium, premium_until, monthly_unlocks_remaining`,
      [email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    const token = generateToken(user);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        premium: user.premium,
        premiumUntil: user.premium_until,
        monthlyUnlocksRemaining: user.monthly_unlocks_remaining,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Failed to create account" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await findUserByEmail(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        premium: user.premium,
        premiumUntil: user.premium_until,
        monthlyUnlocksRemaining: user.monthly_unlocks_remaining,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Failed to login" });
  }
});

// Simple "who am I" route (for testing in the app)
app.get("/me", authMiddleware, async (req, res) => {
  try {
    const result = await query(
      "SELECT id, email, premium, premium_until, monthly_unlocks_remaining FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      id: user.id,
      email: user.email,
      premium: user.premium,
      premiumUntil: user.premium_until,
      monthlyUnlocksRemaining: user.monthly_unlocks_remaining,
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

// ───────────────────────────────────────────────
//   DVSA MOT TOKEN + CACHE (your existing code)
// ───────────────────────────────────────────────

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
    scope: "https://tapi.dvsa.gov.uk/.default",
  });

  const resToken = await axios.post(tokenUrl, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  cachedToken = resToken.data.access_token;
  tokenExpiry = now + resToken.data.expires_in;

  console.log("🔐 New token fetched");
  return cachedToken;
}

const vrmCache = {}; // { VRM: { data, expires } }
const CACHE_LIFETIME = 60 * 5; // 5 minutes

// MOT endpoint (unchanged behaviour)
app.get("/mot", async (req, res) => {
  try {
    const vrm = req.query.vrm;

    if (!vrm) {
      return res.status(400).json({ error: "Missing ?vrm=" });
    }

    const now = Math.floor(Date.now() / 1000);

    // cache hit
    if (vrmCache[vrm] && now < vrmCache[vrm].expires) {
      console.log(`⚡ Cache hit for ${vrm}`);
      return res.json(vrmCache[vrm].data);
    }

    console.log(`🌐 Cache MISS for ${vrm} — fetching from DVSA`);

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

    return res.json(response.data);
  } catch (err) {
    console.error("❌ MOT API ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to fetch MOT data",
      details: err.response?.data || err.message,
    });
  }
});

// ───────────────────────────────────────────────
//   START SERVER
// ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 MOT Backend running on port ${PORT}`);
});
