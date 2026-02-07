import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { query } from "../db/db.js";
import { authRequired } from "../middleware/auth.js";
import { Resend } from "resend";

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
	  id: user.uuid,  
      legacyId: user.id,
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
       RETURNING id, uuid, email, premium, premium_until, token_version`,
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
	
	// Generate verification token
	const verifyToken = crypto.randomBytes(32).toString("hex");

	await query(
	  `
	  UPDATE users
	  SET email_verification_token = $1,
		  email_verification_expires = NOW() + INTERVAL '24 hours'
	  WHERE id = $2
	  `,
	  [verifyToken, user.id]
	);

	// Send verification email
	const verifyLink = `${process.env.EMAIL_VERIFY_URL_BASE}?token=${verifyToken}`;

	const resend = new Resend(process.env.RESEND_API_KEY);

	await resend.emails.send({
	  from: "GarageGPT <no-reply@garagegpt.co.uk>",
	  to: user.email,
	  subject: "Verify your GarageGPT email",
	  html: `
		<h2>Verify your email</h2>
		<p>Thanks for signing up to GarageGPT.</p>
		<p>Please verify your email address:</p>
		<a href="${verifyLink}">${verifyLink}</a>
		<p>This link expires in 24 hours.</p>
	  `,
	});


    res.json({
	  success: true,
	  message: "Account created. Please verify your email before signing in.",
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
      `
      SELECT
        id,
        uuid,
        email,
        password_hash,
        premium,
        premium_until,
        token_version,
        email_verified
      FROM users
      WHERE email = $1
      `,
      [emailNorm]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.email_verified === false) {
      console.log("BLOCKED: EMAIL NOT VERIFIED");
      return res.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
    }

    // ─────────────────────────────────────────────
    // 🔁 GUEST → USER ENTITLEMENT MERGE (NEW)
    // ─────────────────────────────────────────────
    const guestId =
      req.body.guestId ??
      req.headers["x-guest-id"] ??
      null;

    if (guestId) {
      const mergeResult = await query(
        `
        UPDATE premium_entitlements
        SET
          user_uuid = $1,
          guest_id = NULL
        WHERE
          guest_id = $2
          AND (user_uuid IS NULL OR user_uuid = $1)
        `,
        [user.uuid, guestId]
      );

      console.log("🔁 LOGIN MERGE GUEST → USER", {
        userUuid: user.uuid,
        guestId,
        rowsAffected: mergeResult.rowCount,
      });
    }

    // ─────────────────────────────────────────────
    // 🔄 RESYNC USER PREMIUM FLAGS (RECOMMENDED)
    // ─────────────────────────────────────────────
    await query(
      `
      UPDATE users
      SET
        premium = pe.premium_until > NOW(),
        premium_until = pe.premium_until
      FROM premium_entitlements pe
      WHERE
        pe.user_uuid = users.uuid
        AND users.uuid = $1
        AND pe.premium_until > NOW()
      `,
      [user.uuid]
    );

    // ─────────────────────────────────────────────
    // 🔐 TOKEN ISSUANCE (UNCHANGED)
    // ─────────────────────────────────────────────
    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefresh(refreshToken);

    await query(
      `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '30 days')
      ON CONFLICT (user_id)
      DO UPDATE
        SET token_hash = $2,
            expires_at = NOW() + INTERVAL '30 days'
      `,
      [user.id, refreshHash]
    );

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.uuid,          // ✅ public identity
        legacyId: user.id,      // optional
        email: user.email,
        premium: user.premium,
        premium_until: user.premium_until,
        token_version: user.token_version,
        emailVerified: user.email_verified === true,
      },
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
  if (!token) {
    return res.status(400).send("Invalid verification link");
  }

  const result = await query(
    `
    UPDATE users
    SET email_verified = TRUE,
        email_verification_token = NULL,
        email_verification_expires = NULL
    WHERE email_verification_token = $1
      AND email_verification_expires > NOW()
    RETURNING id
    `,
    [token]
  );

  if (result.rowCount === 0) {
    return res.status(400).send("Invalid or expired verification link");
  }

  // Browser fallback + deep link
  return res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Email verified</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #020617;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            text-align: center;
            background: #0f172a;
            padding: 32px;
            border-radius: 16px;
            max-width: 420px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
          }
          h1 {
            margin-bottom: 12px;
          }
          p {
            color: #9ca3af;
            margin-bottom: 24px;
          }
          a.button {
            display: inline-block;
            padding: 12px 20px;
            background: #2563eb;
            color: white;
            text-decoration: none;
            border-radius: 999px;
            font-weight: 600;
          }
        </style>
        <script>
          // Try to open the app automatically
          window.onload = () => {
            window.location.href = "garagegpt://verified";
          };
        </script>
      </head>
      <body>
        <div class="card">
          <h1>✅ Email verified</h1>
          <p>Your email address has been successfully verified.<br />
          You can now return to GarageGPT.</p>
          <a class="button" href="garagegpt://verified">Open GarageGPT</a>
        </div>
      </body>
    </html>
  `);
});


export default router;
