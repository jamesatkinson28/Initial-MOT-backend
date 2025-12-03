// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import motRouter from "./routes/mot.js";
import specRouter from "./routes/spec.js";
import authRouter from "./routes/auth.js";
import garageRouter from "./routes/garage.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("GarageGPT backend is running");
});

// Public MOT endpoint – same shape as your original working backend:
//   GET /mot?vrm=ABC123
app.use("/mot", motRouter);

// Auth routes:
//   POST /api/auth/register
//   POST /api/auth/login
//   GET  /api/auth/me
app.use("/api/auth", authRouter);

// Garage routes:
//   GET    /api/garage
//   POST   /api/garage
//   DELETE /api/garage/:id
app.use("/api/garage", garageRouter);

// Spec routes:
//   GET  /api/spec-options?vrm=ABC123
//   POST /api/unlock-spec  { vrm }
app.use("/api", specRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
