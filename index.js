// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// ROUTES (your files are in the root folder)
import motRouter from "./mot.js";
import specRouter from "./spec.js";
import authRouter from "./auth.js";
import garageRouter from "./garage.js";

// If you created the middleware file in /middleware:
import { authRequired, signUserToken } from "./middleware/auth.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("GarageGPT backend is running");
});

// MOT endpoint (works exactly like old working backend)
// GET /mot?vrm=ABC123
app.use("/mot", motRouter);

// Auth routes
// POST /api/auth/register
// POST /api/auth/login
// GET  /api/auth/me
app.use("/api/auth", authRouter);

// Garage routes (protected)
app.use("/api/garage", garageRouter);

// Specs routes
app.use("/api", specRouter);

// Start server on Railway PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
