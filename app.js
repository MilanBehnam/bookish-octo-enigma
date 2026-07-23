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
  socket: null,
  mode: null,
  selfId: null,
  countdownInterval: null,
  currentName: localStorage.getItem("planning-poker-name") || "",
  selectedVote: null,
  inviteContext: {
    sessionCode: "",
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

function setStatus(text, isError = false) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.style.background = isError ? "#fde8e8" : "";
  elements.connectionStatus.style.color = isError ? "#b42318" : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  if (sessionCode) {
    url.searchParams.set("session", sessionCode);
  } else {
    url.searchParams.delete("session");
  }
  if (hostId) {
    url.searchParams.set("host", hostId);
  } else {
    url.searchParams.delete("host");
  }
  window.history.replaceState({}, "", url);
}

function buildShareLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("session", state.session.sessionCode);
  if (state.session.hostId) {
    url.searchParams.set("host", state.session.hostId);
  }
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
    const numericFibonacciValues = fibonacciValues.map((value) => Number(value)).filter((value) => Number.isFinite(value));
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

function startCountdownTicker() {
  if (state.countdownInterval) {
    return;
  }
  state.countdownInterval = window.setInterval(() => {
    if (!state.session.countdownEndsAt || state.session.revealed) {
      stopCountdownTicker();
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
        participant.id === state.selfId ? '<button type="button" class="edit-name-button" aria-label="Edit your name">✎</button>' : "";

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

function emitToServer(event, payload) {
  if (!state.socket?.connected) {
    window.alert("Realtime connection is unavailable.");
    return false;
  }
  state.socket.emit(event, payload);
  return true;
}

function createHostSession(hostName) {
  state.mode = "host";
  const sent = emitToServer("create-session", { name: hostName });
  if (sent) {
    setStatus("Creating session...");
  }
}

function joinSession(name, sessionCode) {
  state.mode = "participant";
  const sent = emitToServer("join-session", { name, sessionCode });
  if (sent) {
    setStatus("Joining session...");
  }
}

function submitVote(value) {
  if (!state.session.sessionCode) {
    window.alert("Join or create a session first.");
    return;
  }
  state.selectedVote = value;
  emitToServer("vote", {
    vote: value,
    name: state.currentName,
  });
  renderCards();
}

function updateParticipantName(name) {
  emitToServer("rename", { name });
}

function revealVotes() {
  if (state.mode !== "host" || state.session.revealed) {
    return;
  }
  emitToServer("reveal-votes");
}

function resetRound() {
  if (state.mode !== "host") {
    return;
  }
  state.selectedVote = null;
  emitToServer("reset-round");
}

function applySnapshot(snapshot) {
  const previousReveal = state.session.revealed;
  state.session = normalizeSession(snapshot);
  const selfParticipant = state.session.participants[state.selfId];
  if (selfParticipant?.isHost) {
    state.mode = "host";
  } else if (state.session.sessionCode) {
    state.mode = "participant";
  }
  state.selectedVote = selfParticipant ? selfParticipant.vote : null;
  updateUrl(state.session.sessionCode, state.session.hostId);
  if (state.session.revealed && !previousReveal) {
    playFunReveal();
  }
  renderSession();
}

function handleSessionEnded() {
  state.mode = null;
  state.selectedVote = null;
  state.session = {
    sessionCode: "",
    hostId: "",
    hostName: "Host",
    revealed: false,
    countdownEndsAt: null,
    settings: getDefaultSettings(),
    participants: {},
  };
  updateUrl();
  renderSession();
  showSetupChoice();
  window.alert("Session ended because host disconnected.");
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

    if (!name || !sessionCode) {
      window.alert("Open the session link from the host or provide a valid session code.");
      return;
    }

    setCurrentName(name);
    joinSession(name, sessionCode);
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
    emitToServer("update-settings", state.session.settings);
    renderSession();
  };

  elements.autoRevealToggle.addEventListener("change", (event) => {
    handleSettingChange("autoReveal", event.target.checked);
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
    revealVotes();
  });

  elements.resetButton.addEventListener("click", () => {
    resetRound();
  });
}

function initializeSocket() {
  state.socket = io();

  state.socket.on("connect", () => {
    state.selfId = state.socket.id;
    setStatus("Ready");
    const url = new URL(window.location.href);
    const sessionCode = normalizeCode(url.searchParams.get("session") || "");
    state.inviteContext.sessionCode = sessionCode;

    if (sessionCode && !state.session.sessionCode) {
      elements.joinSessionCode.value = sessionCode;
      showJoinSetup(true);
    } else if (!state.session.sessionCode) {
      showSetupChoice();
    }
  });

  state.socket.on("disconnect", () => {
    setStatus("Connection lost, reconnecting...", true);
  });

  state.socket.on("connect_error", () => {
    setStatus("Realtime connection error", true);
  });

  state.socket.on("session-created", ({ sessionCode }) => {
    setStatus("Session created");
    if (sessionCode) {
      state.inviteContext.sessionCode = sessionCode;
    }
  });

  state.socket.on("joined-session", () => {
    setStatus("Joined session");
  });

  state.socket.on("join-error", ({ message }) => {
    setStatus("Unable to join session", true);
    window.alert(message || "Unable to join session.");
    showJoinSetup(false);
  });

  state.socket.on("session-state", (snapshot) => {
    applySnapshot(snapshot);
  });

  state.socket.on("session-ended", () => {
    setStatus("Session ended", true);
    handleSessionEnded();
  });
}

wireEvents();
renderCards();
renderParticipants();
initializeSocket();
