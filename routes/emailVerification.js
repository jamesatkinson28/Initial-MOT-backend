import express from "express";
import crypto from "crypto";
import { query } from "../db/db.js";
import { Resend } from "resend";

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

const APP_VERIFY_URL_BASE = process.env.EMAIL_VERIFY_URL_BASE; 
// e.g. garagegpt://verify-email OR https://garagegpt.co.uk/verify

router.post("/send-verification-email", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const userRes = await query(
    `SELECT id, email_verified FROM users WHERE email=$1`,
    [email]
  );

  if (userRes.rows.length === 0) {
    return res.json({ success: true }); // don't leak existence
  }

  if (userRes.rows[0].email_verified) {
    return res.json({ success: true });
  }

  const token = crypto.randomBytes(32).toString("hex");

  await query(
    `
    UPDATE users
    SET email_verification_token=$1,
        email_verification_expires=NOW() + INTERVAL '24 hours'
    WHERE email=$2
    `,
    [token, email]
  );

  const link = `${APP_VERIFY_URL_BASE}?token=${token}`;

  await resend.emails.send({
    from: "GarageGPT <no-reply@garagegpt.co.uk>",
    to: email,
    subject: "Verify your GarageGPT email",
    html: `
      <h2>Verify your email</h2>
      <p>Thanks for signing up to GarageGPT.</p>
      <p>Please verify your email address to activate your account:</p>
      <a href="${link}" style="font-size:16px">${link}</a>
      <p>This link expires in 24 hours.</p>
    `,
  });

  return res.json({ success: true });
});
export default router;
