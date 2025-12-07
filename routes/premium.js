// routes/premium.js
import express from "express";
import Stripe from "stripe";
import { authMiddleware } from "../middleware/auth.js";
import { query } from "../db/db.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Your price IDs
const PRICE_MONTHLY = "price_1SbkGRFxbR2H0cQi9haSEsXI";
const PRICE_YEARLY  = "price_1SbkHiFxbR2H0cQi0fs8h3IM";

/**
 * POST /api/premium/create-checkout-session
 * body: { billingPeriod: "monthly" | "yearly" }
 * auth: required
 */
router.post(
  "/premium/create-checkout-session",
  authMiddleware,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { billingPeriod } = req.body;

      if (!billingPeriod || !["monthly", "yearly"].includes(billingPeriod)) {
        return res.status(400).json({ error: "Invalid billing period" });
      }

      const userResult = await query(
        "SELECT email FROM users WHERE id = $1",
        [userId]
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const email = userResult.rows[0].email;
      const priceId =
        billingPeriod === "yearly" ? PRICE_YEARLY : PRICE_MONTHLY;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        customer_email: email,
        metadata: {
          userId: String(userId),
          billingPeriod,
        },
        // You can make simple placeholder pages on garagegpt.co.uk later
        success_url:
          "https://garagegpt.co.uk/premium-success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://garagegpt.co.uk/premium-cancel",
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error("[Premium] create-checkout-session error:", err);
      return res
        .status(500)
        .json({ error: "Failed to create checkout session" });
    }
  }
);

export default router;
