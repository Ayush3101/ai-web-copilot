import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/analyze", async (req, res) => {
  const { query, pageData } = req.body;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      result: "Backend is missing GROQ_API_KEY.",
    });
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  try {
    const completion = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "Answer briefly and clearly.",
        },
        {
          role: "user",
          content: `
Page Title: ${pageData?.title}

Content:
${pageData?.content}

Question:
${query}
          `,
        },
      ],
    });

    res.json({
      result: completion.choices[0].message.content,
    });
  } catch (err) {
    const message =
      err?.error?.message || err?.message || "Error fetching AI response";
    console.error("Groq analyze error:", message);
    res.status(500).json({ result: message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));