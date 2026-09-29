import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const LOCAL_HOST_PATTERN = /^(localhost|127\.0.0.1|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/;
const isPublicShowcase = typeof window !== "undefined" && !LOCAL_HOST_PATTERN.test(window.location.hostname);
const API = isPublicShowcase
  ? null
  : `${window.location.protocol}//${window.location.hostname}:5000`;
const socket = API ? io(API, { autoConnect: true, transports: ["websocket", "polling"] }) : null;

/* ============================================================
   LOCAL OFFLINE EVENT MAP
   No OpenStreetMap
   No external tiles
   No internet required
   ============================================================ */

function LocalEventMap({ incidents, zoneMemory = [] }) {
  const positions = {
    "Gate 1": { x: 12, y: 28 },
    "Gate 2": { x: 88, y: 28 },
    "Gate 3": { x: 50, y: 88 },
    "Medical Zone": { x: 78, y: 72 },
    "Control Center": { x: 50, y: 50 },
  };

  const getZoneRisk = (zone) => {
    const match = zoneMemory.find((item) => item.zone === zone);
    return match?.risk || "LOW";
  };

  return (
    <div className="local-map">
      <div className="map-grid" />

      <div className="map-title">
        ARVION EVENT ZONE — OFFLINE MAP
      </div>

      <div className="map-road road-vertical" />
      <div className="map-road road-horizontal" />

      <div className="venue">
        <div className="venue-label">
          MAIN EVENT AREA
        </div>
      </div>

      <div className="zone zone-a">ZONE A</div>
      <div className="zone zone-b">ZONE B</div>

      {Object.entries(positions).map(([name, pos]) => {
        const risk = getZoneRisk(name);

        return (
          <div
            key={name}
            className={`map-location ${
              name === "Control Center"
                ? "control-location"
                : ""
            }`}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
            }}
          >
            <div
              className={`location-dot risk-${risk.toLowerCase()}`}
            />

            <span>
              {name}
              {name !== "Control Center" && (
                <small className={`map-risk-label risk-${risk.toLowerCase()}`}>
                  {risk}
                </small>
              )}
            </span>
          </div>
        );
      })}

      {incidents.map((item) => {
        const location =
          item.coordinates?.label ||
          item.location ||
          "";

        const match = Object.keys(positions).find((key) =>
          location
            .toLowerCase()
            .includes(key.toLowerCase())
        );

        if (!match) return null;

        const pos = positions[match];

        const severity =
          (item.severity || "MEDIUM").toUpperCase();

        return (
          <div
            key={`incident-${item.id}`}
            className={`incident-marker incident-${severity.toLowerCase()}`}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
            }}
            title={`${severity} — ${item.type}`}
          >
            !
          </div>
        );
      })}

      <div className="offline-map-label">
        ● LOCAL DATA · NO INTERNET REQUIRED
      </div>
    </div>
  );
}

function App() {
  const [report, setReport] = useState("");
  const [incident, setIncident] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  // RAG / SOP state
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);

  // Voice recognition state
  const [listening, setListening] = useState(false);
  const [voiceLanguage, setVoiceLanguage] =
    useState("en-IN");

  const recognitionRef = useRef(null);

  /* ============================================================
     RESPONSE TEAMS / OPERATIONS
     Local demo roster — no external database required.
     ============================================================ */

  const responseTeams = [
    {
      id: "SEC-A",
      name: "Security Alpha",
      zone: "Gate 1",
      status: "AVAILABLE",
      role: "SECURITY",
    },
    {
      id: "SEC-B",
      name: "Security Bravo",
      zone: "Gate 2",
      status: "RESPONDING",
      role: "SECURITY",
    },
    {
      id: "MED-1",
      name: "Medical Team",
      zone: "Medical Zone",
      status: "AVAILABLE",
      role: "MEDICAL",
    },
    {
      id: "CROWD-1",
      name: "Crowd Control",
      zone: "Gate 3",
      status: "AVAILABLE",
      role: "CROWD CONTROL",
    },
  ];

  const [incidentStatuses, setIncidentStatuses] = useState({});
  const [assignedTeams, setAssignedTeams] = useState({});
  const [incidentLogs, setIncidentLogs] = useState({});
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [ollamaOnline, setOllamaOnline] = useState(null);
  const [publicNotice, setPublicNotice] = useState(null);
  const [fieldMode, setFieldMode] = useState(false);
  const [joinQr, setJoinQr] = useState("");
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [deviceName, setDeviceName] = useState("Control Center");
  const [fieldProfile, setFieldProfile] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("arvionFieldProfile") || "null");
    } catch {
      return null;
    }
  });
  const [fieldJoinStatus, setFieldJoinStatus] = useState("NOT_REGISTERED");
  const [fieldJoinError, setFieldJoinError] = useState("");
  const [fieldJoinLoading, setFieldJoinLoading] = useState(false);
  const [fieldJoinToken, setFieldJoinToken] = useState("");
  const [fieldDevices, setFieldDevices] = useState([]);
  const [serverHealth, setServerHealth] = useState(null);
  const [joinUrl, setJoinUrl] = useState("");

  const addIncidentLog = (incidentId, action, detail = "") => {
    setIncidentLogs((prev) => ({
      ...prev,
      [incidentId]: [
        ...(prev[incidentId] || []),
        {
          id: `${incidentId}-${Date.now()}-${Math.random()}`,
          time: new Date().toISOString(),
          action,
          detail,
        },
      ],
    }));
  };

  const initializeIncidentLog = (newIncident) => {
    setIncidentLogs((prev) => {
      if (prev[newIncident.id]) return prev;

      return {
        ...prev,
        [newIncident.id]: [
          {
            id: `${newIncident.id}-detected`,
            time: newIncident.timestamp || new Date().toISOString(),
            action: "INCIDENT DETECTED",
            detail: "Field report received",
          },
          {
            id: `${newIncident.id}-analysis`,
            time: new Date().toISOString(),
            action: "AI ANALYSIS COMPLETED",
            detail: "ARVION structured the incident report",
          },
        ],
      };
    });
  };

  const getIncidentStatus = (id) =>
    incidentStatuses[id] || "NEW";

  const updateIncidentStatus = (id, status) => {
    setIncidentStatuses((prev) => ({
      ...prev,
      [id]: status,
    }));

    const statusDetails = {
      ACKNOWLEDGED: "Control room acknowledged the incident",
      RESPONDING: "Response operation started",
      RESOLVED: "Incident marked resolved by operator",
    };

    addIncidentLog(
      id,
      `STATUS → ${status}`,
      statusDetails[status] || "Incident status updated"
    );
  };

  const assignTeam = (incidentId, teamId) => {
    if (!teamId) return;

    const team = responseTeams.find(
      (item) => item.id === teamId
    );

    setAssignedTeams((prev) => ({
      ...prev,
      [incidentId]: teamId,
    }));

    addIncidentLog(
      incidentId,
      "TEAM ASSIGNED",
      team
        ? `${team.name} · ${team.zone}`
        : "Response team assigned"
    );

    updateIncidentStatus(incidentId, "RESPONDING");
  };

  const getAssignedTeam = (incidentId) =>
    responseTeams.find(
      (team) => team.id === assignedTeams[incidentId]
    );

  /* ============================================================
     LOCAL / PUBLIC MODE + QR JOIN
     ============================================================ */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isField = params.get("mode") === "field";
    const token = params.get("token") || "";

    setFieldMode(isField);
    setFieldJoinToken(token);

    if (isField) {
      setDeviceName(fieldProfile?.name || "Field Device");
      if (fieldProfile?.status) {
        setFieldJoinStatus(fieldProfile.status);
      }
    } else {
      setDeviceName("Control Center");
    }
  }, [fieldProfile]);

  useEffect(() => {
    if (isPublicShowcase || !API || fieldMode) return;

    let cancelled = false;

    const loadJoinInfo = async () => {
      try {
        const response = await fetch(`${API}/api/join`);
        const data = await response.json();

        if (!data.success) throw new Error(data.error || "Unable to get join information");

        const url = data.joinUrl || `${window.location.origin}${window.location.pathname}?mode=field&token=${data.token}`;

        if (!cancelled) {
          setJoinUrl(url);
          setFieldJoinToken(data.token || "");
        }

        const { default: QRCode } = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });

        if (!cancelled) setJoinQr(dataUrl);
      } catch (error) {
        console.error("Unable to generate ARVION join QR:", error);
        if (!cancelled) {
          setJoinQr("");
          setJoinUrl("");
        }
      }
    };

    loadJoinInfo();

    return () => { cancelled = true; };
  }, [fieldMode]);

  /* ============================================================
     SOCKET.IO
     ============================================================ */

  useEffect(() => {
    if (!socket) {
      setConnected(false);
      return undefined;
    }

    const onConnect = () => {
      console.log("📡 Connected to ARVION live network");
      setConnected(true);

      if (fieldMode && fieldProfile?.deviceId) {
        socket.emit("registerDevice", {
          id: fieldProfile.deviceId,
          name: fieldProfile.name,
          role: fieldProfile.role,
          team: fieldProfile.team,
          mode: "FIELD",
          joinedAt: fieldProfile.joinedAt || new Date().toISOString(),
        });
      } else if (!fieldMode) {
        socket.emit("registerDevice", {
          id: "CONTROL-CENTER",
          name: "Control Center",
          role: "COMMANDER",
          team: "CONTROL ROOM",
          mode: "CONTROL",
          joinedAt: new Date().toISOString(),
        });
      }
    };

    const onDisconnect = () => {
      console.log("📴 Disconnected from ARVION live network");
      setConnected(false);
    };

    const onNewIncident = (newIncident) => {
      setIncidents((prev) => {
        const exists = prev.some((item) => item.id === newIncident.id);
        if (exists) return prev;
        return [newIncident, ...prev];
      });
      setIncident(newIncident);
      initializeIncidentLog(newIncident);
    };

    const onDeviceJoined = (device) => {
      setConnectedDevices((prev) => {
        const withoutOld = prev.filter((item) => item.id !== device.id);
        return [...withoutOld, device];
      });
    };

    const onDevicesUpdated = (devices) => {
      setFieldDevices(Array.isArray(devices) ? devices : []);
      if (!fieldMode) setConnectedDevices(Array.isArray(devices) ? devices : []);

      if (fieldMode && fieldProfile?.deviceId) {
        const own = devices?.find((item) => item.id === fieldProfile.deviceId);
        if (own) {
          setFieldJoinStatus(own.status);
          setFieldProfile((prev) => prev ? ({ ...prev, status: own.status }) : prev);
        }
      }
    };

    const onFieldJoinRequest = (device) => {
      setFieldDevices((prev) => {
        const withoutOld = prev.filter((item) => item.id !== device.id);
        return [...withoutOld, device];
      });
    };

    const onDeviceUpdated = (device) => {
      setFieldDevices((prev) => {
        const withoutOld = prev.filter((item) => item.id !== device.id);
        return [...withoutOld, device];
      });

      if (fieldMode && fieldProfile?.deviceId === device.id) {
        setFieldJoinStatus(device.status);
        setFieldProfile((prev) => prev ? ({ ...prev, status: device.status }) : prev);
      }
    };

    const onVerificationResult = (result) => {
      if (!fieldMode || !result?.device) return;

      const nextStatus = result.approved
        ? result.device.status
        : result.revoked
          ? "REVOKED"
          : "REJECTED";

      setFieldJoinStatus(nextStatus);
      setFieldProfile((prev) => {
        if (!prev) return prev;
        const next = { ...prev, status: nextStatus };
        localStorage.setItem("arvionFieldProfile", JSON.stringify(next));
        return next;
      });
    };

    const onIncidentSnapshot = (items) => {
      if (!Array.isArray(items)) return;
      setIncidents(items);
      if (items[0]) setIncident(items[0]);
      items.forEach(initializeIncidentLog);
    };

    const onIncidentUpdated = (updated) => {
      if (!updated?.id) return;
      setIncidents((prev) => {
        const exists = prev.some((item) => item.id === updated.id);
        return exists
          ? prev.map((item) => item.id === updated.id ? updated : item)
          : [updated, ...prev];
      });

      setIncident((prev) => prev?.id === updated.id ? updated : prev);

      if (updated.status) {
        setIncidentStatuses((prev) => ({ ...prev, [updated.id]: updated.status }));
      }

      if (updated.assignedTeam?.id) {
        setAssignedTeams((prev) => ({ ...prev, [updated.id]: updated.assignedTeam.id }));
      }

      if (Array.isArray(updated.timeline)) {
        setIncidentLogs((prev) => ({
          ...prev,
          [updated.id]: updated.timeline.map((log) => ({
            id: log.id || `${updated.id}-${log.time}`,
            time: log.time,
            action: log.action,
            detail: log.detail || "",
          })),
        }));
      }
    };

    const onDeviceLeft = (device) => {
      setConnectedDevices((prev) => prev.map((item) => item.id === device.id ? device : item));
      setFieldDevices((prev) => prev.map((item) => item.id === device.id ? device : item));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("newIncident", onNewIncident);
    socket.on("deviceJoined", onDeviceJoined);
    socket.on("devicesUpdated", onDevicesUpdated);
    socket.on("fieldJoinRequest", onFieldJoinRequest);
    socket.on("deviceUpdated", onDeviceUpdated);
    socket.on("verificationResult", onVerificationResult);
    socket.on("incidentSnapshot", onIncidentSnapshot);
    socket.on("incidentUpdated", onIncidentUpdated);
    socket.on("deviceLeft", onDeviceLeft);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("newIncident", onNewIncident);
      socket.off("deviceJoined", onDeviceJoined);
      socket.off("devicesUpdated", onDevicesUpdated);
      socket.off("fieldJoinRequest", onFieldJoinRequest);
      socket.off("deviceUpdated", onDeviceUpdated);
      socket.off("verificationResult", onVerificationResult);
      socket.off("incidentSnapshot", onIncidentSnapshot);
      socket.off("incidentUpdated", onIncidentUpdated);
      socket.off("deviceLeft", onDeviceLeft);
    };
  }, [deviceName, fieldMode, fieldProfile?.deviceId, fieldProfile?.name, fieldProfile?.role, fieldProfile?.team]);

  const registerFieldDevice = async (event) => {
    event?.preventDefault();

    if (!API) {
      setPublicNotice("analyze");
      return;
    }

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const role = String(form.get("role") || "").trim();
    const team = String(form.get("team") || "").trim();

    if (!name || !role || !team) {
      setFieldJoinError("Name, role and team are required.");
      return;
    }

    setFieldJoinLoading(true);
    setFieldJoinError("");

    const deviceId = fieldProfile?.deviceId || `FIELD-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const profile = {
      deviceId,
      name,
      role,
      team,
      status: "PENDING",
      joinedAt: fieldProfile?.joinedAt || new Date().toISOString(),
    };

    try {
      const response = await fetch(`${API}/api/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: fieldJoinToken,
          deviceId,
          name,
          role,
          team,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Registration failed.");
      }

      const saved = {
        ...profile,
        status: data.device?.status || "PENDING",
      };

      localStorage.setItem("arvionFieldProfile", JSON.stringify(saved));
      setFieldProfile(saved);
      setFieldJoinStatus(saved.status);

      if (saved.status === "VERIFIED" || saved.status === "CONNECTED") {
        setFieldJoinStatus("CONNECTED");
      }
    } catch (error) {
      setFieldJoinError(error.message);
    } finally {
      setFieldJoinLoading(false);
    }
  };

  const refreshDevices = async () => {
    if (!API || fieldMode) return;

    try {
      const response = await fetch(`${API}/api/devices`);
      const data = await response.json();
      if (data.success) setFieldDevices(data.devices || []);
    } catch (error) {
      console.error("Device refresh failed:", error);
    }
  };

  const verifyFieldDevice = async (id) => {
    if (!API) return;
    try {
      await fetch(`${API}/api/devices/${encodeURIComponent(id)}/verify`, { method: "POST" });
      refreshDevices();
    } catch (error) {
      console.error(error);
    }
  };

  const rejectFieldDevice = async (id) => {
    if (!API) return;
    try {
      await fetch(`${API}/api/devices/${encodeURIComponent(id)}/reject`, { method: "POST" });
      refreshDevices();
    } catch (error) {
      console.error(error);
    }
  };

  const revokeFieldDevice = async (id) => {
    if (!API) return;
    try {
      await fetch(`${API}/api/devices/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      refreshDevices();
    } catch (error) {
      console.error(error);
    }
  };

  const disconnectFieldProfile = () => {
    localStorage.removeItem("arvionFieldProfile");
    setFieldProfile(null);
    setFieldJoinStatus("NOT_REGISTERED");
    setFieldJoinError("");
  };

  /* ============================================================
     VOICE RECOGNITION
     ============================================================ */

  const startVoiceRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(
        "Voice recognition is not supported in this browser. Please use Google Chrome."
      );

      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = voiceLanguage;

    // Listen for one incident at a time
    recognition.continuous = false;

    // Show partial speech while speaking
    recognition.interimResults = true;

    recognition.onstart = () => {
      console.log("🎙 Voice recognition started");
      setListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        transcript +=
          event.results[i][0].transcript;
      }

      setReport(transcript);
    };

    recognition.onerror = (event) => {
      console.error(
        "Voice recognition error:",
        event.error
      );

      setListening(false);

      if (event.error === "not-allowed") {
        alert(
          "Microphone permission was denied. Please allow microphone access in Chrome."
        );
      } else if (event.error === "no-speech") {
        console.log("No speech detected.");
      }
    };

    recognition.onend = () => {
      console.log("🎙 Voice recognition ended");
      setListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error(
        "Unable to start voice recognition:",
        error
      );

      setListening(false);
    }
  };

  /* ============================================================
     INCIDENT ANALYSIS
     ============================================================ */

  const analyzeIncident = async () => {
    if (!report.trim()) return;

    if (isPublicShowcase || !API) {
      setPublicNotice("analyze");
      return;
    }

    if (fieldMode && (!fieldProfile?.deviceId || !["VERIFIED", "CONNECTED"].includes(fieldJoinStatus))) {
      setFieldJoinError("This field device must be verified by the control room before reporting.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API}/api/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            report,
            deviceId: fieldMode ? fieldProfile?.deviceId : "CONTROL-CENTER",
            reporter: fieldMode ? {
              name: fieldProfile?.name,
              role: fieldProfile?.role,
              team: fieldProfile?.team,
            } : {
              name: "Control Center",
              role: "COMMANDER",
              team: "CONTROL ROOM",
            },
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(
          data.error || "Analysis failed"
        );
      }

      setIncident(data.incident);
      initializeIncidentLog(data.incident);
      setReport("");
    } catch (error) {
      console.error(error);

      alert(
        `ARVION error: ${error.message}`
      );
    } finally {
      setLoading(false);
    }
  };

  /* ============================================================
     ASK ARVION / SOP RAG
     ============================================================ */

  const askArvion = async () => {
    if (!question.trim()) return;

    if (isPublicShowcase || !API) {
      setPublicNotice("rag");
      return;
    }

    setAsking(true);
    setAnswer(null);

    try {
      const response = await fetch(
        `${API}/api/ask`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(
          data.error ||
            "Unable to get ARVION answer"
        );
      }

      setAnswer({
        answer: data.answer,
        source: data.source,
      });
    } catch (error) {
      console.error(error);

      setAnswer({
        answer: `ARVION error: ${error.message}`,
        source: "System",
      });
    } finally {
      setAsking(false);
    }
  };

  /* ============================================================
     QUICK SOP QUESTIONS
     ============================================================ */

  const quickQuestion = (text) => {
    setQuestion(text);
  };

  const submitFieldReport = (text) => {
    const value = text.trim();
    if (!value) return;
    setReport(value);
    if (!isPublicShowcase && API) {
      setTimeout(() => {
        const button = document.querySelector(".field-submit-btn");
        if (button) button.click();
      }, 0);
    } else {
      setPublicNotice("analyze");
    }
  };

  /* ============================================================
     HELPERS
     ============================================================ */

  const severityClass = (severity) =>
    (severity || "medium").toLowerCase();

  const formatType = (type) =>
    (type || "Incident").replaceAll(
      "_",
      " "
    );

  /* ============================================================
     SYSTEM HEALTH
     ============================================================ */

  useEffect(() => {
    let active = true;

    const checkOllama = async () => {
      if (isPublicShowcase) {
        if (active) setOllamaOnline(null);
        return;
      }
      try {
        const response = await fetch(`${API}/api/health`);
        const data = await response.json();

        if (active) {
          setOllamaOnline(Boolean(data?.health?.ollama));
          setServerHealth(data?.health || null);
        }
      } catch {
        if (active) {
          setOllamaOnline(false);
        }
      }
    };

    checkOllama();

    const timer = setInterval(checkOllama, 10000);

    return () => {
      clearInterval(timer);
      active = false;
    };
  }, []);

  useEffect(() => {
    if (fieldMode || isPublicShowcase) return undefined;
    refreshDevices();
    return undefined;
  }, [fieldMode]);

  /* ============================================================
     DEMO MODE
     ============================================================ */

  const resetDemo = () => {
    setIncidents([]);
    setIncident(null);
    setIncidentStatuses({});
    setAssignedTeams({});
    setIncidentLogs({});
    setReport("");
    setDemoRunning(false);
    setDemoStep(0);
  };

  const runLiveDemo = async () => {
    if (demoRunning) return;

    resetDemo();
    setDemoRunning(true);
    setDemoStep(1);

    const demoIncident = {
      id: `demo-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "Crowd Pressure",
      severity: "HIGH",
      location: "Gate 3",
      description:
        "Crowd pressure is increasing near Gate 3 and several people are struggling to move.",
      recommended_action:
        "Slow additional entry, deploy trained crowd-management personnel, and keep emergency routes clear.",
      coordinates: {
        lat: 17.4055,
        lng: 78.4782,
        label: "Gate 3",
      },
    };

    setIncidents([
      demoIncident,
    ]);
    setIncident(
      demoIncident
    );

    setIncidentLogs({
      [demoIncident.id]: [
        {
          id: `${demoIncident.id}-1`,
          time: new Date().toISOString(),
          action: "INCIDENT DETECTED",
          detail:
            "Demo field report received",
        },
        {
          id: `${demoIncident.id}-2`,
          time: new Date().toISOString(),
          action: "AI ANALYSIS COMPLETED",
          detail:
            "ARVION structured the incident locally",
        },
      ],
    });

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 1200)
    );

    setDemoStep(2);
    setIncidentStatuses({
      [demoIncident.id]:
        "ACKNOWLEDGED",
    });

    setIncidentLogs(
      (prev) => ({
        ...prev,
        [demoIncident.id]: [
          ...(prev[demoIncident.id] ||
            []),
          {
            id: `${demoIncident.id}-3`,
            time: new Date().toISOString(),
            action:
              "STATUS → ACKNOWLEDGED",
            detail:
              "Control room acknowledged the incident",
          },
        ],
      })
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 1200)
    );

    setDemoStep(3);
    setAssignedTeams({
      [demoIncident.id]:
        "CROWD-1",
    });

    setIncidentStatuses({
      [demoIncident.id]:
        "RESPONDING",
    });

    setIncidentLogs(
      (prev) => ({
        ...prev,
        [demoIncident.id]: [
          ...(prev[demoIncident.id] ||
            []),
          {
            id: `${demoIncident.id}-4`,
            time: new Date().toISOString(),
            action: "TEAM ASSIGNED",
            detail:
              "Crowd Control · Gate 3",
          },
          {
            id: `${demoIncident.id}-5`,
            time: new Date().toISOString(),
            action:
              "STATUS → RESPONDING",
            detail:
              "Response operation started",
          },
        ],
      })
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 1500)
    );

    setDemoStep(4);
    setIncidentStatuses({
      [demoIncident.id]:
        "RESOLVED",
    });

    setIncidentLogs(
      (prev) => ({
        ...prev,
        [demoIncident.id]: [
          ...(prev[demoIncident.id] ||
            []),
          {
            id: `${demoIncident.id}-6`,
            time: new Date().toISOString(),
            action:
              "STATUS → RESOLVED",
            detail:
              "Demo incident resolved by operator",
          },
        ],
      })
    );

    setDemoStep(5);

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 700)
    );

    setDemoRunning(false);
  };

  /* ============================================================
     EVENT ANALYTICS
     ============================================================ */

  const totalIncidents = incidents.length;

  const criticalIncidents = incidents.filter(
    (item) =>
      (item.severity || "").toUpperCase() === "CRITICAL"
  ).length;

  const highIncidents = incidents.filter(
    (item) =>
      (item.severity || "").toUpperCase() === "HIGH"
  ).length;

  const resolvedIncidents = incidents.filter(
    (item) =>
      getIncidentStatus(item.id) === "RESOLVED"
  ).length;

  const openIncidents =
    totalIncidents - resolvedIncidents;

  const assignedIncidentCount = Object.keys(
    assignedTeams
  ).length;

  const responseTimes = incidents
    .map((item) => {
      const logs = incidentLogs[item.id] || [];
      const detected = logs.find(
        (log) =>
          log.action === "INCIDENT DETECTED"
      );
      const responding = logs.find(
        (log) =>
          log.action === "STATUS → RESPONDING"
      );

      if (!detected || !responding) return null;

      const seconds =
        (new Date(responding.time) -
          new Date(detected.time)) /
        1000;

      return seconds >= 0 ? seconds : null;
    })
    .filter((value) => value !== null);

  const averageResponseSeconds =
    responseTimes.length > 0
      ? Math.round(
          responseTimes.reduce(
            (sum, value) => sum + value,
            0
          ) / responseTimes.length
        )
      : 0;

  const formatDuration = (seconds) => {
    if (!seconds) return "—";

    const minutes = Math.floor(
      seconds / 60
    );

    const remainingSeconds =
      seconds % 60;

    if (minutes === 0) {
      return `${remainingSeconds}s`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  };

  const incidentTypeCounts = incidents.reduce(
    (counts, item) => {
      const type = formatType(
        item.type
      );

      counts[type] =
        (counts[type] || 0) + 1;

      return counts;
    },
    {}
  );

  const analyticsTypes = Object.entries(
    incidentTypeCounts
  ).sort((a, b) => b[1] - a[1]);

  /* ============================================================
     EVENT MEMORY + RISK AWARENESS
     Client-side intelligence only.
     Does NOT change the backend or incident API.
     ============================================================ */

  const normalizeLocation = (location) => {
    const value = (location || "").toLowerCase();

    if (value.includes("gate 1")) return "Gate 1";
    if (value.includes("gate 2")) return "Gate 2";
    if (value.includes("gate 3")) return "Gate 3";
    if (value.includes("medical")) return "Medical Zone";

    return location || "Unknown";
  };

  const riskZones = [
    "Gate 1",
    "Gate 2",
    "Gate 3",
    "Medical Zone",
  ];

  const zoneMemory = riskZones.map((zone) => {
    const zoneIncidents = incidents.filter(
      (item) => normalizeLocation(item.location) === zone
    );

    const highCount = zoneIncidents.filter((item) =>
      ["HIGH", "CRITICAL"].includes(
        (item.severity || "").toUpperCase()
      )
    ).length;

    const crowdCount = zoneIncidents.filter((item) =>
      formatType(item.type).toLowerCase().includes("crowd")
    ).length;

    let risk = "LOW";

    if (highCount >= 2 || zoneIncidents.length >= 3) {
      risk = "HIGH";
    } else if (highCount >= 1 || zoneIncidents.length >= 2) {
      risk = "ELEVATED";
    }

    return {
      zone,
      incidents: zoneIncidents.length,
      highCount,
      crowdCount,
      risk,
    };
  });

  const activeRiskZones = zoneMemory.filter(
    (item) => item.risk !== "LOW"
  );

  const repeatedPatterns = Object.values(
    incidents.reduce((groups, item) => {
      const zone = normalizeLocation(item.location);
      const type = formatType(item.type);
      const key = `${zone}::${type}`;

      if (!groups[key]) {
        groups[key] = {
          key,
          zone,
          type,
          count: 0,
          latestSeverity: item.severity || "MEDIUM",
        };
      }

      groups[key].count += 1;

      const severityRank = {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        CRITICAL: 4,
      };

      if (
        (severityRank[(item.severity || "").toUpperCase()] || 0) >
        (severityRank[(groups[key].latestSeverity || "").toUpperCase()] || 0)
      ) {
        groups[key].latestSeverity = item.severity;
      }

      return groups;
    }, {})
  )
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count);

  const memoryHeadline =
    repeatedPatterns.length > 0
      ? `${repeatedPatterns[0].type} repeated at ${repeatedPatterns[0].zone}`
      : activeRiskZones.length > 0
        ? `${activeRiskZones[0].zone} is showing elevated activity`
        : "No repeated incident pattern detected yet";

  /* ============================================================
     EVENT REPORT
     ============================================================ */

  const generateEventReport = () => {
    if (incidents.length === 0) {
      alert(
        "No incidents have been recorded yet."
      );
      return;
    }

    const reportLines = [
      "ARVION EVENT INCIDENT REPORT",
      "================================",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      "EVENT OVERVIEW",
      "--------------",
      `Total Incidents: ${totalIncidents}`,
      `Critical: ${criticalIncidents}`,
      `High: ${highIncidents}`,
      `Resolved: ${resolvedIncidents}`,
      `Open: ${openIncidents}`,
      `Teams Assigned: ${assignedIncidentCount}`,
      `Average Response Time: ${formatDuration(
        averageResponseSeconds
      )}`,
      "",
      "INCIDENT BREAKDOWN",
      "------------------",
    ];

    analyticsTypes.forEach(
      ([type, count]) => {
        reportLines.push(
          `${type}: ${count}`
        );
      }
    );

    reportLines.push(
      "",
      "INCIDENT DETAILS",
      "----------------"
    );

    incidents.forEach((item, index) => {
      const team =
        getAssignedTeam(item.id);

      const logs =
        incidentLogs[item.id] || [];

      reportLines.push(
        "",
        `${index + 1}. ${formatType(
          item.type
        )}`,
        `Severity: ${item.severity}`,
        `Location: ${item.location}`,
        `Status: ${getIncidentStatus(
          item.id
        )}`,
        `Assigned Team: ${
          team ? team.name : "Unassigned"
        }`,
        `Description: ${item.description}`
      );

      if (
        item.recommended_action
      ) {
        reportLines.push(
          `Recommended Action: ${item.recommended_action}`
        );
      }

      if (logs.length > 0) {
        reportLines.push(
          "Timeline:"
        );

        logs.forEach((log) => {
          reportLines.push(
            `  ${new Date(
              log.time
            ).toLocaleTimeString()} — ${
              log.action
            } — ${log.detail}`
          );
        });
      }
    });

    reportLines.push(
      "",
      "--------------------------------",
      "Generated locally by ARVION",
      "Offline AI Control Room"
    );

    const blob = new Blob(
      [reportLines.join("\n")],
      {
        type: "text/plain;charset=utf-8",
      }
    );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download = `ARVION_Event_Report_${new Date()
      .toISOString()
      .slice(0, 10)}.txt`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  /* ============================================================
     UI
     ============================================================ */

  return (
    <div className={`app ${fieldMode ? "field-mode-app" : ""}`}>

      {fieldMode ? (
        <main className="field-shell">
          {(!fieldProfile || ["NOT_REGISTERED", "REJECTED", "REVOKED"].includes(fieldJoinStatus)) ? (
            <section className="field-device-card field-registration-card">
              <div className="field-topline">
                <div>
                  <span className="field-eyebrow">ARVION FIELD</span>
                  <h1>JOIN FIELD NETWORK</h1>
                </div>
                <span className="field-connection offline">● PENDING ACCESS</span>
              </div>

              <p className="field-subtitle">
                Register this device with the local ARVION control room. Access is granted only after commander verification.
              </p>

              <form className="field-registration-form" onSubmit={registerFieldDevice}>
                <label>VOLUNTEER NAME<input name="name" defaultValue={fieldProfile?.name || ""} placeholder="Your name" autoComplete="name" /></label>
                <label>ROLE<input name="role" defaultValue={fieldProfile?.role || ""} placeholder="Volunteer / Security / Medical" /></label>
                <label>TEAM<input name="team" defaultValue={fieldProfile?.team || ""} placeholder="Security Alpha / Medical Team" /></label>
                {fieldJoinError && <div className="field-error">{fieldJoinError}</div>}
                <button className="field-submit-btn" type="submit" disabled={fieldJoinLoading}>
                  {fieldJoinLoading ? "SENDING REQUEST..." : "REQUEST FIELD ACCESS →"}
                </button>
              </form>

              <div className="field-device-note">
                <strong>HUMAN VERIFICATION</strong>
                <span>Your request will appear in the ARVION Command Center. A commander must verify this device before it can report incidents.</span>
              </div>
            </section>
          ) : ["PENDING", "DISCONNECTED"].includes(fieldJoinStatus) ? (
            <section className="field-device-card field-pending-card">
              <div className="field-topline">
                <div>
                  <span className="field-eyebrow">ARVION FIELD</span>
                  <h1>WAITING FOR VERIFICATION</h1>
                </div>
                <span className="field-connection offline">● {fieldJoinStatus}</span>
              </div>

              <div className="field-profile-summary">
                <strong>{fieldProfile.name}</strong>
                <span>{fieldProfile.role} · {fieldProfile.team}</span>
                <small>DEVICE ID · {fieldProfile.deviceId}</small>
              </div>

              <div className="field-waiting-box">
                <div className="field-waiting-dot">●</div>
                <strong>{fieldJoinStatus === "DISCONNECTED" ? "LOCAL CONNECTION LOST" : "REQUEST SENT TO COMMAND CENTER"}</strong>
                <p>{fieldJoinStatus === "DISCONNECTED" ? "Reconnect to the same local network. Your verified device identity is retained." : "The commander must verify this device before field reporting is enabled."}</p>
              </div>

              <button type="button" className="field-secondary-btn" onClick={disconnectFieldProfile}>CHANGE DEVICE / VOLUNTEER</button>
            </section>
          ) : (
          <section className="field-device-card">
            <div className="field-topline">
              <div>
                <span className="field-eyebrow">ARVION FIELD</span>
                <h1>FIELD REPORTING UNIT</h1>
              </div>
              <span className={`field-connection ${connected ? "online" : "offline"}`}>
                ● {connected ? "CONNECTED" : "LOCAL NETWORK"}
              </span>
            </div>

            <p className="field-subtitle">
              Walkie-talkie style incident reporting for volunteers. No public internet required.
            </p>

            <button
              className={`hold-report ${listening ? "active" : ""}`}
              onClick={startVoiceRecognition}
              type="button"
            >
              <span>{listening ? "●" : "🎙"}</span>
              <strong>{listening ? "LISTENING..." : "VOICE REPORT"}</strong>
              <small>{listening ? "Speak clearly" : "Tap and report an incident"}</small>
            </button>

            <div className="field-quick-grid">
              {[
                ["🚨", "Crowd", "Crowd pressure near Gate 3."],
                ["⚕", "Medical", "Medical emergency reported near the medical zone."],
                ["🔥", "Fire", "Fire or smoke reported near the event area."],
                ["🚪", "Exit", "Emergency exit is blocked."],
              ].map(([icon, label, text]) => (
                <button key={label} type="button" onClick={() => submitFieldReport(text)}>
                  <span>{icon}</span>
                  <strong>{label}</strong>
                </button>
              ))}
            </div>

            <textarea
              className="field-textarea"
              value={report}
              onChange={(e) => setReport(e.target.value)}
              placeholder="Describe what you see..."
            />

            <div className="field-actions">
              <select value={voiceLanguage} onChange={(e) => setVoiceLanguage(e.target.value)}>
                <option value="en-IN">English</option>
                <option value="hi-IN">Hindi</option>
                <option value="te-IN">Telugu</option>
              </select>
              <button className="field-submit-btn" onClick={analyzeIncident} disabled={loading || !report.trim()}>
                {loading ? "SENDING..." : "SEND TO CONTROL →"}
              </button>
            </div>

            {incident && (
              <div className="field-last-incident">
                <span>LAST LOCAL RESPONSE</span>
                <strong>{formatType(incident.type)} · {incident.severity}</strong>
                <p>{incident.location} — {incident.description}</p>
              </div>
            )}

            <div className="field-profile-summary field-live-profile">
              <strong>{fieldProfile?.name}</strong>
              <span>{fieldProfile?.role} · {fieldProfile?.team}</span>
              <small>DEVICE ID · {fieldProfile?.deviceId} · {fieldJoinStatus}</small>
            </div>

            <div className="field-my-reports">
              <div className="field-section-title">MY REPORTS</div>
              {(incidents.filter((item) => item.reporterDeviceId === fieldProfile?.deviceId).slice(0, 5)).length === 0 ? (
                <p>No reports from this device yet.</p>
              ) : (
                incidents.filter((item) => item.reporterDeviceId === fieldProfile?.deviceId).slice(0, 5).map((item) => (
                  <div className="field-report-row" key={item.id}>
                    <div><strong>{formatType(item.type)}</strong><span>{item.location}</span></div>
                    <b>{getIncidentStatus(item.id)}</b>
                  </div>
                ))
              )}
            </div>

            <button type="button" className="field-secondary-btn" onClick={disconnectFieldProfile}>CHANGE VOLUNTEER / DEVICE</button>
          </section>
          )}
        </main>
      ) : (
      <>
      {/* ======================================================
          HEADER
          ====================================================== */}

      <header className="topbar">

        <div className="brand">

          <div className="brand-icon">
            A
          </div>

          <div>
            <h1>ARVION</h1>

            <span>
              OFFLINE AI CONTROL ROOM
            </span>
          </div>

        </div>

        <div className="system-status">

          <span
            className={`status-dot ${
              connected
                ? "connected"
                : "disconnected"
            }`}
          />

          {connected
            ? "LIVE NETWORK"
            : "CONNECTING"}

          <span className="separator">
            |
          </span>

          OLLAMA · QWEN 2.5

        </div>

      </header>


      {isPublicShowcase && (
        <div className="public-showcase-banner">
          <strong>⚠️ PUBLIC SHOWCASE</strong>
          <span>Online AI mode is currently under development. Full AI + RAG runs locally with Ollama + Qwen 2.5.</span>
        </div>
      )}

      {/* ======================================================
          DASHBOARD
          ====================================================== */}

      <main className="dashboard">

        {!isPublicShowcase && (
          <section className="join-panel">
            <div>
              <p className="eyebrow">DEVICE NETWORK</p>
              <h2>Join ARVION Field</h2>
              <p className="description">Connect volunteers to this local control node. Scan the QR from a phone connected to the same Wi-Fi hotspot.</p>
              <div className="join-url">{joinUrl || "Loading local join URL..."}</div>
              <div className="device-count">● {fieldDevices.filter((item) => ["VERIFIED", "CONNECTED"].includes(item.status)).length} VERIFIED FIELD DEVICE{fieldDevices.filter((item) => ["VERIFIED", "CONNECTED"].includes(item.status)).length === 1 ? "" : "S"}</div>
            </div>
            <div className="join-qr-wrap">
              {joinQr ? <img src={joinQr} alt="Scan to join ARVION Field" /> : <div className="qr-placeholder">QR<br/>READY</div>}
              <span>SCAN TO JOIN</span>
            </div>
          </section>
        )}

        {!isPublicShowcase && (
          <section className="field-devices-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">ACCESS CONTROL</p>
                <h2>Field Devices</h2>
              </div>
              <div className="device-count">{fieldDevices.length} REGISTERED</div>
            </div>
            <p className="description">
              Commander verification is required before a volunteer can submit incidents.
            </p>

            {fieldDevices.filter((item) => item.mode === "FIELD").length === 0 ? (
              <div className="device-empty-state">
                <strong>No field devices have requested access yet.</strong>
                <span>Scan the QR code above from a phone connected to the same local network.</span>
              </div>
            ) : (
              <>
                <div className="device-summary-strip">
                  <div className="device-summary-item">
                    <span>PENDING</span>
                    <strong>{fieldDevices.filter((item) => item.mode === "FIELD" && item.status === "PENDING").length}</strong>
                  </div>
                  <div className="device-summary-item">
                    <span>VERIFIED</span>
                    <strong>{fieldDevices.filter((item) => item.mode === "FIELD" && ["VERIFIED", "CONNECTED"].includes(item.status)).length}</strong>
                  </div>
                  <div className="device-summary-item">
                    <span>CONNECTED</span>
                    <strong>{fieldDevices.filter((item) => item.mode === "FIELD" && item.status === "CONNECTED").length}</strong>
                  </div>
                  <div className="device-summary-item">
                    <span>OFFLINE</span>
                    <strong>{fieldDevices.filter((item) => item.mode === "FIELD" && item.status === "DISCONNECTED").length}</strong>
                  </div>
                </div>

                <div className="field-device-list">
                  {fieldDevices.filter((item) => item.mode === "FIELD").map((device) => (
                    <div
                      className={`field-device-card-admin ${device.status === "PENDING" ? "pending-device-highlight" : ""}`}
                      key={device.id}
                    >
                      <div className="field-device-main">
                        <div className="field-device-header">
                          <span className="field-device-name">{device.name}</span>
                          <span className={`field-device-status ${device.status?.toLowerCase()}`}>
                            {device.status}
                          </span>
                        </div>

                        <div className="field-device-meta">
                          <span>ROLE <strong>{device.role || "FIELD VOLUNTEER"}</strong></span>
                          <span>TEAM <strong>{device.team || "UNASSIGNED"}</strong></span>
                          <span className={`connection-indicator ${device.status === "CONNECTED" ? "online" : device.status === "PENDING" ? "pending" : ""}`}>
                            {device.status === "CONNECTED" ? "CONNECTED" : device.status}
                          </span>
                        </div>

                        <div className="field-device-id">
                          DEVICE ID · {device.id}
                        </div>
                      </div>

                      <div className="field-device-actions">
                        {device.status === "PENDING" && (
                          <>
                            <button
                              type="button"
                              className="device-action-btn verify"
                              onClick={() => verifyFieldDevice(device.id)}
                            >
                              VERIFY
                            </button>
                            <button
                              type="button"
                              className="device-action-btn reject"
                              onClick={() => rejectFieldDevice(device.id)}
                            >
                              REJECT
                            </button>
                          </>
                        )}

                        {["VERIFIED", "CONNECTED", "DISCONNECTED"].includes(device.status) && (
                          <button
                            type="button"
                            className="device-action-btn revoke"
                            onClick={() => revokeFieldDevice(device.id)}
                          >
                            REVOKE
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ====================================================
            LEFT PANEL
            ==================================================== */}

        <section className="left-panel">

          {/* FIELD REPORT */}

          <div className="panel-header">

            <div>

              <p className="eyebrow">
                FIELD REPORT
              </p>

              <h2>
                Report an Incident
              </h2>

            </div>

            <div className="offline-badge">
              ● LOCAL
            </div>

          </div>

          <p className="description">
            Volunteers can report incidents in
            Telugu, Hindi or English. ARVION
            structures the report using local AI.
          </p>


          {/* INCIDENT TEXT INPUT */}

          <textarea
            value={report}
            onChange={(e) =>
              setReport(e.target.value)
            }
            placeholder="Example: Crowd pushing near Gate 3. Several people are struggling to move..."
          />


          {/* ==================================================
              VOICE CONTROLS
              ================================================== */}

          <div className="voice-controls">

            <select
              value={voiceLanguage}
              onChange={(e) =>
                setVoiceLanguage(
                  e.target.value
                )
              }
            >
              <option value="en-IN">
                English
              </option>

              <option value="hi-IN">
                Hindi
              </option>

              <option value="te-IN">
                Telugu
              </option>
            </select>

            <button
              type="button"
              className={`voice-btn ${
                listening
                  ? "recording"
                  : ""
              }`}
              onClick={
                startVoiceRecognition
              }
            >
              {listening
                ? "● LISTENING..."
                : "🎙 VOICE REPORT"}
            </button>

          </div>


          {/* QUICK REPORTS */}

          <div className="quick-reports">

            <button
              onClick={() =>
                setReport(
                  "Crowd pushing is happening near Gate 3. Several people are struggling to move."
                )
              }
            >
              Crowd pressure
            </button>

            <button
              onClick={() =>
                setReport(
                  "An elderly person has fainted near the medical zone."
                )
              }
            >
              Medical emergency
            </button>

            <button
              onClick={() =>
                setReport(
                  "Emergency exit near Gate 2 is blocked by a large crowd."
                )
              }
            >
              Blocked exit
            </button>

          </div>


          {/* ANALYZE BUTTON */}

          <button
            className="analyze-btn"
            onClick={analyzeIncident}
            disabled={
              loading ||
              !report.trim()
            }
          >
            {loading
              ? "ANALYZING WITH ARVION..."
              : "ANALYZE INCIDENT →"}
          </button>


          {/* ==================================================
              AI RESULT
              ================================================== */}

          {incident && (

            <div className="latest-result">

              <div className="result-title">

                <span>
                  AI ANALYSIS
                </span>

                <span
                  className={`severity ${severityClass(
                    incident.severity
                  )}`}
                >
                  {incident.severity}
                </span>

              </div>

              <h3>
                {formatType(
                  incident.type
                )}
              </h3>

              <p>
                <strong>
                  Location:
                </strong>{" "}
                {incident.location}
              </p>

              <p>
                {incident.description}
              </p>

              <div className="action-box">

                <span>
                  RECOMMENDED ACTION
                </span>

                <p>
                  {incident.recommended_action}
                </p>

              </div>

            </div>

          )}


          {/* ==================================================
              ASK ARVION
              ================================================== */}

          <div className="ask-panel">

            <div className="ask-header">

              <div>

                <p className="eyebrow">
                  SOP INTELLIGENCE
                </p>

                <h2>
                  Ask ARVION
                </h2>

              </div>

              <div className="rag-badge">
                RAG
              </div>

            </div>

            <p className="description">
              Ask questions about event safety
              procedures. ARVION retrieves the
              relevant local SOP and answers using
              Ollama.
            </p>

            <textarea
              className="ask-input"
              value={question}
              onChange={(e) =>
                setQuestion(e.target.value)
              }
              placeholder="Example: What should I do if there is a stampede risk?"
            />


            {/* QUICK QUESTIONS */}

            <div className="quick-reports">

              <button
                onClick={() =>
                  quickQuestion(
                    "What should I do if there is a stampede risk?"
                  )
                }
              >
                Stampede risk
              </button>

              <button
                onClick={() =>
                  quickQuestion(
                    "What should I do during a medical emergency?"
                  )
                }
              >
                Medical emergency
              </button>

              <button
                onClick={() =>
                  quickQuestion(
                    "What should I do if an emergency exit is blocked?"
                  )
                }
              >
                Blocked exit
              </button>

            </div>


            {/* ASK BUTTON */}

            <button
              className="ask-btn"
              onClick={askArvion}
              disabled={
                asking ||
                !question.trim()
              }
            >
              {asking
                ? "SEARCHING SOP + ASKING ARVION..."
                : "ASK ARVION →"}
            </button>


            {/* RAG ANSWER */}

            {answer && (

              <div className="rag-answer">

                <div className="rag-answer-header">

                  <span>
                    ARVION RESPONSE
                  </span>

                  <span className="local-tag">
                    LOCAL AI
                  </span>

                </div>

                <p className="answer-text">
                  {answer.answer}
                </p>

                <div className="source-box">

                  <span>
                    SOURCE
                  </span>

                  <strong>
                    {answer.source}
                  </strong>

                </div>

              </div>

            )}

          </div>

        </section>


        {/* ====================================================
            RIGHT PANEL
            ==================================================== */}

        <section className="right-panel">

          <div className="panel-header">

            <div>

              <p className="eyebrow">
                LIVE OPERATIONS
              </p>

              <h2>
                Incident Map
              </h2>

            </div>

            <div className="incident-count">
              {incidents.length} INCIDENTS
            </div>

          </div>


          {/* ==================================================
              LOCAL OFFLINE MAP
              ================================================== */}

          <div className="map-wrapper">

            <LocalEventMap
              incidents={incidents}
              zoneMemory={zoneMemory}
            />

          </div>

          {/* ==================================================
              RISK HEATMAP
              Derived from incidents already in this session.
              No backend/API changes.
              ================================================== */}

          <div className="risk-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">EVENT AWARENESS</p>
                <h2>Risk Heatmap</h2>
              </div>

              <div className="risk-count">
                {activeRiskZones.length} ELEVATED
              </div>
            </div>

            <p className="description">
              Risk is calculated from incident frequency and severity
              recorded during this ARVION session.
            </p>

            <div className="risk-grid">
              {zoneMemory.map((zone) => (
                <div
                  className={`risk-zone-card risk-${zone.risk.toLowerCase()}`}
                  key={zone.zone}
                >
                  <div className="risk-zone-top">
                    <strong>{zone.zone}</strong>
                    <span>{zone.risk}</span>
                  </div>

                  <div className="risk-meter">
                    <div
                      className="risk-meter-fill"
                      style={{
                        width:
                          zone.risk === "HIGH"
                            ? "100%"
                            : zone.risk === "ELEVATED"
                              ? "62%"
                              : "22%",
                      }}
                    />
                  </div>

                  <div className="risk-zone-meta">
                    <span>{zone.incidents} incidents</span>
                    <span>{zone.crowdCount} crowd</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="memory-callout">
              <span>ARVION EVENT MEMORY</span>
              <strong>{memoryHeadline}</strong>

              {repeatedPatterns.length > 0 && (
                <p>
                  {repeatedPatterns[0].count} related incidents have been
                  recorded in the same zone during this session.
                </p>
              )}
            </div>
          </div>


          {/* ==================================================
              INCIDENT FEED
              ================================================== */}

          <div className="feed-title">
            LIVE INCIDENT FEED
          </div>

          <div className="incident-feed">

            {incidents.length === 0 ? (

              <div className="empty-state">

                <div className="radar">
                  ◎
                </div>

                <h3>
                  No active incidents
                </h3>

                <p>
                  Reports submitted by
                  field volunteers will
                  appear here.
                </p>

              </div>

            ) : (

              incidents.map(
                (item) => (

                  <div
                    className={`incident-card ${
                      getIncidentStatus(item.id) === "RESOLVED"
                        ? "incident-resolved"
                        : ""
                    }`}
                    key={item.id}
                  >

                    <div
                      className={`severity-bar ${severityClass(
                        item.severity
                      )}`}
                    />

                    <div className="incident-content">

                      <div className="incident-top">

                        <span
                          className={`severity ${severityClass(
                            item.severity
                          )}`}
                        >
                          {item.severity}
                        </span>

                        <span className="time">
                          {new Date(
                            item.timestamp
                          ).toLocaleTimeString()}
                        </span>

                      </div>

                      <div className="incident-workflow-row">
                        <span className="workflow-status">
                          {getIncidentStatus(item.id)}
                        </span>

                        {getAssignedTeam(item.id) && (
                          <span className="assigned-team">
                            {getAssignedTeam(item.id).name}
                          </span>
                        )}
                      </div>

                      <h3>
                        {formatType(
                          item.type
                        )}
                      </h3>

                      <p className="location">
                        📍{" "}
                        {item.location}
                      </p>

                      <p>
                        {item.description}
                      </p>

                      <div className="audit-mini">
                        <div className="audit-mini-title">
                          ACTIVITY TIMELINE
                        </div>

                        <div className="audit-mini-list">
                          {(incidentLogs[item.id] || []).map(
                            (log) => (
                              <div
                                className="audit-mini-row"
                                key={log.id}
                              >
                                <span className="audit-dot" />

                                <div>
                                  <strong>
                                    {log.action}
                                  </strong>

                                  <span>
                                    {log.detail}
                                  </span>
                                </div>

                                <time>
                                  {new Date(
                                    log.time
                                  ).toLocaleTimeString()}
                                </time>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      <div className="incident-actions">

                        <select
                          value={assignedTeams[item.id] || ""}
                          onChange={(e) =>
                            assignTeam(
                              item.id,
                              e.target.value
                            )
                          }
                        >
                          <option value="">
                            ASSIGN RESPONSE TEAM
                          </option>

                          {responseTeams.map((team) => (
                            <option
                              key={team.id}
                              value={team.id}
                            >
                              {team.name} · {team.zone}
                            </option>
                          ))}
                        </select>

                        {getIncidentStatus(item.id) === "NEW" && (
                          <button
                            type="button"
                            onClick={() =>
                              updateIncidentStatus(
                                item.id,
                                "ACKNOWLEDGED"
                              )
                            }
                          >
                            ACKNOWLEDGE
                          </button>
                        )}

                        {getIncidentStatus(item.id) === "ACKNOWLEDGED" && (
                          <button
                            type="button"
                            onClick={() =>
                              updateIncidentStatus(
                                item.id,
                                "RESPONDING"
                              )
                            }
                          >
                            RESPONDING
                          </button>
                        )}

                        {getIncidentStatus(item.id) === "RESPONDING" && (
                          <button
                            type="button"
                            onClick={() =>
                              updateIncidentStatus(
                                item.id,
                                "RESOLVED"
                              )
                            }
                          >
                            RESOLVE
                          </button>
                        )}

                      </div>

                    </div>

                  </div>

                )
              )

            )}

          </div>

          {/* ==================================================
              SYSTEM HEALTH + DEMO CONTROL
              ================================================== */}

          <div className="system-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">
                  CONTROL ROOM
                </p>

                <h2>
                  System Health
                </h2>
              </div>

              <div className="demo-badge">
                {demoRunning
                  ? `DEMO ${demoStep}/5`
                  : "READY"}
              </div>
            </div>

            <div className="health-grid">
              <div className="health-item">
                <span
                  className={`health-dot ${
                    ollamaOnline === false
                      ? "offline"
                      : "online"
                  }`}
                />

                <div>
                  <strong>
                    Ollama
                  </strong>
                  <span>
                    {ollamaOnline === null
                      ? "CHECKING"
                      : ollamaOnline
                      ? "ONLINE"
                      : "OFFLINE"}
                  </span>
                </div>
              </div>

              <div className="health-item">
                <span className="health-dot online" />

                <div>
                  <strong>
                    AI Model
                  </strong>
                  <span>
                    QWEN 2.5 7B
                  </span>
                </div>
              </div>

              <div className="health-item">
                <span
                  className={`health-dot ${
                    connected
                      ? "online"
                      : "offline"
                  }`}
                />

                <div>
                  <strong>
                    Socket
                  </strong>
                  <span>
                    {connected
                      ? "LIVE"
                      : "OFFLINE"}
                  </span>
                </div>
              </div>

              <div className="health-item">
                <span className="health-dot online" />

                <div>
                  <strong>
                    Backend
                  </strong>
                  <span>
                    ARVION SERVER
                  </span>
                </div>
              </div>

              <div className="health-item">
                <span className="health-dot online" />

                <div>
                  <strong>
                    Local Network
                  </strong>
                  <span>
                    LAN READY
                  </span>
                </div>
              </div>

              <div className="health-item">
                <span className="health-dot online" />

                <div>
                  <strong>
                    Internet
                  </strong>
                  <span>
                    NOT REQUIRED
                  </span>
                </div>
              </div>
            </div>

            <div className="demo-controls">
              <div>
                <p className="demo-title">
                  LIVE DEMO SEQUENCE
                </p>

                <p className="demo-description">
                  Runs one complete incident
                  lifecycle for presentations.
                </p>
              </div>

              <div className="demo-buttons">
                <button
                  type="button"
                  className="demo-run-btn"
                  onClick={
                    runLiveDemo
                  }
                  disabled={
                    demoRunning
                  }
                >
                  {demoRunning
                    ? "RUNNING DEMO..."
                    : "▶ RUN LIVE DEMO"}
                </button>

                <button
                  type="button"
                  className="demo-reset-btn"
                  onClick={
                    resetDemo
                  }
                  disabled={
                    demoRunning
                  }
                >
                  RESET DEMO
                </button>
              </div>
            </div>

            <div className="demo-steps">
              {[
                "INCIDENT",
                "ACKNOWLEDGE",
                "ASSIGN TEAM",
                "RESPOND",
                "RESOLVE",
              ].map(
                (step, index) => (
                  <div
                    className={`demo-step ${
                      demoStep >
                      index
                        ? "complete"
                        : demoStep ===
                          index + 1
                        ? "active"
                        : ""
                    }`}
                    key={step}
                  >
                    <span>
                      {index + 1}
                    </span>
                    <small>
                      {step}
                    </small>
                  </div>
                )
              )}
            </div>
          </div>

          {/* ==================================================
              EVENT MEMORY
              ================================================== */}

          <div className="memory-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">LOCAL MEMORY</p>
                <h2>Event Memory</h2>
              </div>

              <div className="incident-count">
                {repeatedPatterns.length} PATTERNS
              </div>
            </div>

            <p className="description">
              ARVION keeps a session-level memory of repeated incident
              patterns so the control room can notice developing hotspots.
            </p>

            {repeatedPatterns.length === 0 ? (
              <div className="memory-empty">
                No repeated pattern yet. New incidents will build the
                event memory automatically.
              </div>
            ) : (
              <div className="memory-list">
                {repeatedPatterns.slice(0, 4).map((pattern) => (
                  <div className="memory-row" key={pattern.key}>
                    <div className="memory-row-main">
                      <strong>{pattern.type}</strong>
                      <span>📍 {pattern.zone}</span>
                    </div>

                    <div className="memory-row-stat">
                      <strong>{pattern.count}×</strong>
                      <span>REPEATED</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="memory-footer">
              <span>MEMORY SOURCE</span>
              <strong>ARVION SESSION INCIDENT LOG</strong>
            </div>
          </div>


          {/* ==================================================
              EVENT ANALYTICS
              ================================================== */}

          <div className="analytics-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">
                  EVENT INTELLIGENCE
                </p>

                <h2>
                  Event Analytics
                </h2>
              </div>

              <button
                type="button"
                className="report-btn"
                onClick={
                  generateEventReport
                }
                disabled={
                  incidents.length === 0
                }
              >
                GENERATE EVENT REPORT →
              </button>
            </div>

            <div className="analytics-grid">
              <div className="analytics-card">
                <span>TOTAL INCIDENTS</span>
                <strong>{totalIncidents}</strong>
              </div>

              <div className="analytics-card">
                <span>CRITICAL</span>
                <strong>{criticalIncidents}</strong>
              </div>

              <div className="analytics-card">
                <span>HIGH</span>
                <strong>{highIncidents}</strong>
              </div>

              <div className="analytics-card">
                <span>RESOLVED</span>
                <strong>{resolvedIncidents}</strong>
              </div>

              <div className="analytics-card">
                <span>OPEN</span>
                <strong>{openIncidents}</strong>
              </div>

              <div className="analytics-card">
                <span>AVG RESPONSE</span>
                <strong>
                  {formatDuration(
                    averageResponseSeconds
                  )}
                </strong>
              </div>
            </div>

            <div className="analytics-lower">
              <div className="breakdown-panel">
                <div className="analytics-subtitle">
                  INCIDENT BREAKDOWN
                </div>

                {analyticsTypes.length === 0 ? (
                  <p className="analytics-empty">
                    Waiting for incident data...
                  </p>
                ) : (
                  <div className="breakdown-list">
                    {analyticsTypes.map(
                      ([type, count]) => {
                        const percentage =
                          totalIncidents
                            ? Math.round(
                                (count /
                                  totalIncidents) *
                                  100
                              )
                            : 0;

                        return (
                          <div
                            className="breakdown-row"
                            key={type}
                          >
                            <div className="breakdown-label">
                              <span>
                                {type}
                              </span>

                              <strong>
                                {count}
                              </strong>
                            </div>

                            <div className="breakdown-track">
                              <div
                                className="breakdown-fill"
                                style={{
                                  width: `${percentage}%`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              <div className="performance-panel">
                <div className="analytics-subtitle">
                  RESPONSE PERFORMANCE
                </div>

                <div className="performance-row">
                  <span>Assigned incidents</span>
                  <strong>
                    {assignedIncidentCount}
                  </strong>
                </div>

                <div className="performance-row">
                  <span>Resolved incidents</span>
                  <strong>
                    {resolvedIncidents}
                  </strong>
                </div>

                <div className="performance-row">
                  <span>Open incidents</span>
                  <strong>
                    {openIncidents}
                  </strong>
                </div>

                <div className="performance-row">
                  <span>Average response</span>
                  <strong>
                    {formatDuration(
                      averageResponseSeconds
                    )}
                  </strong>
                </div>
              </div>
            </div>

            <p className="analytics-note">
              Analytics are calculated only from
              incidents recorded in this ARVION
              session.
            </p>
          </div>

          {/* ==================================================
              INCIDENT AUDIT LOG
              ================================================== */}

          <div className="audit-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">AUDIT TRAIL</p>
                <h2>Incident Timeline</h2>
              </div>

              <div className="incident-count">
                {Object.keys(incidentLogs).length} TRACKED
              </div>
            </div>

            <p className="description">
              Every major operator and AI workflow event is recorded
              locally for review after the incident.
            </p>

            {incidents.length === 0 ? (
              <div className="audit-empty">
                Waiting for the first incident...
              </div>
            ) : (
              <div className="audit-list">
                {incidents.map((item) => (
                  <div
                    className="audit-incident"
                    key={`audit-${item.id}`}
                  >
                    <div className="audit-incident-header">
                      <div>
                        <strong>
                          {formatType(item.type)}
                        </strong>

                        <span>
                          📍 {item.location}
                        </span>
                      </div>

                      <span
                        className={`severity ${severityClass(
                          item.severity
                        )}`}
                      >
                        {item.severity}
                      </span>
                    </div>

                    <div className="audit-events">
                      {(incidentLogs[item.id] || []).map(
                        (log) => (
                          <div
                            className="audit-event"
                            key={log.id}
                          >
                            <div className="audit-event-line">
                              <span className="audit-dot" />
                            </div>

                            <div className="audit-event-body">
                              <strong>
                                {log.action}
                              </strong>

                              <span>
                                {log.detail}
                              </span>
                            </div>

                            <time>
                              {new Date(
                                log.time
                              ).toLocaleTimeString()}
                            </time>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ==================================================
              RESPONSE TEAMS / OPERATIONS
              ================================================== */}

          <div className="operations-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">OPERATIONS</p>
                <h2>Response Teams</h2>
              </div>

              <div className="incident-count">
                {responseTeams.length} UNITS
              </div>
            </div>

            <p className="description">
              Local demo roster for assigning field response units.
              Team state is maintained in this control-room session.
            </p>

            <div className="team-grid">
              {responseTeams.map((team) => {
                const assignedCount = Object.values(assignedTeams)
                  .filter((id) => id === team.id).length;

                const liveStatus =
                  assignedCount > 0
                    ? "RESPONDING"
                    : team.status;

                return (
                  <div
                    className="team-card"
                    key={team.id}
                  >
                    <div className="team-card-top">
                      <span className="team-role">
                        {team.role}
                      </span>

                      <span
                        className={`team-status ${liveStatus.toLowerCase()}`}
                      >
                        {liveStatus}
                      </span>
                    </div>

                    <h3>{team.name}</h3>

                    <p>📍 {team.zone}</p>

                    <div className="team-meta">
                      <span>{team.id}</span>
                      <span>
                        {assignedCount} assigned
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>

      </main>


      </>
      )}

      {publicNotice && (
        <div className="notice-backdrop" onClick={() => setPublicNotice(null)}>
          <div className="notice-modal" onClick={(e) => e.stopPropagation()}>
            <button className="notice-close" onClick={() => setPublicNotice(null)}>×</button>
            <div className="notice-icon">⚠</div>
            <p className="eyebrow">{publicNotice === "rag" ? "LOCAL AI MODE REQUIRED" : "ONLINE AI MODE — UNDER DEVELOPMENT"}</p>
            <h2>{publicNotice === "rag" ? "SOP intelligence runs locally" : "Public showcase mode"}</h2>
            <p>
              {publicNotice === "rag"
                ? "ARVION SOP intelligence runs on the local control node using Ollama + Qwen 2.5. This public deployment is a UI and workflow showcase."
                : "This public showcase demonstrates the ARVION interface and workflow. Full AI analysis runs locally using Ollama + Qwen 2.5 on the ARVION control node."}
            </p>
            <div className="notice-box">
              <strong>For the complete offline demo</strong>
              <span>Connect to an ARVION local control node.</span>
            </div>
            <a href="mailto:sandarsh666@gamil.com" className="notice-contact">📩 Request an Offline Deployment</a>
            <button className="notice-ok" onClick={() => setPublicNotice(null)}>UNDERSTOOD</button>
          </div>
        </div>
      )}

      {/* ======================================================
          FOOTER
          ====================================================== */}


      <style>{`
        /* ============================================================
           EVENT MEMORY + RISK HEATMAP
           ============================================================ */

        .risk-panel,
        .memory-panel {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          background: rgba(255,255,255,.025);
        }

        .risk-count {
          border: 1px solid rgba(255,255,255,.10);
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .08em;
          opacity: .7;
        }

        .risk-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
          margin-top: 14px;
        }

        .risk-zone-card {
          padding: 11px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: rgba(255,255,255,.018);
        }

        .risk-zone-top,
        .risk-zone-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .risk-zone-top strong {
          font-size: 11px;
        }

        .risk-zone-top span {
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .08em;
          opacity: .65;
        }

        .risk-zone-card.risk-high {
          border-color: rgba(255,100,100,.32);
          background: rgba(255,70,70,.055);
        }

        .risk-zone-card.risk-elevated {
          border-color: rgba(255,190,80,.25);
          background: rgba(255,180,70,.035);
        }

        .risk-meter {
          height: 5px;
          margin-top: 10px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255,255,255,.07);
        }

        .risk-meter-fill {
          height: 100%;
          border-radius: inherit;
          background: currentColor;
        }

        .risk-high .risk-meter-fill {
          color: #ff7d7d;
        }

        .risk-elevated .risk-meter-fill {
          color: #ffd27d;
        }

        .risk-low .risk-meter-fill {
          color: #7df0a5;
        }

        .risk-zone-meta {
          margin-top: 8px;
          font-size: 8px;
          opacity: .45;
        }

        .memory-callout {
          margin-top: 10px;
          padding: 12px;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 10px;
          background: rgba(255,255,255,.02);
        }

        .memory-callout > span,
        .memory-footer span {
          display: block;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .10em;
          opacity: .45;
        }

        .memory-callout > strong {
          display: block;
          margin-top: 5px;
          font-size: 12px;
        }

        .memory-callout p {
          margin: 5px 0 0;
          font-size: 9px;
          line-height: 1.45;
          opacity: .55;
        }

        .memory-empty {
          margin-top: 14px;
          padding: 12px;
          border: 1px dashed rgba(255,255,255,.10);
          border-radius: 9px;
          font-size: 9px;
          line-height: 1.5;
          opacity: .5;
        }

        .memory-list {
          display: grid;
          gap: 7px;
          margin-top: 14px;
        }

        .memory-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 9px;
          background: rgba(255,255,255,.018);
        }

        .memory-row-main strong,
        .memory-row-main span {
          display: block;
        }

        .memory-row-main strong {
          font-size: 10px;
        }

        .memory-row-main span {
          margin-top: 3px;
          font-size: 8px;
          opacity: .48;
        }

        .memory-row-stat {
          text-align: right;
        }

        .memory-row-stat strong,
        .memory-row-stat span {
          display: block;
        }

        .memory-row-stat strong {
          font-size: 14px;
        }

        .memory-row-stat span {
          margin-top: 2px;
          font-size: 7px;
          letter-spacing: .08em;
          opacity: .42;
        }

        .memory-footer {
          margin-top: 12px;
          padding-top: 11px;
          border-top: 1px solid rgba(255,255,255,.07);
        }

        .memory-footer strong {
          display: block;
          margin-top: 4px;
          font-size: 8px;
          letter-spacing: .05em;
          opacity: .55;
        }

        @media (max-width: 700px) {
          .risk-grid {
            grid-template-columns: 1fr;
          }

          .memory-row {
            align-items: flex-start;
          }
        }

        .incident-workflow-row {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          margin: 8px 0 10px;
        }

        .workflow-status,
        .assigned-team,
        .team-role,
        .team-status {
          display: inline-flex;
          align-items: center;
          border: 1px solid rgba(255,255,255,.10);
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .08em;
        }

        .workflow-status {
          background: rgba(255,255,255,.06);
        }

        .assigned-team {
          background: rgba(70, 180, 255, .08);
        }

        .incident-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
        }

        .incident-actions select,
        .incident-actions button {
          min-height: 34px;
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 8px;
          background: rgba(255,255,255,.045);
          color: inherit;
          padding: 7px 10px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .05em;
          cursor: pointer;
        }

        .incident-actions select {
          min-width: 210px;
        }

        .incident-actions button:hover,
        .incident-actions select:hover {
          border-color: rgba(255,255,255,.28);
        }

        .incident-resolved {
          opacity: .68;
        }

        .system-panel {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          background: rgba(255,255,255,.025);
        }

        .demo-badge {
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .08em;
          opacity: .65;
        }

        .health-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0,1fr));
          gap: 8px;
          margin-top: 14px;
        }

        .health-item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 9px;
          background: rgba(255,255,255,.018);
        }

        .health-item strong,
        .health-item span {
          display: block;
        }

        .health-item strong {
          font-size: 10px;
        }

        .health-item div span {
          margin-top: 2px;
          font-size: 8px;
          opacity: .45;
          letter-spacing: .05em;
        }

        .health-dot {
          width: 7px;
          height: 7px;
          flex: 0 0 7px;
          border-radius: 50%;
          background: currentColor;
        }

        .health-dot.online {
          color: #7df0a5;
        }

        .health-dot.offline {
          color: #ff7d7d;
        }

        .demo-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid rgba(255,255,255,.07);
        }

        .demo-title {
          margin: 0;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .1em;
        }

        .demo-description {
          margin: 4px 0 0;
          font-size: 10px;
          opacity: .45;
        }

        .demo-buttons {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        .demo-run-btn,
        .demo-reset-btn {
          min-height: 36px;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .06em;
          cursor: pointer;
        }

        .demo-run-btn {
          border: 1px solid rgba(255,255,255,.15);
          background: rgba(255,255,255,.08);
          color: inherit;
        }

        .demo-reset-btn {
          border: 1px solid rgba(255,255,255,.08);
          background: transparent;
          color: inherit;
          opacity: .65;
        }

        .demo-run-btn:disabled,
        .demo-reset-btn:disabled {
          opacity: .35;
          cursor: not-allowed;
        }

        .demo-steps {
          display: grid;
          grid-template-columns: repeat(5, minmax(0,1fr));
          gap: 5px;
          margin-top: 13px;
        }

        .demo-step {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          padding: 7px;
          border: 1px solid rgba(255,255,255,.06);
          border-radius: 7px;
          opacity: .35;
        }

        .demo-step span {
          display: grid;
          place-items: center;
          width: 17px;
          height: 17px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,.12);
          font-size: 8px;
          flex: 0 0 17px;
        }

        .demo-step small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 7px;
          font-weight: 900;
          letter-spacing: .04em;
        }

        .demo-step.active {
          opacity: .9;
          border-color: rgba(255,255,255,.18);
        }

        .demo-step.complete {
          opacity: .65;
        }

        .demo-step.complete span {
          background: rgba(255,255,255,.1);
        }

        .analytics-panel {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          background: rgba(255,255,255,.025);
        }

        .report-btn {
          min-height: 36px;
          border: 1px solid rgba(255,255,255,.13);
          border-radius: 8px;
          background: rgba(255,255,255,.055);
          color: inherit;
          padding: 8px 12px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .07em;
          cursor: pointer;
        }

        .report-btn:hover:not(:disabled) {
          border-color: rgba(255,255,255,.3);
          background: rgba(255,255,255,.09);
        }

        .report-btn:disabled {
          opacity: .35;
          cursor: not-allowed;
        }

        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0,1fr));
          gap: 9px;
          margin-top: 15px;
        }

        .analytics-card {
          padding: 13px;
          min-height: 70px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: rgba(255,255,255,.02);
        }

        .analytics-card span {
          display: block;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .08em;
          opacity: .45;
        }

        .analytics-card strong {
          display: block;
          margin-top: 8px;
          font-size: 22px;
          line-height: 1;
        }

        .analytics-lower {
          display: grid;
          grid-template-columns: 1.2fr .8fr;
          gap: 10px;
          margin-top: 10px;
        }

        .breakdown-panel,
        .performance-panel {
          padding: 14px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: rgba(255,255,255,.018);
        }

        .analytics-subtitle {
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .1em;
          opacity: .5;
          margin-bottom: 12px;
        }

        .breakdown-list {
          display: grid;
          gap: 10px;
        }

        .breakdown-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 10px;
          margin-bottom: 5px;
        }

        .breakdown-label strong {
          opacity: .7;
        }

        .breakdown-track {
          height: 5px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255,255,255,.07);
        }

        .breakdown-fill {
          height: 100%;
          border-radius: inherit;
          background: currentColor;
          opacity: .7;
          min-width: 2px;
        }

        .performance-panel {
          display: grid;
          align-content: start;
        }

        .performance-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 9px 0;
          border-bottom: 1px solid rgba(255,255,255,.06);
          font-size: 10px;
        }

        .performance-row:last-child {
          border-bottom: 0;
        }

        .performance-row span {
          opacity: .5;
        }

        .performance-row strong {
          font-size: 11px;
        }

        .analytics-empty,
        .analytics-note {
          margin: 0;
          font-size: 10px;
          opacity: .45;
        }

        .analytics-note {
          margin-top: 11px;
          text-align: right;
        }

        @media (max-width: 900px) {
          .analytics-grid {
            grid-template-columns: repeat(3, minmax(0,1fr));
          }

          .analytics-lower {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 560px) {
          .analytics-grid {
            grid-template-columns: repeat(2, minmax(0,1fr));
          }

          .panel-header {
            align-items: flex-start;
          }

          .report-btn {
            font-size: 8px;
          }
        }

        .audit-panel {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          background: rgba(255,255,255,.025);
        }

        .audit-mini {
          margin-top: 13px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 10px;
          background: rgba(0,0,0,.12);
        }

        .audit-mini-title {
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .12em;
          opacity: .5;
          margin-bottom: 8px;
        }

        .audit-mini-list {
          display: grid;
          gap: 7px;
        }

        .audit-mini-row {
          display: grid;
          grid-template-columns: 8px minmax(0,1fr) auto;
          gap: 8px;
          align-items: start;
          font-size: 10px;
        }

        .audit-mini-row strong,
        .audit-mini-row span {
          display: block;
        }

        .audit-mini-row strong {
          font-size: 9px;
          letter-spacing: .05em;
        }

        .audit-mini-row div span {
          margin-top: 2px;
          opacity: .52;
          line-height: 1.35;
        }

        .audit-mini-row time {
          opacity: .45;
          white-space: nowrap;
          font-size: 9px;
        }

        .audit-dot {
          width: 7px;
          height: 7px;
          margin-top: 4px;
          border-radius: 50%;
          background: currentColor;
          opacity: .75;
        }

        .audit-empty {
          padding: 22px 10px;
          text-align: center;
          opacity: .45;
          font-size: 12px;
        }

        .audit-list {
          display: grid;
          gap: 12px;
          margin-top: 14px;
        }

        .audit-incident {
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 11px;
          padding: 13px;
          background: rgba(255,255,255,.02);
        }

        .audit-incident-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .audit-incident-header strong,
        .audit-incident-header span {
          display: block;
        }

        .audit-incident-header > div > span {
          margin-top: 3px;
          opacity: .5;
          font-size: 10px;
        }

        .audit-events {
          margin-top: 12px;
          display: grid;
        }

        .audit-event {
          display: grid;
          grid-template-columns: 12px minmax(0,1fr) auto;
          gap: 8px;
          min-height: 38px;
        }

        .audit-event-line {
          position: relative;
          display: flex;
          justify-content: center;
        }

        .audit-event:not(:last-child) .audit-event-line::after {
          content: "";
          position: absolute;
          top: 12px;
          bottom: -5px;
          width: 1px;
          background: rgba(255,255,255,.12);
        }

        .audit-event-body strong {
          display: block;
          font-size: 10px;
          letter-spacing: .06em;
        }

        .audit-event-body span {
          display: block;
          margin-top: 3px;
          font-size: 10px;
          opacity: .5;
        }

        .audit-event time {
          font-size: 9px;
          opacity: .4;
          white-space: nowrap;
        }

        .operations-panel {
          margin-top: 18px;
          padding: 18px;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 14px;
          background: rgba(255,255,255,.025);
        }

        .team-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 14px;
        }

        .team-card {
          padding: 13px;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 11px;
          background: rgba(255,255,255,.025);
        }

        .team-card-top,
        .team-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .team-role {
          color: rgba(255,255,255,.55);
        }

        .team-status.available {
          color: #8df0b0;
          border-color: rgba(141,240,176,.22);
        }

        .team-status.responding {
          color: #ffd36a;
          border-color: rgba(255,211,106,.22);
        }

        .team-card h3 {
          margin: 10px 0 4px;
        }

        .team-card p {
          margin: 0 0 10px;
          opacity: .7;
          font-size: 12px;
        }

        .team-meta {
          font-size: 10px;
          opacity: .5;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        @media (max-width: 700px) {
          .team-grid {
            grid-template-columns: 1fr;
          }

          .incident-actions select {
            width: 100%;
          }
        }
      `}</style>

      <footer>

        <span>
          ARVION v0.4
        </span>

        <span>
          LOCAL-FIRST EVENT INTELLIGENCE
        </span>

        <span>
          {connected
            ? "LIVE SYNC ACTIVE"
            : "RECONNECTING..."}
        </span>

      </footer>

    </div>
  );
}

export default App;