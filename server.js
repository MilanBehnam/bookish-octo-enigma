const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const port = Number(process.env.PORT || 3000);
const fibonacciValues = new Set(["0", "1", "2", "3", "5", "8", "13", "21", "?"]);
const sessions = new Map();

function roomForSession(sessionCode) {
  return `session:${sessionCode}`;
}

function normalizeCode(value = "") {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

function generateSessionCode() {
  let attempts = 0;
  while (attempts < 20) {
    const nextCode = Math.random().toString(36).slice(2, 8);
    if (!sessions.has(nextCode)) {
      return nextCode;
    }
    attempts += 1;
  }
  return `${Date.now().toString(36).slice(-6)}`;
}

function getDefaultSettings() {
  return {
    autoReveal: false,
    enableFun: true,
    showAverage: true,
    countdown: false,
  };
}

function createParticipantRecord(id, name, isHost = false) {
  return {
    id,
    name: name || (isHost ? "Host" : "Anonymous"),
    isHost,
    vote: null,
  };
}

function buildSnapshot(session) {
  return {
    sessionCode: session.sessionCode,
    hostId: session.hostId,
    hostName: session.hostName,
    revealed: session.revealed,
    countdownEndsAt: session.countdownEndsAt,
    settings: {
      ...session.settings,
    },
    participants: {
      ...session.participants,
    },
  };
}

function broadcastSession(sessionCode) {
  const session = sessions.get(sessionCode);
  if (!session) {
    return;
  }
  io.to(roomForSession(sessionCode)).emit("session-state", buildSnapshot(session));
}

function clearRevealTimer(session) {
  if (session.revealTimer) {
    clearTimeout(session.revealTimer);
    session.revealTimer = null;
  }
}

function finalizeReveal(sessionCode) {
  const session = sessions.get(sessionCode);
  if (!session) {
    return;
  }
  session.revealed = true;
  session.countdownEndsAt = null;
  clearRevealTimer(session);
  broadcastSession(sessionCode);
}

function triggerReveal(sessionCode) {
  const session = sessions.get(sessionCode);
  if (!session || session.revealed) {
    return;
  }

  if (session.settings.countdown) {
    if (session.countdownEndsAt) {
      return;
    }
    session.countdownEndsAt = Date.now() + 3000;
    session.revealTimer = setTimeout(() => finalizeReveal(sessionCode), 3000);
    broadcastSession(sessionCode);
    return;
  }

  finalizeReveal(sessionCode);
}

function maybeAutoReveal(sessionCode) {
  const session = sessions.get(sessionCode);
  if (!session || session.revealed || !session.settings.autoReveal) {
    return;
  }

  const participants = Object.values(session.participants);
  if (!participants.length) {
    return;
  }

  const everyoneVoted = participants.every((participant) => participant.vote !== null);
  if (everyoneVoted) {
    triggerReveal(sessionCode);
  }
}

function resetRound(sessionCode) {
  const session = sessions.get(sessionCode);
  if (!session) {
    return;
  }
  session.revealed = false;
  session.countdownEndsAt = null;
  clearRevealTimer(session);
  Object.values(session.participants).forEach((participant) => {
    participant.vote = null;
  });
  broadcastSession(sessionCode);
}

function leaveSession(socket) {
  const sessionCode = socket.data.sessionCode;
  if (!sessionCode) {
    return;
  }

  const session = sessions.get(sessionCode);
  socket.leave(roomForSession(sessionCode));
  socket.data.sessionCode = null;
  socket.data.isHost = false;

  if (!session) {
    return;
  }

  if (session.hostId === socket.id) {
    clearRevealTimer(session);
    sessions.delete(sessionCode);
    socket.to(roomForSession(sessionCode)).emit("session-ended");
    return;
  }

  delete session.participants[socket.id];
  broadcastSession(sessionCode);
}

io.on("connection", (socket) => {
  socket.data.sessionCode = null;
  socket.data.isHost = false;

  socket.on("create-session", (payload = {}) => {
    leaveSession(socket);
    const hostName = String(payload.name || "").trim() || "Host";
    const sessionCode = generateSessionCode();
    const session = {
      sessionCode,
      hostId: socket.id,
      hostName,
      revealed: false,
      countdownEndsAt: null,
      revealTimer: null,
      settings: getDefaultSettings(),
      participants: {
        [socket.id]: createParticipantRecord(socket.id, hostName, true),
      },
    };

    sessions.set(sessionCode, session);
    socket.join(roomForSession(sessionCode));
    socket.data.sessionCode = sessionCode;
    socket.data.isHost = true;
    socket.emit("session-created", {
      sessionCode,
    });
    broadcastSession(sessionCode);
  });

  socket.on("join-session", (payload = {}) => {
    leaveSession(socket);
    const sessionCode = normalizeCode(String(payload.sessionCode || ""));
    const name = String(payload.name || "").trim();
    const session = sessions.get(sessionCode);

    if (!session) {
      socket.emit("join-error", { message: "Session not found or already closed." });
      return;
    }

    socket.join(roomForSession(sessionCode));
    socket.data.sessionCode = sessionCode;
    socket.data.isHost = false;
    session.participants[socket.id] = createParticipantRecord(socket.id, name);
    socket.emit("joined-session", { sessionCode });
    broadcastSession(sessionCode);
  });

  socket.on("vote", (payload = {}) => {
    const sessionCode = socket.data.sessionCode;
    const session = sessions.get(sessionCode);
    if (!session) {
      return;
    }
    const participant = session.participants[socket.id];
    if (!participant || session.revealed) {
      return;
    }

    const vote = String(payload.vote ?? "");
    if (!fibonacciValues.has(vote)) {
      return;
    }

    participant.vote = vote;
    if (payload.name) {
      participant.name = String(payload.name).trim() || participant.name;
    }
    maybeAutoReveal(sessionCode);
    broadcastSession(sessionCode);
  });

  socket.on("rename", (payload = {}) => {
    const sessionCode = socket.data.sessionCode;
    const session = sessions.get(sessionCode);
    if (!session) {
      return;
    }
    const participant = session.participants[socket.id];
    if (!participant) {
      return;
    }
    participant.name = String(payload.name || "").trim() || participant.name;
    if (participant.isHost) {
      session.hostName = participant.name;
    }
    broadcastSession(sessionCode);
  });

  socket.on("update-settings", (payload = {}) => {
    const sessionCode = socket.data.sessionCode;
    const session = sessions.get(sessionCode);
    if (!session || session.hostId !== socket.id) {
      return;
    }

    session.settings = {
      ...session.settings,
      autoReveal: Boolean(payload.autoReveal),
      enableFun: Boolean(payload.enableFun),
      showAverage: Boolean(payload.showAverage),
      countdown: Boolean(payload.countdown),
    };

    if (!session.settings.countdown) {
      session.countdownEndsAt = null;
      clearRevealTimer(session);
    }

    maybeAutoReveal(sessionCode);
    broadcastSession(sessionCode);
  });

  socket.on("reveal-votes", () => {
    const sessionCode = socket.data.sessionCode;
    const session = sessions.get(sessionCode);
    if (!session || session.hostId !== socket.id) {
      return;
    }
    triggerReveal(sessionCode);
  });

  socket.on("reset-round", () => {
    const sessionCode = socket.data.sessionCode;
    const session = sessions.get(sessionCode);
    if (!session || session.hostId !== socket.id) {
      return;
    }
    resetRound(sessionCode);
  });

  socket.on("disconnect", () => {
    leaveSession(socket);
  });
});

app.get("/health", (_, response) => {
  response.json({ ok: true });
});

app.use(express.static(path.resolve(__dirname)));

server.listen(port, () => {
  console.log(`Planning Poker relay server running on http://localhost:${port}`);
});
