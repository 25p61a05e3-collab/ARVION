const express = require("express");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { Server } = require("socket.io");

const app = express();
const PORT = 5000;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

app.use(cors());
app.use(express.json());


// ============================================================
// ARVION RUNTIME
// ============================================================

const startedAt = new Date().toISOString();

const JOIN_TOKEN = crypto.randomBytes(22).toString("hex");

const MODEL_NAME = "qwen2.5:7b";
const OLLAMA_URL = "http://localhost:11434";


// ============================================================
// NETWORK DETECTION
// ============================================================

function getLanAddress() {
  const interfaces = os.networkInterfaces();

  const preferred = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (
        address.family === "IPv4" &&
        !address.internal
      ) {
        preferred.push({
          name,
          address: address.address,
        });
      }
    }
  }

  // Prefer normal private IPv4 addresses.
  const preferredAddress = preferred.find((item) =>
    /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(
      item.address
    )
  );

  return preferredAddress?.address || preferred[0]?.address || "localhost";
}

function getNetworkInfo() {
  return {
    lan: getLanAddress(),
    port: PORT,
    joinUrl: `http://${getLanAddress()}:5173/?mode=field&token=${JOIN_TOKEN}`,
  };
}


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
// IN-MEMORY EVENT STATE
// ============================================================

const devices = new Map();
const incidents = new Map();


// ============================================================
// HELPERS
// ============================================================

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function sanitizeDevice(device) {
  if (!device) return null;

  return {
    id: device.id,
    name: device.name,
    role: device.role,
    team: device.team,
    mode: device.mode,
    status: device.status,
    socketId: device.socketId || null,
    joinedAt: device.joinedAt,
    verifiedAt: device.verifiedAt || null,
    rejectedAt: device.rejectedAt || null,
    lastSeenAt: device.lastSeenAt || null,
  };
}

function getDevices() {
  return Array.from(devices.values())
    .map(sanitizeDevice)
    .sort((a, b) => {
      const order = {
        PENDING: 1,
        VERIFIED: 2,
        CONNECTED: 3,
        DISCONNECTED: 4,
        REJECTED: 5,
        REVOKED: 6,
      };

      return (
        (order[a.status] || 99) -
        (order[b.status] || 99)
      );
    });
}

function broadcastDevices() {
  io.emit("devicesUpdated", getDevices());
}

function emitDeviceUpdate(device) {
  io.emit("deviceUpdated", sanitizeDevice(device));
}

function publicIncident(incident) {
  return {
    ...incident,
  };
}

function broadcastIncident(incident) {
  io.emit("incidentUpdated", publicIncident(incident));
}

function isVerifiedDevice(deviceId) {
  const device = devices.get(deviceId);

  return (
    device &&
    ["VERIFIED", "CONNECTED"].includes(device.status)
  );
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
    serverTime: now(),
    startedAt,
    network: getNetworkInfo(),
    features: [
      "Incident Analysis",
      "Live Incident Sync",
      "SOP Intelligence",
      "Verified Field Devices",
      "Human-in-the-loop Workflow",
    ],
  });
});


// ============================================================
// HEALTH
// IMPORTANT:
// Browser must NOT directly check localhost:11434.
// The server checks Ollama locally.
// ============================================================

app.get("/api/health", async (req, res) => {
  const health = {
    server: true,
    ollama: false,
    model: MODEL_NAME,
    socket: true,
    lan: getLanAddress(),
    internetRequired: false,
    timestamp: now(),
  };

  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);

    health.ollama = response.ok;

    if (response.ok) {
      const data = await response.json();

      health.modelInstalled =
        Array.isArray(data.models) &&
        data.models.some(
          (model) =>
            model.name === MODEL_NAME ||
            model.name?.startsWith(`${MODEL_NAME}:`)
        );
    } else {
      health.modelInstalled = false;
    }
  } catch {
    health.ollama = false;
    health.modelInstalled = false;
  }

  res.json({
    success: true,
    health,
  });
});


// ============================================================
// NETWORK INFORMATION
// ============================================================

app.get("/api/network", (req, res) => {
  const network = getNetworkInfo();

  res.json({
    success: true,
    ...network,
  });
});


// ============================================================
// JOIN INFORMATION
// ============================================================

app.get("/api/join", (req, res) => {
  const network = getNetworkInfo();

  res.json({
    success: true,
    token: JOIN_TOKEN,
    ...network,
  });
});


// ============================================================
// FIELD DEVICE REGISTRATION
// ============================================================

app.post("/api/devices/register", (req, res) => {
  try {
    const {
      token,
      name,
      role,
      team,
      deviceId,
    } = req.body;

    if (!token || token !== JOIN_TOKEN) {
      return res.status(403).json({
        success: false,
        error: "Invalid ARVION join token.",
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Volunteer name is required.",
      });
    }

    if (!role || !role.trim()) {
      return res.status(400).json({
        success: false,
        error: "Volunteer role is required.",
      });
    }

    if (!team || !team.trim()) {
      return res.status(400).json({
        success: false,
        error: "Team is required.",
      });
    }

    const id =
      deviceId?.trim() ||
      makeId("FIELD");

    const existing = devices.get(id);

    const device = {
      id,
      name: name.trim(),
      role: role.trim(),
      team: team.trim(),
      mode: "FIELD",
      status:
        existing?.status === "VERIFIED"
          ? "VERIFIED"
          : "PENDING",
      socketId: existing?.socketId || null,
      joinedAt:
        existing?.joinedAt || now(),
      verifiedAt:
        existing?.verifiedAt || null,
      rejectedAt: null,
      lastSeenAt: now(),
    };

    devices.set(id, device);

    io.emit("fieldJoinRequest", sanitizeDevice(device));
    broadcastDevices();

    return res.json({
      success: true,
      device: sanitizeDevice(device),
      message:
        device.status === "VERIFIED"
          ? "Device is already verified."
          : "Join request sent to the ARVION control room.",
    });
  } catch (error) {
    console.error("DEVICE REGISTER ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ============================================================
// GET DEVICES
// ============================================================

app.get("/api/devices", (req, res) => {
  res.json({
    success: true,
    devices: getDevices(),
  });
});


// ============================================================
// VERIFY DEVICE
// ============================================================

app.post("/api/devices/:id/verify", (req, res) => {
  const device = devices.get(req.params.id);

  if (!device) {
    return res.status(404).json({
      success: false,
      error: "Device not found.",
    });
  }

  if (device.status === "REVOKED") {
    return res.status(400).json({
      success: false,
      error: "Revoked devices must register again.",
    });
  }

  device.status = device.socketId
    ? "CONNECTED"
    : "VERIFIED";

  device.verifiedAt = now();
  device.rejectedAt = null;
  device.lastSeenAt = now();

  devices.set(device.id, device);

  io.emit("deviceVerified", sanitizeDevice(device));

  if (device.socketId) {
    io.to(device.socketId).emit(
      "verificationResult",
      {
        approved: true,
        device: sanitizeDevice(device),
      }
    );
  }

  broadcastDevices();

  res.json({
    success: true,
    device: sanitizeDevice(device),
  });
});


// ============================================================
// REJECT DEVICE
// ============================================================

app.post("/api/devices/:id/reject", (req, res) => {
  const device = devices.get(req.params.id);

  if (!device) {
    return res.status(404).json({
      success: false,
      error: "Device not found.",
    });
  }

  device.status = "REJECTED";
  device.rejectedAt = now();

  devices.set(device.id, device);

  io.emit("deviceRejected", sanitizeDevice(device));

  if (device.socketId) {
    io.to(device.socketId).emit(
      "verificationResult",
      {
        approved: false,
        device: sanitizeDevice(device),
        reason: "Join request rejected by control room.",
      }
    );
  }

  broadcastDevices();

  res.json({
    success: true,
    device: sanitizeDevice(device),
  });
});


// ============================================================
// REVOKE DEVICE
// ============================================================

app.post("/api/devices/:id/revoke", (req, res) => {
  const device = devices.get(req.params.id);

  if (!device) {
    return res.status(404).json({
      success: false,
      error: "Device not found.",
    });
  }

  device.status = "REVOKED";
  device.lastSeenAt = now();

  devices.set(device.id, device);

  io.emit("deviceRevoked", sanitizeDevice(device));

  if (device.socketId) {
    io.to(device.socketId).emit(
      "verificationResult",
      {
        approved: false,
        revoked: true,
        device: sanitizeDevice(device),
        reason: "Device access revoked by control room.",
      }
    );
  }

  broadcastDevices();

  res.json({
    success: true,
    device: sanitizeDevice(device),
  });
});


// ============================================================
// INCIDENT ANALYSIS
// ============================================================

app.post("/api/analyze", async (req, res) => {
  try {
    const {
      report,
      deviceId,
      reporter,
    } = req.body;

    if (!report || !report.trim()) {
      return res.status(400).json({
        success: false,
        error: "Incident report is required",
      });
    }

    // Field reports must come from verified devices.
    if (deviceId) {
      const device = devices.get(deviceId);

      if (!device) {
        return res.status(403).json({
          success: false,
          error: "Unknown field device.",
        });
      }

      if (!isVerifiedDevice(deviceId)) {
        return res.status(403).json({
          success: false,
          error:
            "Field device is not verified by the control room.",
        });
      }
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
      `${OLLAMA_URL}/api/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_NAME,
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

    let incident;

    try {
      incident = JSON.parse(data.response);
    } catch {
      throw new Error(
        "Ollama returned invalid JSON."
      );
    }


    // ========================================================
    // DEMO LOCATION MAPPING
    // ========================================================

    const locationText =
      (incident.location || "").toLowerCase();

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

    const incidentId = makeId("INCIDENT");

    const device =
      deviceId ? devices.get(deviceId) : null;

    const enrichedIncident = {
      ...incident,

      id: incidentId,

      timestamp: now(),

      status: "NEW",

      assignedTeam: null,

      reporter: reporter || null,

      reporterDeviceId: deviceId || null,

      reporterName:
        reporter?.name ||
        device?.name ||
        "Control Room",

      reporterRole:
        reporter?.role ||
        device?.role ||
        "CONTROL",

      coordinates,

      timeline: [
        {
          id: makeId("EVENT"),
          action: "INCIDENT DETECTED",
          detail:
            "Field report received by ARVION",
          time: now(),
        },
        {
          id: makeId("EVENT"),
          action: "AI ANALYSIS COMPLETED",
          detail:
            "Qwen 2.5 7B structured the incident locally",
          time: now(),
        },
      ],
    };

    incidents.set(
      incidentId,
      enrichedIncident
    );


    // ========================================================
    // REAL-TIME BROADCAST
    // ========================================================

    io.emit(
      "newIncident",
      publicIncident(enrichedIncident)
    );


    res.json({
      success: true,
      incident: enrichedIncident,
    });

  } catch (error) {
    console.error(
      "ARVION ANALYSIS ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ============================================================
// INCIDENT LIST
// ============================================================

app.get("/api/incidents", (req, res) => {
  res.json({
    success: true,
    incidents: Array.from(incidents.values()).reverse(),
  });
});


// ============================================================
// INCIDENT STATUS UPDATE
// NEW
// ACKNOWLEDGED
// RESPONDING
// RESOLVED
// ============================================================

app.post(
  "/api/incidents/:id/status",
  (req, res) => {
    const incident =
      incidents.get(req.params.id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        error: "Incident not found.",
      });
    }

    const { status } = req.body;

    const allowed = [
      "NEW",
      "ACKNOWLEDGED",
      "RESPONDING",
      "RESOLVED",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid incident status.",
      });
    }

    incident.status = status;

    const details = {
      NEW: "Incident created",
      ACKNOWLEDGED:
        "Control room acknowledged the incident",
      RESPONDING:
        "Response operation started",
      RESOLVED:
        "Incident marked resolved by operator",
    };

    incident.timeline =
      incident.timeline || [];

    incident.timeline.push({
      id: makeId("EVENT"),
      action: `STATUS → ${status}`,
      detail: details[status],
      time: now(),
    });

    incidents.set(
      incident.id,
      incident
    );

    broadcastIncident(incident);

    res.json({
      success: true,
      incident,
    });
  }
);


// ============================================================
// TEAM ASSIGNMENT
// ============================================================

app.post(
  "/api/incidents/:id/assign",
  (req, res) => {
    const incident =
      incidents.get(req.params.id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        error: "Incident not found.",
      });
    }

    const {
      teamId,
      teamName,
      zone,
    } = req.body;

    if (!teamId) {
      return res.status(400).json({
        success: false,
        error: "Team ID is required.",
      });
    }

    incident.assignedTeam = {
      id: teamId,
      name:
        teamName ||
        teamId,
      zone: zone || null,
    };

    incident.status = "RESPONDING";

    incident.timeline =
      incident.timeline || [];

    incident.timeline.push({
      id: makeId("EVENT"),
      action: "TEAM ASSIGNED",
      detail:
        `${incident.assignedTeam.name}` +
        (zone ? ` · ${zone}` : ""),
      time: now(),
    });

    incident.timeline.push({
      id: makeId("EVENT"),
      action: "STATUS → RESPONDING",
      detail:
        "Response operation started",
      time: now(),
    });

    incidents.set(
      incident.id,
      incident
    );

    broadcastIncident(incident);

    res.json({
      success: true,
      incident,
    });
  }
);


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

    const context =
      retrieveSOP(question);

    if (!context) {
      return res.json({
        success: true,
        answer:
          "The available SOP does not provide enough information.",
        source:
          "ARVION Event Safety SOP",
      });
    }

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

    const ollamaResponse =
      await fetch(
        `${OLLAMA_URL}/api/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            model: MODEL_NAME,
            prompt,
            stream: false,
            format: "json",
          }),
        }
      );

    if (!ollamaResponse.ok) {
      throw new Error(
        "Ollama request failed"
      );
    }

    const data =
      await ollamaResponse.json();

    let answer;

    try {
      answer = JSON.parse(
        data.response
      );
    } catch {
      throw new Error(
        "Ollama returned invalid JSON."
      );
    }

    res.json({
      success: true,
      answer: answer.answer,
      source: answer.source,
    });

  } catch (error) {
    console.error(
      "ARVION RAG ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ============================================================
// SOCKET.IO
// ============================================================

io.on("connection", (socket) => {
  console.log(
    `📡 Socket connected: ${socket.id}`
  );


  // ----------------------------------------------------------
  // Send current state immediately
  // ----------------------------------------------------------

  socket.emit(
    "devicesUpdated",
    getDevices()
  );

  socket.emit(
    "incidentSnapshot",
    Array.from(
      incidents.values()
    ).reverse()
  );


  // ----------------------------------------------------------
  // DEVICE REGISTRATION / CONNECTION
  // ----------------------------------------------------------

  socket.on(
    "registerDevice",
    (payload = {}) => {
      const {
        id,
        name,
        role,
        team,
        mode,
      } = payload;

      const deviceId =
        id ||
        makeId(
          mode === "FIELD"
            ? "FIELD"
            : "CONTROL"
        );

      let device =
        devices.get(deviceId);

      if (!device) {
        device = {
          id: deviceId,
          name:
            name ||
            "Unknown Device",
          role:
            role ||
            "Unknown",
          team:
            team ||
            "Unassigned",
          mode:
            mode ||
            "FIELD",
          status:
            mode === "CONTROL"
              ? "CONNECTED"
              : "PENDING",
          socketId:
            socket.id,
          joinedAt: now(),
          verifiedAt: null,
          rejectedAt: null,
          lastSeenAt: now(),
        };
      } else {
        device.socketId =
          socket.id;

        device.lastSeenAt =
          now();

        if (
          device.status ===
          "VERIFIED"
        ) {
          device.status =
            "CONNECTED";
        }
      }

      devices.set(
        deviceId,
        device
      );

      socket.data.deviceId =
        deviceId;

      emitDeviceUpdate(device);
      broadcastDevices();

      if (
        device.mode ===
        "FIELD" &&
        device.status ===
        "PENDING"
      ) {
        io.emit(
          "fieldJoinRequest",
          sanitizeDevice(device)
        );
      }

      if (
        device.status ===
          "CONNECTED" ||
        device.status ===
          "VERIFIED"
      ) {
        socket.emit(
          "verificationResult",
          {
            approved: true,
            device:
              sanitizeDevice(
                device
              ),
          }
        );
      }
    }
  );


  // ----------------------------------------------------------
  // FIELD HEARTBEAT
  // ----------------------------------------------------------

  socket.on(
    "deviceHeartbeat",
    () => {
      const deviceId =
        socket.data.deviceId;

      if (!deviceId) return;

      const device =
        devices.get(deviceId);

      if (!device) return;

      device.lastSeenAt =
        now();

      if (
        device.status ===
        "VERIFIED"
      ) {
        device.status =
          "CONNECTED";
      }

      devices.set(
        deviceId,
        device
      );

      emitDeviceUpdate(device);
    }
  );


  // ----------------------------------------------------------
  // DISCONNECT
  // ----------------------------------------------------------

  socket.on(
    "disconnect",
    () => {
      const deviceId =
        socket.data.deviceId;

      if (deviceId) {
        const device =
          devices.get(deviceId);

        if (device) {
          device.socketId =
            null;

          device.lastSeenAt =
            now();

          if (
            device.status ===
              "CONNECTED" ||
            device.status ===
              "VERIFIED"
          ) {
            device.status =
              "DISCONNECTED";
          }

          devices.set(
            deviceId,
            device
          );

          io.emit(
            "deviceLeft",
            sanitizeDevice(
              device
            )
          );

          broadcastDevices();
        }
      }

      console.log(
        `📴 Socket disconnected: ${socket.id}`
      );
    }
  );
});


// ============================================================
// START SERVER
// ============================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    const network =
      getNetworkInfo();

    console.log(`
╔══════════════════════════════════════════════╗
║              ARVION CONTROL ROOM             ║
║                                              ║
║  Server: http://localhost:${PORT}              ║
║  LAN:    ${network.lan}:${PORT}              ║
║  AI:     Ollama + ${MODEL_NAME}              ║
║  Socket: LIVE                                ║
║  RAG:    SOP INTELLIGENCE                    ║
║                                              ║
║  Join token: ${JOIN_TOKEN}                  ║
║  Field URL: ${network.joinUrl}              ║
║                                              ║
║  Status: ONLINE                              ║
╚══════════════════════════════════════════════╝
`);
  }
);