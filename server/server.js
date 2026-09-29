const express = require("express");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const PORT = 5000;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());


// ============================================================
// ARVION SOP KNOWLEDGE BASE
// ============================================================

const SOP_PATH = path.join(__dirname, "sop.txt");

function retrieveSOP(question) {
  if (!fs.existsSync(SOP_PATH)) {
    throw new Error("sop.txt not found in the server folder.");
  }

  const text = fs.readFileSync(SOP_PATH, "utf8");

  const sections = text
    .split(/\n(?=SECTION \d+)/)
    .filter(Boolean);

  const words = question
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2);

  const scoredSections = sections.map((section) => {
    const lowerSection = section.toLowerCase();

    let score = 0;

    for (const word of words) {
      if (lowerSection.includes(word)) {
        score++;
      }
    }

    return {
      section,
      score,
    };
  });

  return scoredSections
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.section)
    .join("\n\n");
}


// ============================================================
// BASIC SERVER
// ============================================================

app.get("/", (req, res) => {
  res.json({
    name: "ARVION",
    status: "online",
    mode: "offline-first",
    ai: "Ollama + Qwen 2.5 7B",
    features: [
      "Incident Analysis",
      "Live Incident Sync",
      "SOP Intelligence",
    ],
  });
});


// ============================================================
// SOCKET.IO
// ============================================================

io.on("connection", (socket) => {
  console.log(`📡 Control device connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`📴 Device disconnected: ${socket.id}`);
  });
});


// ============================================================
// INCIDENT ANALYSIS
// ============================================================

app.post("/api/analyze", async (req, res) => {
  try {
    const { report } = req.body;

    if (!report || !report.trim()) {
      return res.status(400).json({
        success: false,
        error: "Incident report is required",
      });
    }

    const prompt = `
You are ARVION, an offline AI control-room assistant for large events.

Analyze the incident report below.

IMPORTANT:
- Return ONLY valid JSON.
- Use English for ALL output values.
- Do not use markdown.
- Do not add explanations.
- Do not translate the JSON keys.
- Do not include any language other than English in the JSON values.

Required JSON fields:
type
severity
location
description
recommended_action

Severity MUST be exactly one of:
LOW
MEDIUM
HIGH
CRITICAL

Incident report:
"${report}"
`;

    const ollamaResponse = await fetch(
      "http://localhost:11434/api/generate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen2.5:7b",
          prompt,
          stream: false,
          format: "json",
        }),
      }
    );

    if (!ollamaResponse.ok) {
      throw new Error("Ollama request failed");
    }

    const data = await ollamaResponse.json();

    const incident = JSON.parse(data.response);


    // ========================================================
    // DEMO LOCATION MAPPING
    // ========================================================

    const locationText = (incident.location || "").toLowerCase();

    let coordinates = {
      lat: 17.4065,
      lng: 78.4772,
      label: "Control Center",
    };

    if (locationText.includes("gate 1")) {
      coordinates = {
        lat: 17.4075,
        lng: 78.4760,
        label: "Gate 1",
      };
    } else if (locationText.includes("gate 2")) {
      coordinates = {
        lat: 17.4069,
        lng: 78.4790,
        label: "Gate 2",
      };
    } else if (locationText.includes("gate 3")) {
      coordinates = {
        lat: 17.4055,
        lng: 78.4782,
        label: "Gate 3",
      };
    } else if (
      locationText.includes("medical") ||
      locationText.includes("first aid")
    ) {
      coordinates = {
        lat: 17.4048,
        lng: 78.4768,
        label: "Medical Zone",
      };
    }


    // ========================================================
    // ENRICH INCIDENT
    // ========================================================

    const enrichedIncident = {
      ...incident,
      id: Date.now(),
      timestamp: new Date().toISOString(),
      coordinates,
    };


    // ========================================================
    // REAL-TIME BROADCAST
    // ========================================================

    io.emit("newIncident", enrichedIncident);


    res.json({
      success: true,
      incident: enrichedIncident,
    });

  } catch (error) {
    console.error("ARVION ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ============================================================
// ARVION SOP / RAG QUESTION ANSWERING
// ============================================================

app.post("/api/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        error: "Question is required",
      });
    }

    // Retrieve relevant SOP sections
    const context = retrieveSOP(question);

    if (!context) {
      return res.json({
        success: true,
        answer:
          "The available SOP does not provide enough information.",
        source: "ARVION Event Safety SOP",
      });
    }


    // Send retrieved context to Ollama
    const prompt = `
You are ARVION, an offline event safety assistant.

Answer the user's question ONLY using the SOP context provided below.

IMPORTANT RULES:
- Do not invent procedures.
- Do not add information that is not supported by the SOP.
- Keep the answer concise and practical.
- Use English only.
- Return ONLY valid JSON.
- Do not use markdown.

If the SOP does not contain enough information, say:
"The available SOP does not provide enough information."

Return exactly:

{
  "answer": "your answer",
  "source": "the relevant SOP source"
}

SOP CONTEXT:
${context}

USER QUESTION:
${question}
`;


    const ollamaResponse = await fetch(
      "http://localhost:11434/api/generate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen2.5:7b",
          prompt,
          stream: false,
          format: "json",
        }),
      }
    );

    if (!ollamaResponse.ok) {
      throw new Error("Ollama request failed");
    }

    const data = await ollamaResponse.json();

    const answer = JSON.parse(data.response);


    res.json({
      success: true,
      answer: answer.answer,
      source: answer.source,
    });

  } catch (error) {
    console.error("ARVION RAG ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║           ARVION CONTROL ROOM        ║
║                                      ║
║  Server: http://localhost:${PORT}      ║
║  AI:     Ollama + Qwen 2.5 7B        ║
║  Socket: LIVE                         ║
║  RAG:    SOP INTELLIGENCE             ║
║  Status: ONLINE                       ║
╚══════════════════════════════════════╝
`);
});