import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { query } from "../db/db.js";
import { Resend } from "resend";

// ======================================
// CLEANUP EXPIRED TOKENS EVERY 30 MINUTES
// ======================================
setInterval(async () => {
  try {
    await query(
      `DELETE FROM password_reset_tokens 
       WHERE expires_at < NOW() - INTERVAL '1 hour'`
    );
    console.log("[Cleanup] Old reset tokens removed");
  } catch (err) {
    console.error("[Cleanup Error]", err);
  }
}, 1000 * 60 * 30); // 30 minutes

const router = express.Router();

// ==============================
// CONFIG
// ==============================
const resend = new Resend(process.env.RESEND_API_KEY);
const APP_RESET_URL_BASE = process.env.PASSWORD_RESET_URL_BASE || "";

// ==============================
// EMAIL SENDER
// ==============================
async function sendResetEmail(email, token) {
  const resetLink = APP_RESET_URL_BASE
    ? `${APP_RESET_URL_BASE}?token=${token}`
    : "";

  try {
    await resend.emails.send({
      from: "GarageGPT <no-reply@garagegpt.co.uk>",
      to: email,
      subject: "Your GarageGPT Password Reset Code",
      html: `
        <h2>Password Reset Request</h2>

        <p>Your 6-digit reset code is:</p>
        <h1 style="font-size: 32px; letter-spacing: 4px;">
          ${token}
        </h1>

        ${
          resetLink
            ? `<p>Or click this link:</p>
               <a href="${resetLink}" style="font-size: 16px;">${resetLink}</a>`
            : ""
        }

        <p>This code expires in 15 minutes.</p>
        <p>If you did not request this email, you can safely ignore it.</p>
      `,
    });

    console.log("[Resend] Reset code email sent to:", email);
  } catch (err) {
    console.error("[Resend] Error sending reset email:", err);
    throw new Error("Failed to send reset email");
  }
}

// ==============================
// SEND RESET CODE (OTP)
// ==============================
router.post("/send-reset-code", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    const userRes = await query("SELECT id FROM users WHERE email=$1", [email]);
    if (userRes.rows.length === 0) {
      console.log("[Reset] Email not found — return silent success.");
      return res.json({ success: true });
    }

    const userId = userRes.rows[0].id;

    // ==============================
    // RATE LIMIT: 1 request per minute
    // ==============================
    const recent = await query(
      `
        SELECT expires_at
        FROM password_reset_tokens
        WHERE user_id = $1
        ORDER BY expires_at DESC
        LIMIT 1
      `,
      [userId]
    );

    if (recent.rows.length > 0) {
      const lastExpires = new Date(recent.rows[0].expires_at);
      const elapsed = Date.now() - (lastExpires.getTime() - 15 * 60 * 1000);

      if (elapsed < 60 * 1000) {
        console.log("[Reset] Rate-limited request for user:", userId);
        return res.status(429).json({
          error: "Please wait 60 seconds before requesting another reset code.",
        });
      }
    }

    // Generate secure 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    // Store OTP (UPSERT)
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes', FALSE)
       ON CONFLICT (user_id)
       DO UPDATE SET token_hash=$2, expires_at=NOW() + INTERVAL '15 minutes', used=FALSE`,
      [userId, codeHash]
    );

    // Send email
    await sendResetEmail(email, code);

    return res.json({ success: true });
  } catch (err) {
    console.error("[Reset] SEND RESET CODE ERROR:", err);
    return res.status(500).json({ error: "Failed to send reset code" });
  }
});

// ==============================
// VERIFY 6-DIGIT CODE
// ==============================
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code)
      return res.status(400).json({ error: "Email and code required" });

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    const result = await query(
      `SELECT prt.*
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE LOWER(u.email) = LOWER($1)
       AND prt.token_hash = $2
       AND prt.used = FALSE
       AND prt.expires_at > NOW()
       LIMIT 1`,
      [email, codeHash]
    );

    // Invalid code → Log failed attempt
    if (result.rows.length === 0) {
      await query(
        `
          INSERT INTO password_reset_attempts (email, attempts, last_attempt)
          VALUES ($1, 1, NOW())
          ON CONFLICT (email)
          DO UPDATE SET attempts = password_reset_attempts.attempts + 1,
                        last_attempt = NOW()
        `,
        [email]
      );

      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // SUCCESS → reset attempts
    await query(`DELETE FROM password_reset_attempts WHERE email=$1`, [email]);

    return res.json({ success: true });
  } catch (err) {
    console.error("[Reset] VERIFY CODE ERROR:", err);
    return res.status(500).json({ error: "Failed to verify code" });
  }
});

// ==============================
// RESET PASSWORD
// ==============================
router.post("/reset-password", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "Missing fields" });

    const userRes = await query("SELECT id FROM users WHERE email=$1", [email]);
    if (userRes.rows.length === 0)
      return res.status(400).json({ error: "Invalid request" });

    const userId = userRes.rows[0].id;

    const hashedPw = await bcrypt.hash(password, 10);

    await query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      hashedPw,
      userId,
    ]);

    await query(
      `UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1`,
      [userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[Reset] RESET PASSWORD ERROR:", err);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
