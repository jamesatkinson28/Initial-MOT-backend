// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ROUTES (matches your folder structure exactly)
import motRouter from "./routes/mot.js";
import authRouter from "./routes/auth.js";
import garageRouter from "./routes/garage.js";
import specRouter from "./routes/spec.js";

// Middleware (matches your folder structure)
import { authRequired, signUserToken } from "./middleware/auth.js";

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("GarageGPT backend is running");
});

// MOT ROUTE (same behaviour as old working backend)
app.use("/mot", motRouter);

// AUTH ROUTES
app.use("/api/auth", authRouter);

// GARAGE ROUTES
app.use("/api/garage", garageRouter);

// SPEC ROUTES
app.use("/api", specRouter);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
