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

    await query(
      `DELETE FROM password_reset_attempts
       WHERE last_attempt < NOW() - INTERVAL '10 minutes'`
    );

    console.log("[Cleanup] Old reset tokens & attempts removed");
  } catch (err) {
    console.error("[Cleanup Error]", err);
  }
}, 1000 * 60 * 30);

const router = express.Router();

// ==============================
// CONFIG
// ==============================
const resend = new Resend(process.env.RESEND_API_KEY);
const APP_RESET_URL_BASE = process.env.PASSWORD_RESET_URL_BASE || "";

// ==============================
// LOGGING FUNCTION
// ==============================
async function logEvent(email, req, action) {
  const ip =
    req.headers["x-forwarded-for"] ||
    req.connection?.remoteAddress ||
    null;

  const agent = req.headers["user-agent"] || null;

  await query(
    `INSERT INTO password_reset_logs (email, ip, user_agent, action)
     VALUES ($1, $2, $3, $4)`,
    [email, ip, agent, action]
  );
}

// ==============================
// EMAIL SENDER
// ==============================
async function sendResetEmail(email, token) {
  const resetLink = APP_RESET_URL_BASE
    ? `${APP_RESET_URL_BASE}?token=${token}`
    : "";

  await resend.emails.send({
    from: "GarageGPT <no-reply@garagegpt.co.uk>",
    to: email,
    subject: "Your GarageGPT Password Reset Code",
    html: `
      <h2>Password Reset Request</h2>
      <p>Your 6-digit reset code is:</p>
      <h1 style="font-size: 32px; letter-spacing: 4px;">${token}</h1>

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
      await logEvent(email, req, "send-code-nonexistent");
      return res.json({ success: true });
    }

    const userId = userRes.rows[0].id;

    // RATE LIMIT – 1 every 60 seconds
    const recent = await query(
      `SELECT expires_at FROM password_reset_tokens WHERE user_id=$1`,
      [userId]
    );

    if (recent.rows.length > 0) {
      const lastExpires = new Date(recent.rows[0].expires_at);
      const elapsed = Date.now() - (lastExpires.getTime() - 15 * 60 * 1000);

      if (elapsed < 60 * 1000) {
        return res
          .status(429)
          .json({ error: "Wait 60 seconds before requesting another code." });
      }
    }

    // Generate OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    // Save OTP
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used)
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes', FALSE)
       ON CONFLICT (user_id)
       DO UPDATE SET token_hash=$2, expires_at=NOW() + INTERVAL '15 minutes', used=FALSE`,
      [userId, codeHash]
    );

    await logEvent(email, req, "send-code");

    await sendResetEmail(email, code);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send reset code" });
  }
});

// ==============================
// RESEND RESET CODE
// ==============================
router.post("/resend-reset-code", async (req, res) => {
  return router.handle(req, res, () =>
    res.status(200).json({ info: "Resend handler not used by client yet" })
  );
});

// ==============================
// VERIFY 6-DIGIT CODE
// ==============================
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: "Email and code required" });

    // LOCKOUT CHECK
    const attemptRes = await query(
      `SELECT attempts, last_attempt FROM password_reset_attempts WHERE email=$1`,
      [email]
    );

    if (attemptRes.rows.length > 0) {
      const { attempts, last_attempt } = attemptRes.rows[0];
      const last = new Date(last_attempt);
      const minsAgo = (Date.now() - last.getTime()) / 60000;

      if (attempts >= 5 && minsAgo < 10) {
        return res
          .status(429)
          .json({ error: "Too many attempts. Try again in 10 minutes." });
      }
    }

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    const result = await query(
      `SELECT u.id FROM users u
       JOIN password_reset_tokens prt ON u.id = prt.user_id
       WHERE u.email = $1 AND prt.token_hash=$2
       AND prt.used=FALSE AND prt.expires_at > NOW()`,
      [email, codeHash]
    );

    // Wrong code → log attempt
    if (result.rows.length === 0) {
      await query(
        `INSERT INTO password_reset_attempts (email, attempts, last_attempt)
         VALUES ($1, 1, NOW())
         ON CONFLICT (email)
         DO UPDATE SET attempts = password_reset_attempts.attempts + 1,
                       last_attempt = NOW()`,
        [email]
      );

      await logEvent(email, req, "verify-fail");

      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Success → reset attempts
    await query(`DELETE FROM password_reset_attempts WHERE email=$1`, [email]);
    await logEvent(email, req, "verify-success");

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to verify code" });
  }
});

// ==============================
// RESET PASSWORD
// ==============================
router.post("/reset-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Missing fields" });

    const user = await query(`SELECT id FROM users WHERE email=$1`, [email]);
    if (user.rows.length === 0)
      return res.status(400).json({ error: "Invalid request" });

    const userId = user.rows[0].id;
    const hashedPw = await bcrypt.hash(password, 10);

    await query(
	  `UPDATE users 
	   SET password_hash=$1, token_version = token_version + 1 
	   WHERE id=$2`,
	  [hashedPw, userId]
	);
	await query(`DELETE FROM refresh_tokens WHERE user_id=$1`, [userId]);


    await query(`UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1`, [
      userId,
    ]);

    // SECURITY NOTIFICATION EMAIL
    await resend.emails.send({
      from: "GarageGPT <no-reply@garagegpt.co.uk>",
      to: email,
      subject: "Your GarageGPT Password Was Changed",
      html: `
        <h2>Password Changed</h2>
        <p>Your GarageGPT password has just been successfully changed.</p>
        <p>If this wasn’t you, contact support immediately.</p>
      `,
    });

    await logEvent(email, req, "password-reset");

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
