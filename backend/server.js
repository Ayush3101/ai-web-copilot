import express from "express";
import cors from "cors";
import dotenv from "dotenv";

console.log("SERVER.JS IS RUNNING");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.post("/analyze", (req, res) => {
  const { content } = req.body;

  console.log("Received content:", content);

  // Temporary response (AI later)
  res.json({
    summary: "This is a sample summary of the page.",
    recommendation: "Looks like a good option.",
  });
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
