import express from "express";
import Stripe from "stripe";
import { query } from "../db/db.js";

const router = express.Router();

// IMPORTANT: raw body is required for Stripe signature verification
router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Stripe webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ✅ Handle subscription renewal
    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      const periodEnd =
        invoice.lines.data[0]?.period?.end;

      if (!customerId || !periodEnd) {
        return res.json({ received: true });
      }

      // 🔄 Reset monthly unlocks on renewal
      await query(
        `
        UPDATE users
        SET
          premium = true,
          premium_until = to_timestamp($1),
          monthly_unlocks_used = 0
        WHERE stripe_customer_id = $2
        `,
        [periodEnd, customerId]
      );

      console.log(
        "🔁 Premium renewed, unlocks reset for customer:",
        customerId
      );
    }

    res.json({ received: true });
  }
);

export default router;
