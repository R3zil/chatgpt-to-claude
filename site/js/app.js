/**
 * ChatGPT -> Claude: Main orchestrator and UI state machine.
 * Wires together extraction, parsing, synthesis, and ZIP generation.
 */

import { extractFromZip } from './extractor.js';
import { parseConversations } from './parser.js';
import { conversationToMarkdown, generateIndex } from './markdown-writer.js';
import { resolveOutputPath, deduplicatePath } from './organizer.js';
import { maybeSplit } from './splitter.js';
import { computeStatistics, formatDateRange } from './statistics.js';
import { clusterConversations } from './synthesis/topic-clusterer.js';
import { buildUserProfile, profileToMarkdown } from './synthesis/profile-builder.js';
import { summarizeClusters } from './synthesis/knowledge-summarizer.js';
import { convertMemories, convertCustomInstructions } from './synthesis/memory-converter.js';
import { validateApiKey } from './byok/api-client.js';
import { enhanceProfile, enhanceKnowledge } from './byok/llm-synthesizer.js';

// ─── State Machine ───
const STATE = { LANDING: 0, PROCESSING: 1, PREVIEW: 2, DOWNLOAD: 3 };
let currentState = STATE.LANDING;

// ─── App State ───
let conversations = [];
let metadata = [];
let stats = null;
let clusters = [];
let profile = null;
let knowledgeSummaries = [];
let profileMarkdown = '';
let selectedIds = new Set();
let filteredConversations = [];
let currentPage = 1;
const PAGE_SIZE = 50;
const WORKER_THRESHOLD = 100; // Use Web Worker if > 100 conversations

// ─── DOM References ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Upload Guide ───
const UPLOAD_GUIDE = `# How to Upload to Claude

## Quick Start (2 minutes)

### Step 1: Set Up Your Claude Project
1. Go to [claude.ai](https://claude.ai)
2. Click "Create a project" (or open an existing one)

### Step 2: Add Your Profile (Most Important!)
1. Click the project's "Set project instructions" area
2. Open \`_CLAUDE_PROFILE.md\` from this package
3. Copy the entire contents and paste into the instructions
4. Claude will now understand your background, preferences, and expertise

### Step 3: Upload Knowledge Base
1. Click "Add content" -> "Upload files"
2. Select ALL files from the \`_KNOWLEDGE_BASE/\` folder
3. These give Claude organized context about your interests and past work

### Step 4: Upload Conversations (Optional)
1. Upload files from \`_CONVERSATIONS/\` for specific conversation history
2. Start with the most recent or most important months
3. Note: Claude Projects have a knowledge base limit (~200K tokens)

### Step 5: Upload Memories (If Available)
1. Upload \`_MEMORIES.md\` to the project knowledge
2. This contains preferences and facts ChatGPT had memorized about you
`;

// ─── Initialize ───
document.addEventListener('DOMContentLoaded', init);

function init() {
  setupDropZone();
  setupControls();
}

// ─── Drop Zone ───
function setupDropZone() {
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');
  const browseBtn = $('#browse-btn');

  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });
}

// ─── Controls ───
function setupControls() {
  $('#start-over-btn')?.addEventListener('click', resetToLanding);
  $('#convert-btn')?.addEventListener('click', () => convertAndDownload(Array.from(selectedIds)));
  $('#convert-all-btn')?.addEventListener('click', () => convertAndDownload(null));
  $('#search-input')?.addEventListener('input', handleSearch);
  $('#select-all-btn')?.addEventListener('click', selectAll);
  $('#select-none-btn')?.addEventListener('click', selectNone);
  $('#copy-profile-btn')?.addEventListener('click', copyProfile);
  $('#preview-close')?.addEventListener('click', () => $('#preview-modal').hidden = true);
  $('#preview-modal')?.addEventListener('click', (e) => { if (e.target === $('#preview-modal')) $('#preview-modal').hidden = true; });

  // Tab switching
  for (const tab of $$('.tab-btn')) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  // BYOK controls
  $('#byok-validate-btn')?.addEventListener('click', handleValidateKey);
  $('#byok-enhance-btn')?.addEventListener('click', handleEnhance);
}

// ─── File Handling ───
async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showError('Please upload a .zip file');
    return;
  }

  transitionTo(STATE.PROCESSING);
  hideError();

  try {
    // Stage 1: Read ZIP
    updateProgress(10, 'Reading ZIP...');
    const { conversations: rawData, extras } = await extractFromZip(file);

    const memoriesText = $('#memories-input')?.value || '';
    const instructionsText = $('#instructions-input')?.value || '';

    // Use Web Worker for large exports
    if (rawData.length > WORKER_THRESHOLD && typeof Worker !== 'undefined') {
      await processWithWorker(rawData, memoriesText, instructionsText);
    } else {
      await processOnMainThread(rawData, memoriesText, instructionsText);
    }

    updateProgress(100, 'Done!');
    await sleep(400);

    // Set up selection state
    filteredConversations = [...metadata];
    selectedIds = new Set(metadata.map(m => m.id));

    transitionTo(STATE.PREVIEW);
    displayStats();
    displayProfile();
    displayKnowledge();
    renderConversationList();
    updateSelectionCount();

  } catch (err) {
    transitionTo(STATE.LANDING);
    showError(err.message || 'Failed to process file');
    console.error(err);
  }
}

// ─── Processing Paths ───
async function processOnMainThread(rawData, memoriesText, instructionsText) {
  updateProgress(25, `Parsing ${rawData.length.toLocaleString()} conversations...`);
  metadata = parseConversations(rawData, { metadataOnly: true });

  updateProgress(40, 'Full parsing...');
  await yieldToUI();
  conversations = parseConversations(rawData, { metadataOnly: false });

  updateProgress(55, 'Computing statistics...');
  stats = computeStatistics(conversations);

  updateProgress(65, 'Analyzing topic patterns...');
  await yieldToUI();
  clusters = clusterConversations(conversations);

  updateProgress(80, 'Building your profile...');
  await yieldToUI();
  const totalMsgs = conversations.reduce((s, c) => s + (c.messages?.length || 0), 0);
  const avgConvLen = conversations.length > 0 ? Math.round(totalMsgs / conversations.length) : 0;
  profile = buildUserProfile(conversations, clusters);
  profile.writingPatterns.avgConversationLength = avgConvLen;
  profileMarkdown = profileToMarkdown(profile);

  updateProgress(90, 'Generating knowledge base...');
  await yieldToUI();
  knowledgeSummaries = summarizeClusters(clusters);

  if (memoriesText.trim() || instructionsText.trim()) {
    const instructionsSection = convertCustomInstructions(instructionsText);
    if (instructionsSection) profileMarkdown += '\n' + instructionsSection;
  }
}

function processWithWorker(rawData, memoriesText, instructionsText) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('js/workers/parse-worker.js');

    worker.onmessage = (e) => {
      const { type, data, percent, text, message } = e.data;

      if (type === 'progress') {
        updateProgress(percent, text);
      } else if (type === 'result') {
        metadata = data.metadata;
        conversations = data.conversations;
        stats = data.stats;
        clusters = data.clusters;
        profile = data.profile;
        profileMarkdown = data.profileMarkdown;
        knowledgeSummaries = data.knowledgeSummaries;
        worker.terminate();
        resolve();
      } else if (type === 'error') {
        worker.terminate();
        reject(new Error(message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Worker failed'));
    };

    worker.postMessage({ type: 'parse', data: { rawData, memoriesText, instructionsText } });
  });
}

// ─── BYOK Handlers ───
async function handleValidateKey() {
  const apiKey = $('#byok-api-key')?.value?.trim();
  const provider = $('#byok-provider')?.value || 'claude';
  const statusEl = $('#byok-status');

  if (!apiKey) {
    if (statusEl) statusEl.textContent = 'Please enter an API key.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Validating...';

  const result = await validateApiKey({ provider, apiKey });
  if (result.valid) {
    if (statusEl) { statusEl.textContent = 'Key is valid!'; statusEl.className = 'byok-status valid'; }
    $('#byok-enhance-btn').disabled = false;
  } else {
    if (statusEl) { statusEl.textContent = `Invalid: ${result.error}`; statusEl.className = 'byok-status invalid'; }
    $('#byok-enhance-btn').disabled = true;
  }
}

async function handleEnhance() {
  const apiKey = $('#byok-api-key')?.value?.trim();
  const provider = $('#byok-provider')?.value || 'claude';
  const statusEl = $('#byok-status');

  if (!apiKey || !conversations.length) return;

  const config = { provider, apiKey };
  const enhanceBtn = $('#byok-enhance-btn');
  enhanceBtn.disabled = true;
  if (statusEl) statusEl.textContent = 'Enhancing profile...';

  try {
    // Enhance profile
    const enhanced = await enhanceProfile(config, profileMarkdown, conversations, (pct) => {
      if (statusEl) statusEl.textContent = `Enhancing profile... ${pct}%`;
    });

    if (enhanced && enhanced.trim()) {
      profileMarkdown = enhanced;
      displayProfile();
    }

    // Enhance knowledge
    if (statusEl) statusEl.textContent = 'Enhancing knowledge base...';
    const enhancedKnowledge = await enhanceKnowledge(config, clusters, (pct) => {
      if (statusEl) statusEl.textContent = `Enhancing knowledge... ${pct}%`;
    });

    if (enhancedKnowledge.length > 0) {
      knowledgeSummaries = enhancedKnowledge;
      displayKnowledge();
    }

    if (statusEl) { statusEl.textContent = 'Enhancement complete!'; statusEl.className = 'byok-status valid'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = `Enhancement failed: ${err.message}`; statusEl.className = 'byok-status invalid'; }
  } finally {
    enhanceBtn.disabled = false;
  }
}

// ─── State Transitions ───
function transitionTo(state) {
  currentState = state;
  $('#landing-section').hidden = state !== STATE.LANDING;
  $('#processing-section').hidden = state !== STATE.PROCESSING;
  $('#preview-section').hidden = state !== STATE.PREVIEW && state !== STATE.DOWNLOAD;
  $('#download-section').hidden = state !== STATE.DOWNLOAD;
}

function resetToLanding() {
  conversations = [];
  metadata = [];
  stats = null;
  clusters = [];
  profile = null;
  knowledgeSummaries = [];
  profileMarkdown = '';
  selectedIds.clear();
  filteredConversations = [];
  currentPage = 1;
  $('#file-input').value = '';
  $('#search-input').value = '';
  $('#memories-input').value = '';
  $('#instructions-input').value = '';
  transitionTo(STATE.LANDING);
}

// ─── Progress ───
function updateProgress(percent, text) {
  const fill = $('#progress-fill');
  const label = $('#progress-text');
  if (fill) fill.style.width = `${percent}%`;
  if (label) label.textContent = text;
}

// ─── Stats Display ───
function displayStats() {
  if (!stats) return;
  $('#stat-conversations').textContent = stats.totalConversations.toLocaleString();
  $('#stat-messages').textContent = stats.totalMessages.toLocaleString();
  $('#stat-date-range').textContent = formatDateRange(stats.dateRange);

  const models = Object.keys(stats.modelsUsed);
  $('#stat-models').textContent = models.length <= 3
    ? models.join(', ')
    : `${models.slice(0, 2).join(', ')} +${models.length - 2}`;

  $('#stat-clusters').textContent = clusters.length.toString();
}

// ─── Profile Tab ───
function displayProfile() {
  const el = $('#profile-content');
  if (el) el.textContent = profileMarkdown;
}

function copyProfile() {
  navigator.clipboard.writeText(profileMarkdown).then(() => {
    const btn = $('#copy-profile-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = original, 2000);
  });
}

// ─── Knowledge Tab ───
function displayKnowledge() {
  const container = $('#knowledge-content');
  if (!container) return;
  container.innerHTML = '';

  for (const summary of knowledgeSummaries) {
    const div = document.createElement('div');
    div.className = 'knowledge-cluster';

    const header = document.createElement('div');
    header.className = 'cluster-header';
    header.innerHTML = `
      <span class="cluster-title">${escapeHtml(summary.title)}</span>
      <span class="cluster-meta">${clusters.find(c => c.label === summary.title)?.conversations.length || 0} conversations</span>
      <button class="cluster-toggle">Show</button>
    `;

    const body = document.createElement('pre');
    body.className = 'cluster-body';
    body.textContent = summary.markdown;
    body.hidden = true;

    header.querySelector('.cluster-toggle').addEventListener('click', (e) => {
      body.hidden = !body.hidden;
      e.target.textContent = body.hidden ? 'Show' : 'Hide';
    });

    div.appendChild(header);
    div.appendChild(body);
    container.appendChild(div);
  }
}

// ─── Conversations Tab ───
function renderConversationList() {
  const container = $('#conversation-list');
  if (!container) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredConversations.slice(start, start + PAGE_SIZE);

  container.innerHTML = '';

  if (!pageItems.length) {
    container.innerHTML = '<p class="empty-state">No conversations found</p>';
    return;
  }

  for (const conv of pageItems) {
    const item = document.createElement('div');
    item.className = 'conv-item';

    const date = conv.createdAt ? conv.createdAt.toISOString().slice(0, 10) : 'Unknown';
    const models = conv.modelSlugs ? [...conv.modelSlugs].join(', ') : '';
    const modelInfo = models ? ` | ${models}` : '';
    const msgCount = conv.messageCount || (conv.messages ? conv.messages.length : 0);

    item.innerHTML = `
      <input type="checkbox" data-id="${conv.id}" ${selectedIds.has(conv.id) ? 'checked' : ''}>
      <div class="conv-info">
        <div class="conv-title">${escapeHtml(conv.title)}</div>
        <div class="conv-meta">${date} | ${msgCount} msgs${modelInfo}</div>
      </div>
      <button class="conv-preview-btn" data-id="${conv.id}">Preview</button>
    `;

    const checkbox = item.querySelector('input');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedIds.add(conv.id);
      else selectedIds.delete(conv.id);
      updateSelectionCount();
    });

    item.querySelector('.conv-preview-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPreview(conv.id, conv.title);
    });

    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });

    container.appendChild(item);
  }

  renderPagination();
}

function renderPagination() {
  const container = $('#pagination');
  if (!container) return;
  container.innerHTML = '';

  const totalPages = Math.ceil(filteredConversations.length / PAGE_SIZE);
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.textContent = 'Prev';
  prev.disabled = currentPage === 1;
  prev.addEventListener('click', () => { currentPage--; renderConversationList(); });
  container.appendChild(prev);

  const start = Math.max(1, currentPage - 3);
  const end = Math.min(totalPages, start + 6);
  for (let i = start; i <= end; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    if (i === currentPage) btn.className = 'active';
    btn.addEventListener('click', () => { currentPage = i; renderConversationList(); });
    container.appendChild(btn);
  }

  const next = document.createElement('button');
  next.textContent = 'Next';
  next.disabled = currentPage === totalPages;
  next.addEventListener('click', () => { currentPage++; renderConversationList(); });
  container.appendChild(next);
}

function handleSearch() {
  const query = $('#search-input').value.toLowerCase().trim();
  filteredConversations = query
    ? metadata.filter(c => c.title.toLowerCase().includes(query))
    : [...metadata];
  currentPage = 1;
  renderConversationList();
}

function selectAll() {
  selectedIds = new Set(filteredConversations.map(c => c.id));
  renderConversationList();
  updateSelectionCount();
}

function selectNone() {
  selectedIds.clear();
  renderConversationList();
  updateSelectionCount();
}

function updateSelectionCount() {
  const el = $('#selection-count');
  if (el) el.textContent = `${selectedIds.size} selected`;
  const btn = $('#convert-btn');
  if (btn) {
    btn.textContent = `Convert Selected (${selectedIds.size})`;
    btn.disabled = selectedIds.size === 0;
  }
}

// ─── Preview Modal ───
function openPreview(convId, title) {
  $('#preview-title').textContent = title;
  const body = $('#preview-body');
  body.innerHTML = '<div class="spinner"></div>';
  $('#preview-modal').hidden = false;

  const conv = conversations.find(c => c.id === convId);
  if (conv) {
    body.textContent = conversationToMarkdown(conv);
  } else {
    body.textContent = 'Conversation not found';
  }
}

// ─── Tabs ───
function switchTab(tabName) {
  for (const btn of $$('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  }
  for (const panel of $$('.tab-panel')) {
    panel.hidden = panel.id !== `tab-${tabName}`;
  }
}

// ─── Conversion & Download ───
async function convertAndDownload(ids) {
  $('#converting-overlay').hidden = false;

  try {
    const organize = $('#opt-organize')?.value || 'monthly';
    const includeFrontmatter = $('#opt-frontmatter')?.checked !== false;

    // Filter conversations
    const selected = ids
      ? conversations.filter(c => ids.includes(c.id))
      : conversations;

    // Build ZIP
    const zip = new JSZip();
    const base = 'claude_migration';
    const usedPaths = new Map();

    // 1. Profile document
    zip.file(`${base}/_CLAUDE_PROFILE.md`, profileMarkdown);

    // 2. Knowledge base
    for (const summary of knowledgeSummaries) {
      zip.file(`${base}/_KNOWLEDGE_BASE/${summary.filename}`, summary.markdown);
    }

    // 3. Conversations
    for (const conv of selected) {
      if (!conv.messages || !conv.messages.length) continue;
      const parts = maybeSplit(conv);
      for (const part of parts) {
        const md = conversationToMarkdown(part, { includeFrontmatter });
        let outPath = resolveOutputPath(part, organize, `${base}/_CONVERSATIONS`);
        outPath = deduplicatePath(outPath, usedPaths);
        zip.file(outPath, md);
      }
    }

    // 4. Memories
    const memoriesText = $('#memories-input')?.value || '';
    if (memoriesText.trim()) {
      zip.file(`${base}/_MEMORIES.md`, convertMemories(memoriesText));
    }

    // 5. Index
    zip.file(`${base}/_INDEX.md`, generateIndex(selected));

    // 6. Upload guide
    zip.file(`${base}/_UPLOAD_GUIDE.md`, UPLOAD_GUIDE);

    // Generate and download
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'chatgpt_to_claude_migration.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('#converting-overlay').hidden = true;

  } catch (err) {
    $('#converting-overlay').hidden = true;
    alert('Conversion failed: ' + err.message);
    console.error(err);
  }
}

// ─── Utilities ───
function showError(msg) {
  const el = $('#upload-error');
  if (el) { el.textContent = msg; el.hidden = false; }
}

function hideError() {
  const el = $('#upload-error');
  if (el) el.hidden = true;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
