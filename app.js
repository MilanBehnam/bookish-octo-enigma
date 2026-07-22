const fibonacciValues = ["0", "1", "2", "3", "5", "8", "13", "21", "?"];

const elements = {
  connectionStatus: document.getElementById("connection-status"),
  setupPanel: document.getElementById("setup-panel"),
  sessionPanel: document.getElementById("session-panel"),
  setupChoice: document.getElementById("setup-choice"),
  startCreateButton: document.getElementById("start-create-button"),
  startJoinButton: document.getElementById("start-join-button"),
  createForm: document.getElementById("create-form"),
  createName: document.getElementById("create-name"),
  joinForm: document.getElementById("join-form"),
  joinName: document.getElementById("join-name"),
  joinSessionCodeRow: document.getElementById("join-session-code-row"),
  joinSessionCode: document.getElementById("join-session-code"),
  sessionCode: document.getElementById("session-code"),
  shareButton: document.getElementById("share-button"),
  shareFeedback: document.getElementById("share-feedback"),
  hostControls: document.getElementById("host-controls"),
  settingsButton: document.getElementById("settings-button"),
  settingsModal: document.getElementById("settings-modal"),
  settingsOverlay: document.getElementById("settings-overlay"),
  closeSettingsButton: document.getElementById("close-settings-button"),
  autoRevealToggle: document.getElementById("auto-reveal-toggle"),
  funToggle: document.getElementById("fun-toggle"),
  averageToggle: document.getElementById("average-toggle"),
  countdownToggle: document.getElementById("countdown-toggle"),
  revealButton: document.getElementById("reveal-button"),
  resetButton: document.getElementById("reset-button"),
  roundStatus: document.getElementById("round-status"),
  resultsSummary: document.getElementById("results-summary"),
  cards: document.getElementById("cards"),
  participants: document.getElementById("participants"),
};

const state = {
  peer: null,
  mode: null,
  selfId: null,
  hostId: null,
  hostConnection: null,
  countdownInterval: null,
  revealTimeout: null,
  connections: new Map(),
  currentName: localStorage.getItem("planning-poker-name") || "",
  selectedVote: null,
  inviteContext: {
    sessionCode: "",
    hostId: "",
  },
  session: {
    sessionCode: "",
    hostId: "",
    hostName: "Host",
    revealed: false,
    countdownEndsAt: null,
    settings: {
      autoReveal: false,
      enableFun: true,
      showAverage: true,
      countdown: false,
    },
    participants: {},
  },
};

function getDefaultSettings() {
  return {
    autoReveal: false,
    enableFun: true,
    showAverage: true,
    countdown: false,
  };
}

function normalizeCode(value) {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

function generateSessionCode() {
  return Math.random().toString(36).slice(2, 8);
}

function setStatus(text, isError = false) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.style.background = isError ? "#fde8e8" : "";
  elements.connectionStatus.style.color = isError ? "#b42318" : "";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createParticipantRecord(id, name, isHost = false) {
  return {
    id,
    name: name || (isHost ? "Host" : "Anonymous"),
    isHost,
    vote: null,
  };
}

function getParticipantList() {
  return Object.values(state.session.participants).sort((left, right) => {
    if (left.isHost) {
      return -1;
    }

    if (right.isHost) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function updateUrl(sessionCode = "", hostId = "") {
  const url = new URL(window.location.href);
  if (sessionCode && hostId) {
    url.searchParams.set("session", sessionCode);
    url.searchParams.set("host", hostId);
  } else {
    url.searchParams.delete("session");
    url.searchParams.delete("host");
  }
  window.history.replaceState({}, "", url);
}

function buildShareLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("session", state.session.sessionCode);
  url.searchParams.set("host", state.session.hostId);
  return url.toString();
}

async function copyInviteLink() {
  const shareLink = buildShareLink();

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareLink);
    return;
  }

  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = shareLink;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "absolute";
  temporaryInput.style.left = "-9999px";
  document.body.appendChild(temporaryInput);
  temporaryInput.select();
  const didCopy = document.execCommand("copy");
  document.body.removeChild(temporaryInput);

  if (!didCopy) {
    throw new Error("Copy command failed");
  }
}

function saveName(preferredValue = "") {
  const nextName = preferredValue.trim() || elements.createName.value.trim() || elements.joinName.value.trim();
  if (!nextName) {
    window.alert("Please enter your name.");
    return null;
  }

  state.currentName = nextName;
  localStorage.setItem("planning-poker-name", nextName);
  elements.createName.value = nextName;
  elements.joinName.value = nextName;
  return nextName;
}

function resolveName(preferredValue = "") {
  const nextName = preferredValue.trim() || elements.createName.value.trim() || elements.joinName.value.trim();
  return nextName || null;
}

function setCurrentName(nextName) {
  state.currentName = nextName;
  localStorage.setItem("planning-poker-name", nextName);
  elements.createName.value = nextName;
  elements.joinName.value = nextName;
}

function openSettingsModal() {
  if (state.mode !== "host") {
    return;
  }
  elements.settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  elements.settingsModal.classList.add("hidden");
}

function showSetupChoice() {
  elements.setupChoice.classList.remove("hidden");
  elements.createForm.classList.add("hidden");
  elements.joinForm.classList.add("hidden");
  elements.joinSessionCodeRow.classList.remove("hidden");
}

function showCreateSetup() {
  elements.setupChoice.classList.add("hidden");
  elements.createForm.classList.remove("hidden");
  elements.joinForm.classList.add("hidden");
  elements.createName.focus();
}

function showJoinSetup(inviteMode = false) {
  elements.setupChoice.classList.add("hidden");
  elements.createForm.classList.add("hidden");
  elements.joinForm.classList.remove("hidden");
  elements.joinSessionCodeRow.classList.toggle("hidden", inviteMode);
  elements.joinName.focus();
}

function broadcast(message) {
  if (state.mode !== "host") {
    return;
  }

  state.connections.forEach((connection) => {
    if (connection.open) {
      connection.send(message);
    }
  });
}

function sendSessionSnapshot(targetConnection = null) {
  const snapshot = {
    type: "session-state",
    payload: state.session,
    selfId: targetConnection ? targetConnection.peer : state.selfId,
  };

  if (targetConnection) {
    targetConnection.send(snapshot);
    return;
  }

  broadcast(snapshot);
}

function normalizeSession(session) {
  return {
    ...session,
    participants: session.participants || {},
    settings: {
      ...getDefaultSettings(),
      ...(session.settings || {}),
    },
    countdownEndsAt: session.countdownEndsAt || null,
  };
}

function getVotedParticipants() {
  return Object.values(state.session.participants).filter((participant) => participant.vote !== null);
}

function getVoteResults() {
  const votedParticipants = getVotedParticipants();
  if (!votedParticipants.length) {
    return null;
  }

  const votesCount = new Map();
  votedParticipants.forEach((participant) => {
    votesCount.set(participant.vote, (votesCount.get(participant.vote) || 0) + 1);
  });

  const sortedByCount = [...votesCount.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return fibonacciValues.indexOf(left[0]) - fibonacciValues.indexOf(right[0]);
  });

  const [majorityVote, majorityCount] = sortedByCount[0];
  const agreement = Math.round((majorityCount / votedParticipants.length) * 100);
  const numericVotes = votedParticipants
    .map((participant) => Number(participant.vote))
    .filter((vote) => Number.isFinite(vote));

  let averageData = null;
  if (numericVotes.length) {
    const average = numericVotes.reduce((sum, vote) => sum + vote, 0) / numericVotes.length;
    const numericFibonacciValues = fibonacciValues
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const nearestFibonacci = numericFibonacciValues.reduce((closest, value) => {
      if (Math.abs(value - average) < Math.abs(closest - average)) {
        return value;
      }
      return closest;
    }, numericFibonacciValues[0]);
    averageData = {
      value: average,
      nearestFibonacci,
    };
  }

  return {
    majorityVote,
    majorityCount,
    totalVotes: votedParticipants.length,
    agreement,
    averageData,
  };
}

function clearRevealTimeout() {
  if (state.revealTimeout) {
    window.clearTimeout(state.revealTimeout);
    state.revealTimeout = null;
  }
}

function startCountdownTicker() {
  if (state.countdownInterval) {
    return;
  }

  state.countdownInterval = window.setInterval(() => {
    if (!state.session.countdownEndsAt) {
      window.clearInterval(state.countdownInterval);
      state.countdownInterval = null;
      return;
    }
    renderSession();
  }, 250);
}

function stopCountdownTicker() {
  if (!state.countdownInterval) {
    return;
  }
  window.clearInterval(state.countdownInterval);
  state.countdownInterval = null;
}

function playFunReveal() {
  if (!state.session.settings.enableFun) {
    return;
  }

  const burst = document.createElement("div");
  burst.className = "fun-burst";
  burst.textContent = "🎉 🎉 🎉";
  document.body.appendChild(burst);
  window.setTimeout(() => {
    burst.remove();
  }, 900);
}

function finalizeReveal() {
  state.session.revealed = true;
  state.session.countdownEndsAt = null;
  clearRevealTimeout();
  stopCountdownTicker();
  sendSessionSnapshot();
  renderSession();
  playFunReveal();
}

function revealVotes() {
  if (state.mode !== "host" || state.session.revealed) {
    return;
  }

  if (state.session.settings.countdown) {
    if (state.session.countdownEndsAt) {
      return;
    }
    state.session.countdownEndsAt = Date.now() + 3000;
    sendSessionSnapshot();
    renderSession();
    state.revealTimeout = window.setTimeout(() => {
      finalizeReveal();
    }, 3000);
    return;
  }

  finalizeReveal();
}

function maybeAutoReveal() {
  if (state.mode !== "host" || state.session.revealed || !state.session.settings.autoReveal) {
    return;
  }
  const participants = Object.values(state.session.participants);
  if (!participants.length) {
    return;
  }
  const everyoneVoted = participants.every((participant) => participant.vote !== null);
  if (everyoneVoted) {
    revealVotes();
  }
}

function renderCards() {
  elements.cards.innerHTML = "";

  fibonacciValues.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vote-card${state.selectedVote === value ? " selected" : ""}`;
    button.textContent = value;
    button.disabled = !state.session.sessionCode;
    button.addEventListener("click", () => submitVote(value));
    elements.cards.appendChild(button);
  });
}

function renderParticipants() {
  const participants = getParticipantList();

  if (!participants.length) {
    elements.participants.innerHTML = '<p class="empty-state">No participants yet.</p>';
    return;
  }

  elements.participants.innerHTML = participants
    .map((participant) => {
      const voteDisplay = state.session.revealed ? participant.vote ?? "-" : "?";

      const voteClass = state.session.revealed ? "revealed" : "pending";
      const badge = participant.isHost ? '<span class="participant-badge">Host</span>' : "";
      const editButton =
        participant.id === state.selfId
          ? '<button type="button" class="edit-name-button" aria-label="Edit your name">✎</button>'
          : "";

      return `
        <article class="participant">
          <div class="participant-vote-box ${voteClass}">${escapeHtml(voteDisplay)}</div>
          <div class="participant-name">${escapeHtml(participant.name)}</div>
          <div class="participant-name-row">
            ${editButton}
            ${badge}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSession() {
  const inSession = Boolean(state.session.sessionCode);
  elements.setupPanel.classList.toggle("hidden", inSession);
  elements.sessionPanel.classList.toggle("hidden", !inSession);

  if (!inSession) {
    renderCards();
    return;
  }

  elements.sessionCode.textContent = state.session.sessionCode;
  if (state.session.countdownEndsAt && !state.session.revealed) {
    const seconds = Math.max(1, Math.ceil((state.session.countdownEndsAt - Date.now()) / 1000));
    elements.roundStatus.textContent = `Revealing in ${seconds}s`;
    startCountdownTicker();
  } else {
    stopCountdownTicker();
    elements.roundStatus.textContent = state.session.revealed ? "Votes are revealed" : "Pick your cards";
  }

  elements.hostControls.classList.toggle("hidden", state.mode !== "host");
  elements.settingsButton.classList.toggle("hidden", state.mode !== "host");
  if (state.mode !== "host") {
    closeSettingsModal();
  }
  elements.revealButton.disabled = state.mode !== "host";
  elements.resetButton.disabled = state.mode !== "host";
  elements.shareButton.classList.remove("hidden");
  elements.autoRevealToggle.checked = Boolean(state.session.settings.autoReveal);
  elements.funToggle.checked = Boolean(state.session.settings.enableFun);
  elements.averageToggle.checked = Boolean(state.session.settings.showAverage);
  elements.countdownToggle.checked = Boolean(state.session.settings.countdown);

  const voteResults = state.session.revealed ? getVoteResults() : null;
  if (voteResults) {
    const averageText =
      state.session.settings.showAverage && voteResults.averageData
        ? `<span>Average: ${voteResults.averageData.value.toFixed(1)} (~${voteResults.averageData.nearestFibonacci})</span>`
        : "";
    elements.resultsSummary.innerHTML = `
      <span>Major Fibonacci: ${escapeHtml(voteResults.majorityVote)}</span>
      <span>Agreement: ${voteResults.agreement}% (${voteResults.majorityCount}/${voteResults.totalVotes})</span>
      ${averageText}
    `;
    elements.resultsSummary.classList.remove("hidden");
  } else {
    elements.resultsSummary.classList.add("hidden");
    elements.resultsSummary.innerHTML = "";
  }

  renderCards();
  renderParticipants();
}

function submitVote(value) {
  if (!state.session.sessionCode) {
    window.alert("Join or create a session first.");
    return;
  }

  state.selectedVote = value;

  if (state.mode === "host") {
    state.session.participants[state.selfId].vote = value;
    maybeAutoReveal();
    sendSessionSnapshot();
    renderSession();
    return;
  }

  if (!state.hostConnection?.open) {
    window.alert("Connection to host is unavailable.");
    return;
  }

  state.hostConnection.send({
    type: "vote",
    payload: {
      vote: value,
      name: state.currentName,
    },
  });
  renderCards();
}

function updateParticipantName(name) {
  if (state.mode === "host") {
    state.session.participants[state.selfId].name = name;
    sendSessionSnapshot();
    renderSession();
    return;
  }

  if (state.hostConnection?.open) {
    state.hostConnection.send({
      type: "rename",
      payload: { name },
    });
  }
}

function applySnapshot(snapshot) {
  const previousReveal = state.session.revealed;
  state.session = normalizeSession(snapshot);
  if (state.session.revealed && !previousReveal) {
    playFunReveal();
  }

  const selfParticipant = state.session.participants[state.selfId];
  state.selectedVote = selfParticipant ? selfParticipant.vote : null;
  renderSession();
}

function resetRound() {
  state.session.revealed = false;
  state.session.countdownEndsAt = null;
  Object.values(state.session.participants).forEach((participant) => {
    participant.vote = null;
  });
  clearRevealTimeout();
  stopCountdownTicker();
  state.selectedVote = null;
  sendSessionSnapshot();
  renderSession();
}

function handleHostMessage(connection, message) {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "join") {
    const participantId = connection.peer;
    const participantName = (message.payload?.name || "").trim();
    state.session.participants[participantId] = createParticipantRecord(participantId, participantName);
    sendSessionSnapshot(connection);
    sendSessionSnapshot();
    renderSession();
    return;
  }

  if (message.type === "vote") {
    const participant = state.session.participants[connection.peer];
    if (!participant) {
      return;
    }

    participant.vote = message.payload?.vote ?? null;
    if (message.payload?.name) {
      participant.name = message.payload.name.trim() || participant.name;
    }
    maybeAutoReveal();
    sendSessionSnapshot();
    renderSession();
    return;
  }

  if (message.type === "rename") {
    const participant = state.session.participants[connection.peer];
    if (!participant) {
      return;
    }

    participant.name = (message.payload?.name || "").trim() || participant.name;
    sendSessionSnapshot();
    renderSession();
  }
}

function setupHostConnection(connection) {
  connection.on("open", () => {
    state.connections.set(connection.peer, connection);
    setStatus("Session live");
  });

  connection.on("data", (message) => handleHostMessage(connection, message));

  connection.on("close", () => {
    state.connections.delete(connection.peer);
    delete state.session.participants[connection.peer];
    sendSessionSnapshot();
    renderSession();
  });

  connection.on("error", () => {
    state.connections.delete(connection.peer);
    delete state.session.participants[connection.peer];
    sendSessionSnapshot();
    renderSession();
  });
}

function createHostSession(hostName) {
  const existingName = hostName || state.currentName || "Host";
  state.mode = "host";
  state.session.sessionCode = generateSessionCode();
  state.session.hostId = state.selfId;
  state.session.hostName = existingName;
  state.session.revealed = false;
  state.session.countdownEndsAt = null;
  state.session.settings = getDefaultSettings();
  state.session.participants = {
    [state.selfId]: createParticipantRecord(state.selfId, existingName, true),
  };
  state.selectedVote = null;
  updateUrl(state.session.sessionCode, state.session.hostId);
  renderSession();
  setStatus("Session created");
}

function joinSession(name, sessionCode, hostId) {
  state.mode = "participant";
  state.hostId = hostId;
  state.session.sessionCode = sessionCode;
  state.session.hostId = hostId;
  state.selectedVote = null;
  updateUrl(sessionCode, hostId);
  const connection = state.peer.connect(hostId, { reliable: true });
  state.hostConnection = connection;

  connection.on("open", () => {
    setStatus("Joined session");
    connection.send({
      type: "join",
      payload: { name },
    });
  });

  connection.on("data", (message) => {
    if (message?.type === "session-state") {
      applySnapshot(message.payload);
    }
  });

  connection.on("close", () => {
    setStatus("Disconnected from host", true);
  });

  connection.on("error", () => {
    setStatus("Unable to connect to host", true);
  });
}

function wireEvents() {
  elements.createName.value = state.currentName;
  elements.joinName.value = state.currentName;

  elements.startCreateButton.addEventListener("click", () => {
    showCreateSetup();
  });

  elements.startJoinButton.addEventListener("click", () => {
    showJoinSetup(false);
  });

  elements.createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const hostName = resolveName(elements.createName.value);
    if (!hostName) {
      window.alert("Please enter your name.");
      return;
    }
    setCurrentName(hostName);
    createHostSession(hostName);
  });

  elements.joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.joinName.value.trim();
    const sessionCode = state.inviteContext.sessionCode || normalizeCode(elements.joinSessionCode.value);
    const hostId = state.inviteContext.hostId || new URL(window.location.href).searchParams.get("host") || "";

    if (!name || !sessionCode || !hostId) {
      window.alert("Open the session link from the host or provide a valid session code link.");
      return;
    }

    setCurrentName(name);
    joinSession(name, sessionCode, hostId);
  });

  elements.shareButton.addEventListener("click", async () => {
    try {
      await copyInviteLink();
      elements.shareFeedback.textContent = "Copied";
      window.setTimeout(() => {
        if (elements.shareFeedback.textContent === "Copied") {
          elements.shareFeedback.textContent = "";
        }
      }, 1800);
    } catch (error) {
      console.error(error);
      elements.shareFeedback.textContent = "Copy failed";
    }
  });

  elements.participants.addEventListener("click", (event) => {
    const editButton = event.target.closest(".edit-name-button");
    if (!editButton) {
      return;
    }

    const currentName = state.session.participants[state.selfId]?.name || state.currentName;
    const nextNameInput = window.prompt("Enter your name", currentName);
    if (nextNameInput === null) {
      return;
    }

    const name = saveName(nextNameInput);
    if (name) {
      updateParticipantName(name);
      renderSession();
    }
  });

  elements.settingsButton.addEventListener("click", () => {
    openSettingsModal();
  });

  elements.closeSettingsButton.addEventListener("click", () => {
    closeSettingsModal();
  });

  elements.settingsOverlay.addEventListener("click", () => {
    closeSettingsModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettingsModal();
    }
  });

  const handleSettingChange = (key, checked) => {
    if (state.mode !== "host") {
      return;
    }
    state.session.settings[key] = checked;
    if (!checked && key === "countdown") {
      state.session.countdownEndsAt = null;
      clearRevealTimeout();
      stopCountdownTicker();
    }
    sendSessionSnapshot();
    renderSession();
  };

  elements.autoRevealToggle.addEventListener("change", (event) => {
    handleSettingChange("autoReveal", event.target.checked);
    maybeAutoReveal();
  });

  elements.funToggle.addEventListener("change", (event) => {
    handleSettingChange("enableFun", event.target.checked);
  });

  elements.averageToggle.addEventListener("change", (event) => {
    handleSettingChange("showAverage", event.target.checked);
  });

  elements.countdownToggle.addEventListener("change", (event) => {
    handleSettingChange("countdown", event.target.checked);
  });

  elements.revealButton.addEventListener("click", () => {
    if (state.mode !== "host") {
      return;
    }

    revealVotes();
  });

  elements.resetButton.addEventListener("click", () => {
    if (state.mode !== "host") {
      return;
    }

    resetRound();
  });
}

function initializePeer() {
  state.peer = new Peer();

  state.peer.on("open", (id) => {
    state.selfId = id;
    setStatus("Ready");
    const url = new URL(window.location.href);
    const sessionCode = normalizeCode(url.searchParams.get("session") || "");
    const hostId = url.searchParams.get("host") || "";
    state.inviteContext.sessionCode = sessionCode;
    state.inviteContext.hostId = hostId;

    if (sessionCode) {
      elements.joinSessionCode.value = sessionCode;
    }

    if (hostId && sessionCode) {
      showJoinSetup(true);
    } else {
      showSetupChoice();
    }
  });

  state.peer.on("connection", (connection) => {
    if (state.mode !== "host") {
      connection.close();
      return;
    }

    setupHostConnection(connection);
  });

  state.peer.on("disconnected", () => {
    setStatus("Connection lost, retrying...", true);
    state.peer.reconnect();
  });

  state.peer.on("error", (error) => {
    console.error(error);
    setStatus("Realtime connection error", true);
  });
}

wireEvents();
renderCards();
renderParticipants();
initializePeer();
