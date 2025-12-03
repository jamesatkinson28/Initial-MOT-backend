import express from "express";
import cors from "cors";
import fetch from "node-fetch";

// ROUTERS
import motRouter from "./routes/mot.js";
import specRouter from "./routes/spec.js";  // keep your new spec route

const app = express();
app.use(cors());
app.use(express.json());

// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("GarageGPT backend is running");
});

// ⚠️ Mount MOT route
app.use("/api", motRouter);

// ⚠️ Mount SPEC route
app.use("/api", specRouter);

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
