// routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/client.js";

import { authRequired, signUserToken } from "../middleware/auth.js";

const authRouter = express.Router();
export default authRouter;

// Helper: normalise email
const normaliseEmail = (email) => email.trim().toLowerCase();

// POST /auth/register
authRouter.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters." });
    }

    const cleanEmail = normaliseEmail(email);
    const passwordHash = await bcrypt.hash(password, 10);

    // new users: no premium, 3 free unlocks, last_unlock_reset = now
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, premium, monthly_unlocks_remaining, last_unlock_reset)
       VALUES ($1, $2, FALSE, 3, NOW())
       RETURNING id, email, premium, premium_until, monthly_unlocks_remaining`,
      [cleanEmail, passwordHash]
    );

    const user = rows[0];
    const token = signUserToken(user);

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
    console.error("register error:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered." });
    }

    return res.status(500).json({ error: "Failed to register user." });
  }
});

// POST /auth/login
authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const cleanEmail = normaliseEmail(email);

    const { rows } = await query(
      `SELECT id, email, password_hash, premium, premium_until,
              monthly_unlocks_remaining, last_unlock_reset
       FROM users
       WHERE email = $1`,
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = signUserToken(user);

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
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Failed to login." });
  }
});

// GET /auth/me
authRouter.get("/me", authRequired, async (req, res) => {
  const user = req.user;
  return res.json({
    id: user.id,
    email: user.email,
    premium: user.premium,
    premiumUntil: user.premium_until,
    monthlyUnlocksRemaining: user.monthly_unlocks_remaining,
  });
});
