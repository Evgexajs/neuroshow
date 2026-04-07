/**
 * Neuroshow Debug UI - SSE Client and Event Feed
 * Handles connection to /shows/:id/events and displays events in real-time
 */

// Types
interface ShowEvent {
  sequenceNumber: number;
  timestamp: number;
  channel?: string;
  senderId?: string;
  phaseId?: string;
  type?: string;
  content?: string;
  audienceIds?: string[];
}

interface Character {
  id: string;
  name: string;
  modelAdapterId: string;
  publicCard: string;
}

interface CharacterDefinition {
  id: string;
  name: string;
  publicCard: string;
  privateCard: string;
  modelAdapterId?: string;
}

interface ShowFormatTemplate {
  id: string;
  name: string;
  description: string;
  minParticipants: number;
  maxParticipants: number;
  phases: unknown[];
  tokenBudget: unknown;
}

interface PhaseConfig {
  id: string;
  name: string;
  type: string;
  durationMode: string;
  durationValue: number | string;
  allowedChannels: string[];
}

interface ShowConfig {
  templateId: string;
  templateName: string;
  templateDescription: string;
  phases: PhaseConfig[];
  currentPhaseId: string | null;
}

type CharacterStatus = 'waiting' | 'speaking' | 'in-private';

type ShowStatus = 'created' | 'running' | 'paused' | 'completed' | 'aborted' | null;

interface StatusResponse {
  status: ShowStatus;
  currentPhaseId: string | null;
  eventsCount: number;
  tokenBudget: {
    total: number;
    used: number;
    mode: string;
    percentUsed: number;
  } | null;
}

type ControlAction = 'start' | 'pause' | 'resume' | 'step' | 'rollback';

// DOM Elements
const showIdInput = document.getElementById('show-id') as HTMLInputElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const eventsContainer = document.getElementById('events-container') as HTMLDivElement;
const cardsContainer = document.getElementById('cards-container') as HTMLDivElement;
const templateDetailsEl = document.getElementById('template-details') as HTMLDivElement;
const phasesListEl = document.getElementById('phases-list') as HTMLDivElement;

// Control Panel Elements
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
const stepBtn = document.getElementById('step-btn') as HTMLButtonElement;
const rollbackBtn = document.getElementById('rollback-btn') as HTMLButtonElement;
const showStatusEl = document.getElementById('show-status') as HTMLSpanElement;
const currentPhaseEl = document.getElementById('current-phase') as HTMLSpanElement;
const turnNumberEl = document.getElementById('turn-number') as HTMLSpanElement;
const tokenProgressEl = document.getElementById('token-progress') as HTMLDivElement;
const tokenTextEl = document.getElementById('token-text') as HTMLSpanElement;

// New Show Modal Elements
const newShowBtn = document.getElementById('new-show-btn') as HTMLButtonElement;
const newShowModal = document.getElementById('new-show-modal') as HTMLDivElement;
const modalOverlay = document.getElementById('modal-overlay') as HTMLDivElement;
const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLButtonElement;
const templateSelect = document.getElementById('template-select') as HTMLSelectElement;
const templateInfo = document.getElementById('template-info') as HTMLDivElement;
const charactersList = document.getElementById('characters-list') as HTMLDivElement;
const charactersValidation = document.getElementById('characters-validation') as HTMLDivElement;
const createError = document.getElementById('create-error') as HTMLDivElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const createShowBtn = document.getElementById('create-show-btn') as HTMLButtonElement;
const themeInput = document.getElementById('theme-input') as HTMLInputElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const generateStatus = document.getElementById('generate-status') as HTMLDivElement;
const tokenBudgetInput = document.getElementById('token-budget-input') as HTMLInputElement;

// History Modal Elements
const showHistoryBtn = document.getElementById('show-history-btn') as HTMLButtonElement;
const showHistoryModal = document.getElementById('show-history-modal') as HTMLDivElement;
const historyModalOverlay = document.getElementById('history-modal-overlay') as HTMLDivElement;
const historyModalCloseBtn = document.getElementById('history-modal-close-btn') as HTMLButtonElement;
const historyCloseBtn = document.getElementById('history-close-btn') as HTMLButtonElement;
const recentShowsList = document.getElementById('recent-shows-list') as HTMLDivElement;
const allShowsList = document.getElementById('all-shows-list') as HTMLDivElement;

// State
let eventSource: EventSource | null = null;
let currentShowId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

// Character state
let characters: Character[] = [];
const characterStatuses: Map<string, CharacterStatus> = new Map();
let activeCharacterId: string | null = null;

// Character name lookup and color assignment
const characterNames: Map<string, string> = new Map();
const characterColors: Map<string, string> = new Map();
const CHARACTER_COLORS = [
  '#e57373', // red
  '#64b5f6', // blue
  '#81c784', // green
  '#ffb74d', // orange
  '#ba68c8', // purple
  '#4dd0e1', // cyan
  '#fff176', // yellow
  '#a1887f', // brown
  '#90a4ae', // blue-grey
  '#f06292', // pink
];

// Phase tracking
let currentPhaseId: string | null = null;
let phaseEventCount = 0;

// Control panel state
let currentShowStatus: ShowStatus = null;
let statusPollInterval: ReturnType<typeof setInterval> | null = null;
const STATUS_POLL_INTERVAL_MS = 2000;
let turnCount = 0;
let isReadOnlyMode = false; // True when viewing a completed show

// New show modal state
let availableTemplates: ShowFormatTemplate[] = [];
let availableCharacters: CharacterDefinition[] = [];
let selectedTemplate: ShowFormatTemplate | null = null;
const selectedCharacterIds: Set<string> = new Set();

// Show config state (template + phases)
let showConfig: ShowConfig | null = null;
const phaseTurnCounts: Map<string, number> = new Map();

/**
 * Initialize the application
 */
function init(): void {
  connectBtn.addEventListener('click', () => {
    handleConnect().catch(console.error);
  });
  showIdInput.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnect().catch(console.error);
    }
  });

  // Control panel button listeners
  startBtn.addEventListener('click', () => handleControl('start'));
  pauseBtn.addEventListener('click', () => handleControl('pause'));
  resumeBtn.addEventListener('click', () => handleControl('resume'));
  stepBtn.addEventListener('click', () => handleControl('step'));
  rollbackBtn.addEventListener('click', handleRollback);

  // New show modal listeners
  newShowBtn.addEventListener('click', openNewShowModal);
  modalOverlay.addEventListener('click', closeNewShowModal);
  modalCloseBtn.addEventListener('click', closeNewShowModal);
  cancelBtn.addEventListener('click', closeNewShowModal);
  templateSelect.addEventListener('change', handleTemplateChange);
  createShowBtn.addEventListener('click', () => {
    handleCreateShow().catch(console.error);
  });
  generateBtn.addEventListener('click', () => {
    handleGenerateCharacters().catch(console.error);
  });

  // History modal listeners
  showHistoryBtn.addEventListener('click', openHistoryModal);
  historyModalOverlay.addEventListener('click', closeHistoryModal);
  historyModalCloseBtn.addEventListener('click', closeHistoryModal);
  historyCloseBtn.addEventListener('click', closeHistoryModal);
}

/**
 * Handle connect button click
 */
async function handleConnect(): Promise<void> {
  const showId = showIdInput.value.trim();
  if (!showId) {
    alert('Please enter a Show ID');
    return;
  }

  if (eventSource) {
    disconnect();
  }

  currentShowId = showId;
  await connect(showId);
}

/**
 * Send control action to the server
 */
async function handleControl(action: ControlAction, phaseId?: string): Promise<void> {
  if (!currentShowId) {
    addSystemMessage('No show connected');
    return;
  }

  try {
    const body: { action: ControlAction; phaseId?: string } = { action };
    if (phaseId) {
      body.phaseId = phaseId;
    }

    const response = await fetch(`/shows/${currentShowId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    addSystemMessage(`Control: ${result.message}`);

    // Refresh status immediately after control action
    await fetchStatus(currentShowId);
  } catch (err) {
    console.error(`Control action ${action} failed:`, err);
    addSystemMessage(`Control failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Handle rollback button click - prompts for phase ID
 */
function handleRollback(): void {
  if (!currentShowId) {
    addSystemMessage('No show connected');
    return;
  }

  const phaseId = prompt('Enter phase ID to rollback to:');
  if (phaseId && phaseId.trim()) {
    handleControl('rollback', phaseId.trim()).catch(console.error);
  }
}

/**
 * Fetch current show status from the server
 */
async function fetchStatus(showId: string): Promise<void> {
  try {
    const response = await fetch(`/shows/${showId}/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const status: StatusResponse = await response.json();
    updateControlPanelUI(status);
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

/**
 * Update the control panel UI based on status
 */
function updateControlPanelUI(status: StatusResponse): void {
  currentShowStatus = status.status;

  // Update current phase if changed
  if (status.currentPhaseId !== currentPhaseId) {
    currentPhaseId = status.currentPhaseId;
    renderTemplateInfo();
  }

  // Update status display
  showStatusEl.textContent = status.status ?? '--';
  currentPhaseEl.textContent = status.currentPhaseId ?? '--';
  turnNumberEl.textContent = status.eventsCount > 0 ? String(status.eventsCount) : '--';

  // Update token counter
  if (status.tokenBudget) {
    const { used, total, percentUsed } = status.tokenBudget;
    tokenProgressEl.style.width = `${Math.min(percentUsed, 100)}%`;
    tokenTextEl.textContent = `${used.toLocaleString()} / ${total.toLocaleString()}`;

    // Change color based on usage
    if (percentUsed >= 90) {
      tokenProgressEl.style.backgroundColor = 'var(--error)';
    } else if (percentUsed >= 70) {
      tokenProgressEl.style.backgroundColor = 'var(--warning)';
    } else {
      tokenProgressEl.style.backgroundColor = 'var(--accent)';
    }
  } else {
    tokenProgressEl.style.width = '0%';
    tokenTextEl.textContent = '0 / 0';
  }

  // Update button states
  updateButtonStates();
}

/**
 * Update control button enabled/disabled states based on show status
 */
function updateButtonStates(): void {
  const isConnected = currentShowId !== null;
  const status = currentShowStatus;

  // Debug logging for button state
  console.log('[Debug UI] updateButtonStates:', {
    isConnected,
    status,
    showId: currentShowId,
    isReadOnlyMode,
  });

  // All buttons disabled for completed/aborted shows (read-only mode)
  if (isReadOnlyMode || status === 'completed' || status === 'aborted') {
    startBtn.disabled = true;
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    stepBtn.disabled = true;
    rollbackBtn.disabled = true;

    console.log('[Debug UI] All buttons disabled (read-only mode)');
    return;
  }

  // START: enabled when connected and show is 'created' or 'paused'
  const canStart = isConnected && (status === 'created' || status === 'paused');
  startBtn.disabled = !canStart;

  // PAUSE: enabled only when running
  pauseBtn.disabled = !isConnected || status !== 'running';

  // RESUME: enabled only when paused
  resumeBtn.disabled = !isConnected || status !== 'paused';

  // STEP: enabled when paused (for DEBUG mode stepping)
  stepBtn.disabled = !isConnected || status !== 'paused';

  // ROLLBACK: enabled when paused or running
  rollbackBtn.disabled = !isConnected || (status !== 'paused' && status !== 'running');

  console.log('[Debug UI] Button states:', {
    startBtn: !startBtn.disabled,
    pauseBtn: !pauseBtn.disabled,
    resumeBtn: !resumeBtn.disabled,
    stepBtn: !stepBtn.disabled,
    rollbackBtn: !rollbackBtn.disabled,
  });
}

/**
 * Start polling for show status
 */
function startStatusPolling(showId: string): void {
  stopStatusPolling();
  fetchStatus(showId).catch(console.error);
  statusPollInterval = setInterval(() => {
    fetchStatus(showId).catch(console.error);
  }, STATUS_POLL_INTERVAL_MS);
}

/**
 * Stop polling for show status
 */
function stopStatusPolling(): void {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}

/**
 * Fetch characters for a show
 */
async function fetchCharacters(showId: string): Promise<void> {
  try {
    const response = await fetch(`/shows/${showId}/characters`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as { characters: Character[] };
    characters = data.characters;

    // Initialize statuses and name/color lookup
    characterStatuses.clear();
    characterNames.clear();
    characterColors.clear();
    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      characterStatuses.set(char.id, 'waiting');
      characterNames.set(char.id, char.name);
      characterColors.set(char.id, CHARACTER_COLORS[i % CHARACTER_COLORS.length]);
    }
    activeCharacterId = null;
    currentPhaseId = null;
    phaseEventCount = 0;

    renderCharacterCards();
  } catch (err) {
    console.error('Failed to fetch characters:', err);
    addSystemMessage('Failed to load characters');
  }
}

/**
 * Render character cards
 */
function renderCharacterCards(): void {
  if (characters.length === 0) {
    cardsContainer.innerHTML = '<p class="placeholder">No characters loaded...</p>';
    return;
  }

  cardsContainer.innerHTML = '';

  for (const char of characters) {
    const status = characterStatuses.get(char.id) ?? 'waiting';
    const isActive = char.id === activeCharacterId;

    const cardEl = document.createElement('div');
    cardEl.className = `character-card${isActive ? ' active' : ''}${status === 'speaking' ? ' speaking' : ''}${status === 'in-private' ? ' in-private' : ''}`;
    cardEl.dataset.characterId = char.id;

    cardEl.innerHTML = `
      <div class="character-name">${escapeHtml(char.name)}</div>
      <div class="character-model">${escapeHtml(char.modelAdapterId)}</div>
      <div class="character-public-card">${escapeHtml(char.publicCard)}</div>
      <span class="character-status ${status}">${formatStatus(status)}</span>
    `;

    cardsContainer.appendChild(cardEl);
  }
}

/**
 * Fetch show config (template + phases)
 */
async function fetchShowConfig(showId: string): Promise<void> {
  try {
    const response = await fetch(`/shows/${showId}/config`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    showConfig = await response.json() as ShowConfig;

    // Initialize turn counts for each phase
    phaseTurnCounts.clear();
    for (const phase of showConfig.phases) {
      phaseTurnCounts.set(phase.id, 0);
    }

    renderTemplateInfo();
  } catch (err) {
    console.error('Failed to fetch show config:', err);
    addSystemMessage('Failed to load show config');
  }
}

/**
 * Render template info panel
 */
function renderTemplateInfo(): void {
  if (!showConfig) {
    templateDetailsEl.innerHTML = '<p class="placeholder">No template loaded...</p>';
    phasesListEl.innerHTML = '';
    return;
  }

  // Render template details
  templateDetailsEl.innerHTML = `
    <div class="template-name">${escapeHtml(showConfig.templateName)}</div>
    <div class="template-description">${escapeHtml(showConfig.templateDescription || '')}</div>
  `;

  // Render phases list
  phasesListEl.innerHTML = '';
  for (const phase of showConfig.phases) {
    const isCurrent = phase.id === currentPhaseId;
    const turnCount = phaseTurnCounts.get(phase.id) ?? 0;
    // Total turns = durationValue × number of characters (each character speaks durationValue times)
    const turnsPerChar = typeof phase.durationValue === 'number' ? phase.durationValue : 0;
    const maxTurns = turnsPerChar * characters.length;
    const progressPercent = maxTurns > 0 ? Math.min((turnCount / maxTurns) * 100, 100) : 0;

    const phaseEl = document.createElement('div');
    phaseEl.className = `phase-item${isCurrent ? ' current' : ''}`;
    phaseEl.dataset.phaseId = phase.id;

    // Build channels HTML
    const channelsHtml = phase.allowedChannels
      .map((ch) => `<span class="channel-tag ${ch.toLowerCase()}">${ch}</span>`)
      .join('');

    // Build progress HTML (only for current phase with turns-based duration)
    let progressHtml = '';
    if (phase.durationMode === 'turns' && maxTurns > 0) {
      progressHtml = `
        <div class="phase-progress">
          <div class="phase-progress-bar">
            <div class="phase-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <div class="phase-progress-text">${turnCount} / ${maxTurns} ходов</div>
        </div>
      `;
    }

    phaseEl.innerHTML = `
      <div class="phase-header">
        <span class="phase-name">${escapeHtml(phase.name)}</span>
        <span class="phase-type">${escapeHtml(phase.type)}</span>
      </div>
      <div class="phase-details">
        <div class="phase-turns">
          <span>${phase.durationMode}: ${maxTurns} (${turnsPerChar}×${characters.length})</span>
        </div>
        <div class="phase-channels">${channelsHtml}</div>
      </div>
      ${progressHtml}
    `;

    phasesListEl.appendChild(phaseEl);
  }
}

/**
 * Update phase progress when speech event received
 */
function updatePhaseProgress(phaseId: string): void {
  if (!phaseId) return;

  const count = (phaseTurnCounts.get(phaseId) ?? 0) + 1;
  phaseTurnCounts.set(phaseId, count);

  // Re-render template info to update progress bar
  renderTemplateInfo();
}

/**
 * Format status for display
 */
function formatStatus(status: CharacterStatus): string {
  switch (status) {
    case 'waiting':
      return 'Waiting';
    case 'speaking':
      return 'Speaking';
    case 'in-private':
      return 'In Private';
    default:
      return 'Unknown';
  }
}

/**
 * Update character status based on event
 */
function updateCharacterStatus(event: ShowEvent): void {
  const { type, senderId, channel } = event;

  // Handle speech events - mark sender as speaking
  if (type === 'speech' && senderId) {
    // Reset previous active character
    if (activeCharacterId && activeCharacterId !== senderId) {
      characterStatuses.set(activeCharacterId, 'waiting');
    }

    // Set new active character
    activeCharacterId = senderId;

    if (channel === 'PRIVATE') {
      characterStatuses.set(senderId, 'in-private');
    } else {
      characterStatuses.set(senderId, 'speaking');
    }

    renderCharacterCards();
    return;
  }

  // Handle channel change events
  if (type === 'channel_change' && senderId) {
    if (channel === 'PRIVATE') {
      characterStatuses.set(senderId, 'in-private');
    } else {
      characterStatuses.set(senderId, 'waiting');
    }
    renderCharacterCards();
    return;
  }

  // Handle phase transitions - reset all to waiting
  if (type === 'phase_start' || type === 'phase_end') {
    for (const charId of characterStatuses.keys()) {
      characterStatuses.set(charId, 'waiting');
    }
    activeCharacterId = null;
    renderCharacterCards();
  }
}

/**
 * Connect to SSE endpoint for a show
 */
async function connect(showId: string): Promise<void> {
  clearEvents();
  addSystemMessage('Connecting to show...');

  // Fetch characters, config, and start status polling
  await fetchCharacters(showId);
  await fetchShowConfig(showId);
  startStatusPolling(showId);

  const url = `/shows/${showId}/events`;
  eventSource = new EventSource(url);

  eventSource.onopen = (): void => {
    reconnectAttempts = 0;
    addSystemMessage('Connected to event stream');
    connectBtn.textContent = 'Disconnect';
    // Save to recent shows
    saveToRecentShows(showId);
  };

  eventSource.onmessage = (event: MessageEvent<string>): void => {
    try {
      const showEvent: ShowEvent = JSON.parse(event.data);
      addEventToFeed(showEvent);
      updateCharacterStatus(showEvent);

      // Count speech events as turns and update phase progress
      if (showEvent.type === 'speech') {
        turnCount++;
        turnNumberEl.textContent = String(turnCount);
        if (showEvent.phaseId) {
          updatePhaseProgress(showEvent.phaseId);
        }
      }

      // Update current phase when phase_start received
      if (showEvent.type === 'phase_start' && showEvent.phaseId) {
        currentPhaseId = showEvent.phaseId;
        renderTemplateInfo();
      }
    } catch (err) {
      console.error('Failed to parse event:', err);
    }
  };

  eventSource.onerror = (): void => {
    if (eventSource?.readyState === EventSource.CLOSED) {
      addSystemMessage('Connection closed');
      attemptReconnect();
    } else if (eventSource?.readyState === EventSource.CONNECTING) {
      addSystemMessage('Reconnecting...');
    }
  };
}

/**
 * Disconnect from the current SSE stream
 */
function disconnect(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  currentShowId = null;
  reconnectAttempts = 0;
  isReadOnlyMode = false; // Reset read-only mode
  connectBtn.textContent = 'Connect';
  addSystemMessage('Disconnected');

  // Clear character state
  characters = [];
  characterStatuses.clear();
  characterNames.clear();
  characterColors.clear();
  activeCharacterId = null;
  currentPhaseId = null;
  phaseEventCount = 0;
  cardsContainer.innerHTML = '<p class="placeholder">No characters loaded...</p>';

  // Clear show config state
  showConfig = null;
  phaseTurnCounts.clear();
  templateDetailsEl.innerHTML = '<p class="placeholder">Connect to a show to see template info...</p>';
  phasesListEl.innerHTML = '';

  // Stop status polling and reset control panel
  stopStatusPolling();
  currentShowStatus = null;
  resetControlPanelUI();
}

/**
 * Reset control panel UI to default state
 */
function resetControlPanelUI(): void {
  showStatusEl.textContent = '--';
  currentPhaseEl.textContent = '--';
  turnNumberEl.textContent = '--';
  tokenProgressEl.style.width = '0%';
  tokenTextEl.textContent = '0 / 0';
  updateButtonStates();
}

/**
 * Attempt to reconnect after connection loss
 */
function attemptReconnect(): void {
  if (!currentShowId) return;

  reconnectAttempts++;

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    addSystemMessage(`Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
    disconnect();
    return;
  }

  addSystemMessage(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  setTimeout(() => {
    if (currentShowId) {
      connect(currentShowId);
    }
  }, RECONNECT_DELAY_MS);
}

/**
 * Clear all events from the feed
 */
function clearEvents(): void {
  eventsContainer.innerHTML = '';
  turnCount = 0;
  currentPhaseId = null;
  phaseEventCount = 0;
}

/**
 * Add a system message to the feed
 */
function addSystemMessage(message: string): void {
  const messageEl = document.createElement('div');
  messageEl.className = 'event-item system-message';
  messageEl.style.backgroundColor = 'var(--bg-light)';
  messageEl.style.color = 'var(--text-secondary)';
  messageEl.style.fontStyle = 'italic';
  messageEl.style.borderLeftColor = 'var(--accent)';

  const time = formatTime(Date.now());
  messageEl.innerHTML = `
    <div class="event-header">
      <span class="event-sender">System</span>
      <span class="event-time">${time}</span>
    </div>
    <div class="event-content">${escapeHtml(message)}</div>
  `;

  eventsContainer.appendChild(messageEl);
  scrollToBottom();
}

/**
 * Get character name by ID
 */
function getCharacterName(characterId: string | undefined): string {
  if (!characterId) return 'System';
  return characterNames.get(characterId) ?? characterId;
}

/**
 * Get character color by ID
 */
function getCharacterColor(characterId: string | undefined): string | null {
  if (!characterId) return null;
  return characterColors.get(characterId) ?? null;
}

/**
 * Get audience names from audience IDs
 */
function getAudienceNames(audienceIds: string[] | undefined): string {
  if (!audienceIds || audienceIds.length === 0) return '';
  const names = audienceIds.map(id => getCharacterName(id));
  return names.join(', ');
}

/**
 * Add a phase separator to the feed
 */
function addPhaseSeparator(phaseId: string, isStart: boolean): void {
  const separatorEl = document.createElement('div');
  separatorEl.className = 'phase-separator';

  const label = isStart ? `Фаза: ${phaseId}` : `Конец фазы: ${phaseId}`;
  separatorEl.innerHTML = `<span class="phase-label">${escapeHtml(label)}</span>`;

  eventsContainer.appendChild(separatorEl);
}

/**
 * Add empty phase message
 */
function addEmptyPhaseMessage(): void {
  const messageEl = document.createElement('div');
  messageEl.className = 'empty-phase-message';
  messageEl.innerHTML = `<span>Нет событий в этой фазе</span>`;

  eventsContainer.appendChild(messageEl);
}

/**
 * Add an event to the feed
 */
function addEventToFeed(event: ShowEvent): void {
  const eventPhaseId = event.phaseId ?? null;
  const eventType = event.type ?? '';

  // Skip internal events that shouldn't be shown to viewers
  // host_trigger = LLM instructions, not for humans
  if (eventType === 'host_trigger') {
    return;
  }

  // Handle phase transitions
  if (eventType === 'phase_start' && eventPhaseId) {
    // Check if previous phase was empty
    if (currentPhaseId && phaseEventCount === 0) {
      addEmptyPhaseMessage();
    }
    addPhaseSeparator(eventPhaseId, true);
    currentPhaseId = eventPhaseId;
    phaseEventCount = 0;
  } else if (eventType === 'phase_end' && eventPhaseId) {
    if (phaseEventCount === 0) {
      addEmptyPhaseMessage();
    }
    currentPhaseId = null;
    phaseEventCount = 0;
  }

  // Track events in current phase (only speech events count)
  if (eventType === 'speech') {
    phaseEventCount++;
  }

  const eventEl = document.createElement('div');

  // Get channel class for color coding
  const channelClass = getChannelClass(event.channel);
  eventEl.className = `event-item ${channelClass}`;

  // Format event data
  const time = formatTime(event.timestamp);
  const senderName = getCharacterName(event.senderId);
  const senderColor = getCharacterColor(event.senderId);
  const channel = event.channel ?? '';
  const type = eventType;

  // Build header info
  let headerInfo = `${channel}`;
  if (type && type !== 'speech') {
    headerInfo += ` | ${type}`;
  }

  // For PRIVATE events, show audience
  let audienceInfo = '';
  if (channel === 'PRIVATE' && event.audienceIds) {
    const audienceNames = getAudienceNames(event.audienceIds);
    if (audienceNames) {
      audienceInfo = `<span class="event-audience">→ ${escapeHtml(audienceNames)}</span>`;
    }
  }

  // Apply character color to sender name
  const senderStyle = senderColor ? `style="color: ${senderColor}; font-weight: 700;"` : '';

  eventEl.innerHTML = `
    <div class="event-header">
      <span class="event-sender" ${senderStyle}>${escapeHtml(senderName)}</span>
      ${audienceInfo}
      <span class="event-meta">${escapeHtml(headerInfo)}</span>
      <span class="event-time">${time}</span>
    </div>
    <div class="event-content">${escapeHtml(event.content ?? '')}</div>
  `;

  // Store sequence number for potential debugging
  eventEl.dataset.sequenceNumber = String(event.sequenceNumber);

  eventsContainer.appendChild(eventEl);
  scrollToBottom();
}

/**
 * Get CSS class for channel color coding
 */
function getChannelClass(channel: string | undefined): string {
  switch (channel) {
    case 'PUBLIC':
      return 'channel-public';
    case 'PRIVATE':
      return 'channel-private';
    case 'ZONE':
      return 'channel-zone';
    default:
      return 'channel-public';
  }
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Scroll the events container to the bottom
 */
function scrollToBottom(): void {
  eventsContainer.scrollTop = eventsContainer.scrollHeight;
}

/**
 * Open the new show modal and load data
 */
function openNewShowModal(): void {
  newShowModal.classList.remove('hidden');
  createError.classList.add('hidden');
  loadModalData().catch(console.error);
}

/**
 * Close the new show modal
 */
function closeNewShowModal(): void {
  newShowModal.classList.add('hidden');
  resetModalState();
}

/**
 * Reset modal state
 */
function resetModalState(): void {
  selectedTemplate = null;
  selectedCharacterIds.clear();
  templateSelect.value = '';
  templateInfo.textContent = '';
  charactersValidation.textContent = '';
  charactersValidation.className = 'validation-message';
  createShowBtn.disabled = true;
  createError.classList.add('hidden');
  themeInput.value = '';
  tokenBudgetInput.value = '';
  generateStatus.classList.add('hidden');
  generateStatus.classList.remove('error');
}

// ==================== History Modal ====================

interface ShowHistoryItem {
  id: string;
  status: string;
  formatId: string;
  startedAt: number | null;
  completedAt: number | null;
}

interface RecentShowInfo {
  id: string;
  status: string;
  formatId: string;
  savedAt: number;
}

/**
 * Open the history modal and load shows
 */
function openHistoryModal(): void {
  showHistoryModal.classList.remove('hidden');
  loadShowHistory().catch(console.error);
}

/**
 * Close the history modal
 */
function closeHistoryModal(): void {
  showHistoryModal.classList.add('hidden');
}

interface ServerShowResponse {
  showId: string;
  status: string;
  createdAt: string | null;
  templateName: string;
}

/**
 * Load show history from server
 */
async function loadShowHistory(): Promise<void> {
  // Show loading state
  allShowsList.innerHTML = '<p class="placeholder">Loading...</p>';

  try {
    const response = await fetch('/shows');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { shows: ServerShowResponse[] };
    // Map server response to ShowHistoryItem format
    const shows: ShowHistoryItem[] = data.shows.map((s) => ({
      id: s.showId,
      status: s.status,
      formatId: s.templateName,
      startedAt: s.createdAt ? new Date(s.createdAt).getTime() : null,
      completedAt: null,
    }));
    renderShowHistory(shows);
  } catch (err) {
    console.error('Failed to load show history:', err);
    allShowsList.innerHTML = '<p class="placeholder error">Failed to load shows</p>';
  }

  // Load recent shows from localStorage
  loadRecentShows();
}

/**
 * Load recent shows from localStorage
 */
function loadRecentShows(): void {
  const recentShows = getRecentShows();
  if (recentShows.length === 0) {
    recentShowsList.innerHTML = '<p class="placeholder">No recent shows...</p>';
    return;
  }

  recentShowsList.innerHTML = recentShows
    .map((show) => {
      const dateStr = show.savedAt
        ? new Date(show.savedAt).toLocaleString()
        : 'Unknown date';
      const statusClass = `status-${show.status}`;

      return `
        <div class="history-item" data-show-id="${show.id}">
          <div class="history-item-info">
            <span class="history-show-id">${show.id}</span>
            <span class="history-status ${statusClass}">${show.status}</span>
          </div>
          <span class="history-template">${show.formatId}</span>
          <span class="history-date">${dateStr}</span>
        </div>
      `;
    })
    .join('');

  // Add click listeners
  recentShowsList.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => {
      const showId = (item as HTMLElement).dataset.showId;
      if (showId) {
        selectShowFromHistory(showId).catch(console.error);
      }
    });
  });
}

/**
 * Get recent shows from localStorage, handling migration from old format
 */
function getRecentShows(): RecentShowInfo[] {
  try {
    const stored = localStorage.getItem('neuroshow_recent_shows');
    if (stored) {
      const parsed = JSON.parse(stored) as (string | RecentShowInfo)[];
      // Migrate old format (string IDs) to new format (objects)
      return parsed.map((item) => {
        if (typeof item === 'string') {
          // Old format: just the ID string
          return {
            id: item,
            status: 'unknown',
            formatId: 'Unknown',
            savedAt: 0,
          };
        }
        // New format or object - ensure it has required fields
        if (item && typeof item === 'object' && 'id' in item) {
          return {
            id: String(item.id),
            status: String(item.status ?? 'unknown'),
            formatId: String(item.formatId ?? 'Unknown'),
            savedAt: Number(item.savedAt) || 0,
          };
        }
        // Fallback for malformed data
        return {
          id: String(item),
          status: 'unknown',
          formatId: 'Unknown',
          savedAt: 0,
        };
      });
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Save show to recent shows in localStorage with full info
 */
function saveToRecentShows(showId: string): void {
  const recent = getRecentShows();
  // Remove if already exists
  const filtered = recent.filter((show) => show.id !== showId);
  // Create new entry with current show info
  const newEntry: RecentShowInfo = {
    id: showId,
    status: currentShowStatus ?? 'created',
    formatId: showConfig?.templateId ?? 'Unknown',
    savedAt: Date.now(),
  };
  // Add to front
  filtered.unshift(newEntry);
  // Keep only last 10
  const trimmed = filtered.slice(0, 10);
  localStorage.setItem('neuroshow_recent_shows', JSON.stringify(trimmed));
}

/**
 * Render show history list
 */
function renderShowHistory(shows: ShowHistoryItem[]): void {
  if (shows.length === 0) {
    allShowsList.innerHTML = '<p class="placeholder">No shows found</p>';
    return;
  }

  allShowsList.innerHTML = shows
    .map((show) => {
      const dateStr = show.startedAt
        ? new Date(show.startedAt).toLocaleString()
        : 'Not started';
      const statusClass = `status-${show.status}`;

      return `
        <div class="history-item" data-show-id="${show.id}">
          <div class="history-item-info">
            <span class="history-show-id">${show.id}</span>
            <span class="history-status ${statusClass}">${show.status}</span>
          </div>
          <span class="history-template">${show.formatId}</span>
          <span class="history-date">${dateStr}</span>
        </div>
      `;
    })
    .join('');

  // Add click listeners
  allShowsList.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => {
      const showId = (item as HTMLElement).dataset.showId;
      if (showId) {
        selectShowFromHistory(showId).catch(console.error);
      }
    });
  });
}

/**
 * Select a show from history and connect to it
 * For completed shows, loads events as read-only log instead of SSE connection
 */
async function selectShowFromHistory(showId: string): Promise<void> {
  closeHistoryModal();
  showIdInput.value = showId;

  // First, check the show status to determine connection mode
  try {
    const response = await fetch(`/shows/${showId}/status`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const status: StatusResponse = await response.json();

    if (status.status === 'completed' || status.status === 'aborted') {
      // Load completed show as read-only log
      await connectToCompletedShow(showId, status);
    } else {
      // Connect via SSE for active shows
      await handleConnect();
    }
  } catch (err) {
    console.error('Failed to check show status:', err);
    // Fallback to normal connect on error
    await handleConnect();
  }
}

/**
 * Connect to a completed show in read-only mode
 * Loads all events from DB and displays as a log without SSE
 */
async function connectToCompletedShow(showId: string, status: StatusResponse): Promise<void> {
  if (eventSource) {
    disconnect();
  }

  clearEvents();
  isReadOnlyMode = true;
  currentShowId = showId;
  currentShowStatus = status.status;

  addSystemMessage(`Loading completed show (${status.status})...`);

  // Fetch characters, config, and status
  await fetchCharacters(showId);
  await fetchShowConfig(showId);

  // Update UI with status
  updateControlPanelUI(status);

  // Load all events via snapshot mode (not SSE)
  try {
    const response = await fetch(`/shows/${showId}/events?snapshot=true`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Read SSE-formatted response and parse events
    const text = await response.text();
    const events = parseSSEEvents(text);

    addSystemMessage(`Loaded ${events.length} events from history`);

    // Display all events
    for (const event of events) {
      addEventToFeed(event);
      updateCharacterStatus(event);

      if (event.type === 'speech') {
        turnCount++;
        if (event.phaseId) {
          const count = (phaseTurnCounts.get(event.phaseId) ?? 0) + 1;
          phaseTurnCounts.set(event.phaseId, count);
        }
      }

      if (event.type === 'phase_start' && event.phaseId) {
        currentPhaseId = event.phaseId;
      }
    }

    // Update turn number and phase info
    turnNumberEl.textContent = turnCount > 0 ? String(turnCount) : '--';
    renderTemplateInfo();

    addSystemMessage('Read-only mode: viewing completed show history');

    connectBtn.textContent = 'Disconnect';
    saveToRecentShows(showId);
  } catch (err) {
    console.error('Failed to load show events:', err);
    addSystemMessage(`Failed to load events: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Parse SSE-formatted text into ShowEvent array
 */
function parseSSEEvents(sseText: string): ShowEvent[] {
  const events: ShowEvent[] = [];
  const lines = sseText.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const jsonStr = line.slice(6); // Remove 'data: ' prefix
        const event = JSON.parse(jsonStr) as ShowEvent;
        events.push(event);
      } catch {
        // Skip invalid JSON lines
      }
    }
  }

  return events;
}

/**
 * Load templates and characters for the modal
 */
async function loadModalData(): Promise<void> {
  // Load templates
  templateSelect.innerHTML = '<option value="">Loading templates...</option>';
  charactersList.innerHTML = '<p class="loading-text">Loading characters...</p>';

  try {
    const [templatesResponse, charactersResponse] = await Promise.all([
      fetch('/templates'),
      fetch('/characters'),
    ]);

    if (!templatesResponse.ok) {
      throw new Error('Failed to load templates');
    }
    if (!charactersResponse.ok) {
      throw new Error('Failed to load characters');
    }

    availableTemplates = await templatesResponse.json();
    availableCharacters = await charactersResponse.json();

    renderTemplateSelect();
    renderCharacterCheckboxes();
  } catch (err) {
    console.error('Failed to load modal data:', err);
    templateSelect.innerHTML = '<option value="">Failed to load templates</option>';
    charactersList.innerHTML = '<p class="loading-text">Failed to load characters</p>';
  }
}

/**
 * Render template dropdown options
 */
function renderTemplateSelect(): void {
  templateSelect.innerHTML = '<option value="">Select a template...</option>';

  for (const template of availableTemplates) {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name;
    templateSelect.appendChild(option);
  }
}

/**
 * Render character checkboxes
 */
function renderCharacterCheckboxes(): void {
  if (availableCharacters.length === 0) {
    charactersList.innerHTML = '<p class="loading-text">No characters available</p>';
    return;
  }

  charactersList.innerHTML = '';

  for (const char of availableCharacters) {
    const label = document.createElement('label');
    label.className = 'character-checkbox';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = char.id;
    checkbox.addEventListener('change', handleCharacterToggle);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'char-name';
    nameSpan.textContent = char.name;

    const descSpan = document.createElement('span');
    descSpan.className = 'char-desc';
    descSpan.textContent = `- ${char.publicCard.substring(0, 50)}${char.publicCard.length > 50 ? '...' : ''}`;

    label.appendChild(checkbox);
    label.appendChild(nameSpan);
    label.appendChild(descSpan);
    charactersList.appendChild(label);
  }
}

/**
 * Handle template selection change
 */
function handleTemplateChange(): void {
  const templateId = templateSelect.value;
  selectedTemplate = availableTemplates.find((t) => t.id === templateId) ?? null;

  if (selectedTemplate) {
    templateInfo.textContent = `${selectedTemplate.description} (${selectedTemplate.minParticipants}-${selectedTemplate.maxParticipants} participants)`;
  } else {
    templateInfo.textContent = '';
  }

  validateCharacterSelection();
}

/**
 * Handle character checkbox toggle
 */
function handleCharacterToggle(event: Event): void {
  const checkbox = event.target as HTMLInputElement;
  const charId = checkbox.value;

  if (checkbox.checked) {
    selectedCharacterIds.add(charId);
  } else {
    selectedCharacterIds.delete(charId);
  }

  validateCharacterSelection();
}

/**
 * Validate character selection against template limits
 */
function validateCharacterSelection(): void {
  if (!selectedTemplate) {
    charactersValidation.textContent = '';
    charactersValidation.className = 'validation-message';
    createShowBtn.disabled = true;
    return;
  }

  const count = selectedCharacterIds.size;
  const { minParticipants, maxParticipants } = selectedTemplate;

  if (count < minParticipants) {
    charactersValidation.textContent = `Select at least ${minParticipants} characters (${count} selected)`;
    charactersValidation.className = 'validation-message error';
    createShowBtn.disabled = true;
  } else if (count > maxParticipants) {
    charactersValidation.textContent = `Maximum ${maxParticipants} characters allowed (${count} selected)`;
    charactersValidation.className = 'validation-message error';
    createShowBtn.disabled = true;
  } else {
    charactersValidation.textContent = `${count} characters selected (valid)`;
    charactersValidation.className = 'validation-message valid';
    createShowBtn.disabled = false;
  }
}

/**
 * Handle generate characters button click
 */
async function handleGenerateCharacters(): Promise<void> {
  const theme = themeInput.value.trim();
  const count = selectedTemplate
    ? Math.min(selectedTemplate.maxParticipants, 5)
    : 5;

  generateBtn.disabled = true;
  generateStatus.textContent = 'Generating characters...';
  generateStatus.classList.remove('hidden', 'error');

  try {
    const response = await fetch('/generate/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, theme: theme || undefined }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error ?? `HTTP ${response.status}`);
    }

    const generatedCharacters: CharacterDefinition[] = await response.json();

    // Add generated characters to available characters
    // Replace any previously generated characters (those without a file source)
    const existingFileCharacters = availableCharacters.filter((c) =>
      !c.id.includes('-') || c.id.length < 30
    );

    availableCharacters = [...existingFileCharacters, ...generatedCharacters];

    // Re-render checkboxes
    renderCharacterCheckboxes();

    // Auto-select generated characters
    selectedCharacterIds.clear();
    for (const char of generatedCharacters) {
      selectedCharacterIds.add(char.id);
    }

    // Check all generated character checkboxes
    const checkboxes = charactersList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      const input = checkbox as HTMLInputElement;
      input.checked = selectedCharacterIds.has(input.value);
    });

    // Validate selection
    validateCharacterSelection();

    generateStatus.textContent = `Generated ${generatedCharacters.length} characters`;
    setTimeout(() => {
      generateStatus.classList.add('hidden');
    }, 3000);
  } catch (err) {
    console.error('Failed to generate characters:', err);
    generateStatus.textContent = `Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    generateStatus.classList.add('error');
  } finally {
    generateBtn.disabled = false;
  }
}

/**
 * Handle create show button click
 */
async function handleCreateShow(): Promise<void> {
  if (!selectedTemplate || selectedCharacterIds.size === 0) {
    return;
  }

  createShowBtn.disabled = true;
  createError.classList.add('hidden');

  // Build characters array with full character data
  const selectedChars = availableCharacters.filter((c) =>
    selectedCharacterIds.has(c.id)
  );

  // Build request body with optional tokenBudget
  const tokenBudgetValue = tokenBudgetInput.value.trim();
  const requestBody: {
    formatId: typeof selectedTemplate;
    characters: typeof selectedChars;
    tokenBudget?: number;
  } = {
    formatId: selectedTemplate,
    characters: selectedChars,
  };

  if (tokenBudgetValue) {
    const parsedBudget = parseInt(tokenBudgetValue, 10);
    if (!isNaN(parsedBudget) && parsedBudget > 0) {
      requestBody.tokenBudget = parsedBudget;
    }
  }

  try {
    const response = await fetch('/shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error ?? `HTTP ${response.status}`);
    }

    const result = await response.json() as { showId: string; status: string };

    // Close modal and connect to the new show
    closeNewShowModal();
    showIdInput.value = result.showId;
    await handleConnect();
  } catch (err) {
    console.error('Failed to create show:', err);
    createError.textContent = `Failed to create show: ${err instanceof Error ? err.message : 'Unknown error'}`;
    createError.classList.remove('hidden');
    createShowBtn.disabled = false;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
