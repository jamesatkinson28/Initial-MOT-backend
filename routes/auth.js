import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db/db.js";
import { authRequired } from "../middleware/auth.js";


const router = express.Router();

// Normalize email
const cleanEmail = (email) => email.trim().toLowerCase();

// JWT signing function
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      premium: user.premium,
      premium_until: user.premium_until
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// REGISTER
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
       RETURNING id, email, premium, premium_until`,
      [emailNorm, passwordHash]
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.json({
      token,
      user
    });

  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }

    console.error("REGISTER ERROR", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const emailNorm = cleanEmail(email);

    const result = await query(
      `SELECT id, email, password_hash, premium, premium_until
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

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        premium: user.premium,
        premium_until: user.premium_until
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR", err);
    return res.status(500).json({ error: "Login failed" });
  }
});
// GET /api/auth/me  (who am I?)
router.get("/me", authRequired, async (req, res) => {
  // req.user is set by authRequired middleware
  res.json({ user: req.user });
});


export default router;
