// routes/passwordReset.js
import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { query } from "../db/db.js";

import { Resend } from 'resend';

const router = express.Router();

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------

const APP_RESET_URL_BASE =
  process.env.PASSWORD_RESET_URL_BASE || "https://garagegpt.co.uk/reset-password";

const resend = new Resend(process.env.RESEND_API_KEY);

// ------------------------------------------------------------------
// Helper: send email via Resend HTTP API
// ------------------------------------------------------------------

async function sendResetEmail(email, token) {
  const resetLink = `${APP_RESET_URL_BASE}?token=${token}`;

  try {
    await resend.emails.send({
      from: process.env.RESET_EMAIL_FROM,  // e.g. no-reply@garagegpt.co.uk
      to: email,
      subject: "GarageGPT Password Reset",
      html: `
        <h2>Password Reset Request</h2>
        <p>Use the code below to reset your password:</p>
        <h1 style="font-size: 24px;">${token}</h1>
        <p>Or click this link: <a href="${resetLink}">${resetLink}</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
    });

    console.log("[Resend] Password reset email sent");
  } catch (err) {
    console.error("[Resend] Error sending reset email:", err);
    throw new Error("Failed to send reset email");
  }
}


// ------------------------------------------------------------------
// POST /api/auth/request-password-reset
// ------------------------------------------------------------------

router.post("/request-password-reset", async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // Look up user (case-insensitive)
    const userResult = await query(
      `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    // Always respond the same to avoid user enumeration
    const genericResponse = {
      success: true,
      message: "If an account exists for that email, we've sent a reset link.",
    };

    if (userResult.rows.length === 0) {
      // No user -> return generic response
      return res.json(genericResponse);
    }

    const user = userResult.rows[0];

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const expiresMinutes = 60;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    // Store token
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used, created_at)
       VALUES ($1, $2, $3, FALSE, NOW())`,
      [user.id, tokenHash, expiresAt]
    );

    // Build reset URL
    let resetUrl;
    if (APP_RESET_URL_BASE.includes("?")) {
      resetUrl = `${APP_RESET_URL_BASE}&token=${token}`;
    } else {
      resetUrl = `${APP_RESET_URL_BASE}?token=${token}`;
    }

    // Send email 
    await sendResetEmail(user.email, token);

    return res.json(genericResponse);
  } catch (err) {
    console.error("REQUEST PASSWORD RESET ERROR:", err);
    return res.status(500).json({ error: "Failed to request password reset" });
  }
});

// ------------------------------------------------------------------
// POST /api/auth/reset-password
// ------------------------------------------------------------------

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || !password) {
    return res
      .status(400)
      .json({ error: "Token and new password are required" });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters long" });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Look up token
    const tokenResult = await query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = $1 AND used = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const tokenRow = tokenResult.rows[0];

    // Check expiry
    const now = new Date();
    if (new Date(tokenRow.expires_at) < now) {
      return res.status(400).json({ error: "Token has expired" });
    }

    // Make sure user still exists
    const userResult = await query(
      `SELECT id FROM users WHERE id = $1`,
      [tokenRow.user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "User no longer exists" });
    }

    const userId = userResult.rows[0].id;

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user password
    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, userId]
    );

    // Mark token used
    await query(
      `UPDATE password_reset_tokens SET used = TRUE WHERE id = $1`,
      [tokenRow.id]
    );

    return res.json({ success: true, message: "Password has been reset." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
