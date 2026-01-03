import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { query } from "../db/db.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

// Normalize email
const cleanEmail = (email) => email.trim().toLowerCase();

// ==========================================
// TOKEN HELPERS
// ==========================================

// Access token (short-lived: 30 minutes)
function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      premium: user.premium,
      premium_until: user.premium_until,
      tokenVersion: user.token_version
    },
    process.env.JWT_SECRET,
    { expiresIn: "30m" }
  );
}

// Refresh token (long-lived: 30 days)
function generateRefreshToken() {
  return crypto.randomBytes(40).toString("hex");
}

// Creates hashed refresh token for DB storage
function hashRefresh(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ==========================================
// REGISTER
// ==========================================
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    if (password.length < 6)
      return res.status(400).json({ error: "Password must be 6+ characters" });

    const emailNorm = cleanEmail(email);
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, premium, premium_until, token_version`,
      [emailNorm, passwordHash]
    );

    const user = result.rows[0];

    // Create tokens
    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefresh(refreshToken);

    // Store refresh token in DB
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshHash]
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        premium: user.premium,
        premium_until: user.premium_until,
        token_version: user.token_version
      }
    });

  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("REGISTER ERROR", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

// ==========================================
// LOGIN
// ==========================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailNorm = cleanEmail(email);

    const result = await query(
      `SELECT id, email, password_hash, premium, premium_until, token_version, email_verified
       FROM users
       WHERE email=$1`,
      [emailNorm]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: "Invalid credentials" });
  
    if (!user.email_verified) {
	  return res.status(403).json({
		error: "EMAIL_NOT_VERIFIED",
	  });
	}


    // Create tokens
    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefresh(refreshToken);

    // Store refresh token (rotate any existing)
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')
       ON CONFLICT (user_id)
       DO UPDATE SET token_hash = $2, expires_at = NOW() + INTERVAL '30 days'`,
      [user.id, refreshHash]
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        premium: user.premium,
        premium_until: user.premium_until,
        token_version: user.token_version
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

// ==========================================
// WHOAMI (requires auth)
// ==========================================
router.get("/me", authRequired, async (req, res) => {
  res.json({ user: req.user });
});
// ==========================================
// Verify email endpoint
// ==========================================

router.get("/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Invalid link");

  const result = await query(
    `
    UPDATE users
    SET email_verified=TRUE,
        email_verification_token=NULL,
        email_verification_expires=NULL
    WHERE email_verification_token=$1
      AND email_verification_expires > NOW()
    RETURNING id
    `,
    [token]
  );

  if (result.rowCount === 0) {
    return res.status(400).send("Invalid or expired verification link");
  }

  // Optional: redirect back into app
  return res.redirect("garagegpt://verified");
});


export default router;
