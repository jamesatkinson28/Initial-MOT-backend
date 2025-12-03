import express from "express";
import cors from "cors";
import { specRouter } from "./routes/spec.js";
import { motRouter } from "./routes/mot.js";   // ✅ DVSA MOT ROUTER

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ROUTES
app.use("/api/spec", specRouter);   // VDGL full spec
app.use("/api/mot", motRouter);     // DVSA MOT history

app.get("/", (req, res) => {
  res.send("GarageGPT backend running");
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
