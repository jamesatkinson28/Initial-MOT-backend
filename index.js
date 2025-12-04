// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ROUTES (correct paths)
import motRouter from "./routes/mot.js";
import authRouter from "./routes/auth.js";
import garageRouter from "./routes/garage.js";
import specRouter from "./routes/spec.js";

// If you use middleware:
import { authRequired, signUserToken } from "./middleware/auth.js";

const app = express();
app.use(cors());
app.use(express.json());

// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("GarageGPT backend is running");
});

// -------------------------------------------
// MOT ENDPOINT (identical behaviour to old working backend)
// -------------------------------------------
app.use("/mot", motRouter);
// This means final usable URL =  /mot?vrm=ABC123

// -------------------------------------------
// AUTH ROUTES
// -------------------------------------------
app.use("/api/auth", authRouter);

// -------------------------------------------
// GARAGE ROUTES
// -------------------------------------------
app.use("/api/garage", garageRouter);

// -------------------------------------------
// SPEC ROUTES (unlock + spec-options)
// -------------------------------------------
app.use("/api", specRouter);

// -------------------------------------------
// SERVER START
// -------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
