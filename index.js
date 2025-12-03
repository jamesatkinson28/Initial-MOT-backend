import express from "express";
import cors from "cors";

// ROUTERS
import motRouter from "./routes/mot.js";
import specRouter from "./routes/spec.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("GarageGPT backend is running");
});

// Mount API routes
app.use("/api", motRouter);
app.use("/api", specRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
