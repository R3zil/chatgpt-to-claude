/**
 * Web Worker for non-blocking conversation parsing.
 * Offloads CPU-intensive parsing and clustering from the main thread.
 *
 * Messages:
 *   IN:  { type: 'parse', data: { rawData, memoriesText, instructionsText } }
 *   OUT: { type: 'progress', percent, text }
 *   OUT: { type: 'result', data: { metadata, conversations, stats, clusters, profile, profileMarkdown, knowledgeSummaries, memoriesMarkdown } }
 *   OUT: { type: 'error', message }
 */

// In a Web Worker we can't use ES module imports, so we inline
// the necessary logic or use importScripts. Since our modules are
// ES modules, we use a self-contained approach: the main thread
// posts the raw JSON data and we do all processing here.

// We inline simplified versions of the heavy algorithms to keep
// the worker self-contained (no import support in all browsers for workers).

// ─── Content Handlers (simplified) ───
function renderContent(content) {
  const contentType = content.content_type || 'text';
  const parts = content.parts || [];
  const results = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      results.push({ type: 'text', text: part });
    } else if (part && typeof part === 'object') {
      if (part.content_type === 'image_asset_pointer') {
        results.push({ type: 'text', text: '[Image]' });
      } else if (part.text) {
        results.push({ type: 'text', text: part.text });
      }
    }
  }

  if (contentType === 'code' && content.text) {
    const lang = content.language || '';
    results.push({ type: 'text', text: `\`\`\`${lang}\n${content.text}\n\`\`\`` });
  }

  if (contentType === 'execution_output' && content.text) {
    results.push({ type: 'text', text: `\`\`\`\n${content.text}\n\`\`\`` });
  }

  return results;
}

// ─── Tree Traversal (from parser.js) ───
function traverseTree(mapping) {
  if (!mapping || !Object.keys(mapping).length) return [];

  let rootId = null;
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (node.parent == null) { rootId = nodeId; break; }
  }
  if (rootId === null) return [];

  let leafId = rootId;
  while (true) {
    const node = mapping[leafId];
    if (!node) break;
    const children = node.children || [];
    if (!children.length) break;
    leafId = children[children.length - 1];
  }

  const messages = [];
  let currentId = leafId;
  while (currentId != null) {
    const node = mapping[currentId];
    if (!node) break;
    const msg = node.message;
    if (msg != null) {
      const role = (msg.author || {}).role || '';
      const isUserSystem = (msg.metadata || {}).is_user_system_message || false;
      if (role === 'system' && !isUserSystem) { currentId = node.parent; continue; }
      if (role === 'tool') { currentId = node.parent; continue; }
      const content = msg.content;
      if (!content || !content.parts) { currentId = node.parent; continue; }
      const hasContent = content.parts.some(p =>
        (typeof p === 'string' && p.trim()) || (typeof p === 'object' && p !== null)
      );
      if (!hasContent && content.content_type === 'text') { currentId = node.parent; continue; }
      messages.push(msg);
    }
    currentId = node.parent;
  }

  messages.reverse();
  return messages;
}

const VALID_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function parseMessage(raw) {
  const author = raw.author || {};
  const roleStr = author.role || 'user';
  const authorRole = VALID_ROLES.has(roleStr) ? roleStr : 'user';
  const content = raw.content || {};
  const contentParts = renderContent(content);
  const createdAt = raw.create_time ? new Date(Number(raw.create_time) * 1000) : null;
  const metadata = raw.metadata || {};
  const modelSlug = metadata.model_slug || metadata.model || null;
  return { id: raw.id || '', authorRole, contentParts, createdAt, modelSlug };
}

function parseConversations(rawData, metadataOnly) {
  const results = [];
  for (const rawConv of rawData) {
    const convId = rawConv.id || '';
    const title = rawConv.title || 'Untitled';
    const createdAt = rawConv.create_time ? new Date(Number(rawConv.create_time) * 1000) : null;
    const updatedAt = rawConv.update_time ? new Date(Number(rawConv.update_time) * 1000) : null;
    const mapping = rawConv.mapping || {};

    if (metadataOnly) {
      let count = 0;
      const slugs = new Set();
      for (const node of Object.values(mapping)) {
        const msg = node.message;
        if (!msg) continue;
        const role = (msg.author || {}).role || '';
        if (role === 'user' || role === 'assistant') count++;
        const slug = (msg.metadata || {}).model_slug || (msg.metadata || {}).model;
        if (slug) slugs.add(slug);
      }
      results.push({ id: convId, title, createdAt, updatedAt, messageCount: count, modelSlugs: slugs });
    } else {
      const rawMsgs = traverseTree(mapping);
      const messages = rawMsgs.map(parseMessage).filter(Boolean);
      const modelSlugs = new Set(messages.filter(m => m.modelSlug).map(m => m.modelSlug));
      results.push({ id: convId, title, createdAt, updatedAt, messages, modelSlugs });
    }
  }
  return results;
}

// ─── Statistics (from statistics.js) ───
function computeStatistics(conversations) {
  let totalMessages = 0;
  let totalUserMessages = 0;
  let totalAssistantMessages = 0;
  const modelsUsed = {};
  let earliest = null;
  let latest = null;

  for (const conv of conversations) {
    if (!conv.messages) continue;
    for (const msg of conv.messages) {
      totalMessages++;
      if (msg.authorRole === 'user') totalUserMessages++;
      if (msg.authorRole === 'assistant') totalAssistantMessages++;
      if (msg.modelSlug) modelsUsed[msg.modelSlug] = (modelsUsed[msg.modelSlug] || 0) + 1;
    }
    if (conv.createdAt) {
      if (!earliest || conv.createdAt < earliest) earliest = conv.createdAt;
      if (!latest || conv.createdAt > latest) latest = conv.createdAt;
    }
  }

  return {
    totalConversations: conversations.length,
    totalMessages,
    totalUserMessages,
    totalAssistantMessages,
    modelsUsed,
    dateRange: { earliest, latest },
  };
}

// ─── Topic Clustering (from topic-clusterer.js) ───
const STOPWORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are','as','at',
  'be','because','been','before','being','below','between','both','but','by','can','could',
  'did','do','does','doing','down','during','each','few','for','from','further','get','got',
  'had','has','have','having','he','her','here','hers','herself','him','himself','his','how',
  'i','if','in','into','is','it','its','itself','just','know','let','like','make','me',
  'might','more','most','my','myself','no','nor','not','now','of','off','on','once','only',
  'or','other','our','ours','ourselves','out','over','own','please','same','she','should',
  'so','some','such','than','that','the','their','theirs','them','themselves','then','there',
  'these','they','this','those','through','to','too','under','until','up','very','want',
  'was','we','were','what','when','where','which','while','who','whom','why','will','with',
  'would','you','your','yours','yourself','yourselves','also','one','two','three','use',
  'used','using','way','well','new','need','try','thing','things','really','much','many',
  'even','still','going','something','anything','help','thanks','thank','sure','yeah','yes',
  'okay','ok','right','good','great','think','work','working','time','first','last','look',
  'looking','give','take','come','see','say','said','tell','told','ask','asked','want',
  'wanted','actually','maybe','probably','basically','however','example','different','another',
]);

const TOPIC_TEMPLATES = {
  python: 'Your Python Projects', javascript: 'Your JavaScript Projects',
  typescript: 'Your TypeScript Projects', react: 'Your React Development',
  java: 'Your Java Projects', rust: 'Your Rust Projects',
  golang: 'Your Go Projects', sql: 'Your Database Work',
  css: 'Your Web Styling', html: 'Your Web Development',
  api: 'Your API Design', docker: 'Your DevOps Work',
  aws: 'Your Cloud Infrastructure', recipe: 'Your Cooking & Recipes',
  cook: 'Your Cooking & Recipes', food: 'Your Food & Cooking',
  travel: 'Your Travel Research', trip: 'Your Travel Plans',
  health: 'Your Health & Wellness', fitness: 'Your Fitness Journey',
  writing: 'Your Writing Projects', email: 'Your Email & Communication',
  resume: 'Your Career Development', interview: 'Your Career Preparation',
  math: 'Your Math & Calculations', data: 'Your Data Analysis',
  design: 'Your Design Work', business: 'Your Business Ideas',
  marketing: 'Your Marketing Strategy', finance: 'Your Financial Planning',
  learning: 'Your Learning & Education',
};

function tokenize(text) {
  return text.toLowerCase().split(/[\s\W]+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function extractKeywords(conversation) {
  const termCounts = {};
  const titleTokens = tokenize(conversation.title);
  for (const token of titleTokens) termCounts[token] = (termCounts[token] || 0) + 3;

  if (conversation.messages) {
    for (const msg of conversation.messages) {
      if (msg.authorRole !== 'user') continue;
      const text = msg.contentParts.map(p => p.text || '').join(' ').slice(0, 500);
      for (const token of tokenize(text)) termCounts[token] = (termCounts[token] || 0) + 1;
    }
  }
  return Object.entries(termCounts).map(([term, count]) => ({ term, count }));
}

function jaccardSimilarity(setA, setB) {
  let intersection = 0;
  for (const item of setA) { if (setB.has(item)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function clusterConversations(conversations) {
  if (conversations.length < 2) {
    return [{ label: 'All Conversations', conversations, keywords: [] }];
  }

  const convKeywords = conversations.map(conv => extractKeywords(conv));
  const docCount = conversations.length;
  const df = {};
  for (const keywords of convKeywords) {
    const seen = new Set();
    for (const { term } of keywords) {
      if (!seen.has(term)) { df[term] = (df[term] || 0) + 1; seen.add(term); }
    }
  }

  const topKeywords = convKeywords.map(keywords => {
    const scored = keywords.map(({ term, count }) => ({
      term, tfidf: count * Math.log(docCount / (df[term] || 1)),
    }));
    scored.sort((a, b) => b.tfidf - a.tfidf);
    return new Set(scored.slice(0, 20).map(s => s.term));
  });

  // Agglomerative clustering
  let clusters = conversations.map((_, i) => ({ indices: [i] }));
  const SIMILARITY_THRESHOLD = 0.15;

  while (true) {
    let bestSim = 0, bestI = -1, bestJ = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let maxSim = 0;
        for (const a of clusters[i].indices) {
          for (const b of clusters[j].indices) {
            const sim = jaccardSimilarity(topKeywords[a], topKeywords[b]);
            if (sim > maxSim) maxSim = sim;
          }
        }
        if (maxSim > bestSim) { bestSim = maxSim; bestI = i; bestJ = j; }
      }
    }
    if (bestSim < SIMILARITY_THRESHOLD || bestI === -1) break;
    clusters[bestI].indices.push(...clusters[bestJ].indices);
    clusters.splice(bestJ, 1);
  }

  const realClusters = clusters.filter(c => c.indices.length >= 2);
  const singles = clusters.filter(c => c.indices.length < 2);
  if (singles.length > 0) {
    realClusters.push({ indices: singles.flatMap(c => c.indices) });
  }

  return realClusters.map(cluster => {
    const counts = {};
    for (const i of cluster.indices) {
      for (const term of topKeywords[i]) counts[term] = (counts[term] || 0) + 1;
    }
    const keywords = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([term]) => term);
    let label = 'General';
    for (const kw of keywords) { if (TOPIC_TEMPLATES[kw]) { label = TOPIC_TEMPLATES[kw]; break; } }
    if (label === 'General' && keywords.length > 0) {
      const w = keywords[0];
      label = `Topic: ${w.charAt(0).toUpperCase() + w.slice(1)}`;
    }
    return {
      label,
      conversations: cluster.indices.map(i => conversations[i]),
      keywords: keywords.slice(0, 10),
    };
  });
}

// ─── Profile Builder (from profile-builder.js) ───
const TECH_KEYWORDS = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', java: 'Java',
  rust: 'Rust', golang: 'Go', ruby: 'Ruby', php: 'PHP', swift: 'Swift',
  kotlin: 'Kotlin', scala: 'Scala', csharp: 'C#', cpp: 'C++',
  react: 'React', vue: 'Vue', angular: 'Angular', nextjs: 'Next.js', svelte: 'Svelte',
  tailwind: 'Tailwind CSS', bootstrap: 'Bootstrap',
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', express: 'Express',
  spring: 'Spring', rails: 'Rails', laravel: 'Laravel', nestjs: 'NestJS',
  pandas: 'pandas', numpy: 'NumPy', tensorflow: 'TensorFlow', pytorch: 'PyTorch',
  sklearn: 'scikit-learn', matplotlib: 'Matplotlib', jupyter: 'Jupyter',
  postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB',
  redis: 'Redis', sqlite: 'SQLite', sqlalchemy: 'SQLAlchemy', prisma: 'Prisma',
  docker: 'Docker', kubernetes: 'Kubernetes', aws: 'AWS', gcp: 'GCP', azure: 'Azure',
  terraform: 'Terraform', github: 'GitHub', gitlab: 'GitLab', jenkins: 'Jenkins',
  nginx: 'Nginx', linux: 'Linux',
  git: 'Git', vscode: 'VS Code', vim: 'Vim', neovim: 'Neovim',
  figma: 'Figma', notion: 'Notion', slack: 'Slack', jira: 'Jira',
};

const ROLE_PATTERNS = [
  /\bi(?:'m| am) (?:a |an )([\w\s]+?)(?:\.|,|\band\b|$)/gi,
  /\bi work (?:as|in) (?:a |an )?([\w\s]+?)(?:\.|,|\band\b|$)/gi,
  /\bmy (?:job|role|position|title) (?:is|as) (?:a |an )?([\w\s]+?)(?:\.|,|$)/gi,
  /\bas (?:a |an )([\w\s]+?),? i\b/gi,
];

function extractUserMessages(conversations) {
  const messages = [];
  for (const conv of conversations) {
    if (!conv.messages) continue;
    for (const msg of conv.messages) {
      if (msg.authorRole === 'user') {
        messages.push(msg.contentParts.map(p => p.text || '').join(' '));
      }
    }
  }
  return messages;
}

function detectRole(messages) {
  const roleCounts = {};
  for (const msg of messages) {
    for (const pattern of ROLE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(msg)) !== null) {
        const role = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
        if (role.length > 2 && role.length < 50) roleCounts[role] = (roleCounts[role] || 0) + 1;
      }
    }
  }
  const entries = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const [title, mentions] = entries[0];
  return { title: title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), mentions };
}

function detectExpertise(messages) {
  const allText = messages.join(' ').toLowerCase();
  const results = [];
  for (const [keyword, name] of Object.entries(TECH_KEYWORDS)) {
    const regex = new RegExp(`\\b${keyword.replace(/[+#]/g, '\\$&')}\\b`, 'gi');
    const matches = allText.match(regex);
    if (matches && matches.length >= 2) results.push({ name, keyword, mentions: matches.length });
  }
  results.sort((a, b) => b.mentions - a.mentions);
  return results.slice(0, 20);
}

function analyzeCommunicationStyle(messages) {
  if (!messages.length) return { verbosity: 'moderate', codeFirst: false, usesMarkdown: false, questionStyle: 'mixed' };
  const avgLen = messages.reduce((sum, m) => sum + m.length, 0) / messages.length;
  let verbosity;
  if (avgLen < 50) verbosity = 'concise, direct';
  else if (avgLen < 200) verbosity = 'moderate-length';
  else verbosity = 'detailed, context-rich';
  const codeFirst = messages.filter(m => m.includes('```') || m.includes('def ') || m.includes('function ')).length / messages.length > 0.15;
  const usesMarkdown = messages.filter(m => /^#{1,3}\s|\*\*|^\s*-\s/m.test(m)).length / messages.length > 0.1;
  const questionStyle = messages.filter(m => /^(fix|write|create|build|convert|debug|update|add|implement|remove)/i.test(m.trim())).length / messages.length > 0.3 ? 'specific and action-oriented' : 'exploratory and open-ended';
  return { verbosity, codeFirst, usesMarkdown, questionStyle };
}

function analyzeWritingPatterns(messages) {
  const avgLength = messages.length > 0 ? Math.round(messages.reduce((sum, m) => sum + m.length, 0) / messages.length) : 0;
  const usesCodeBlocks = messages.filter(m => m.includes('```')).length / Math.max(messages.length, 1) > 0.1;
  return { avgLength, usesCodeBlocks, avgConversationLength: 0 };
}

function buildUserProfile(conversations, clusters) {
  const userMessages = extractUserMessages(conversations);
  return {
    role: detectRole(userMessages),
    expertise: detectExpertise(userMessages),
    communicationStyle: analyzeCommunicationStyle(userMessages),
    recurringTopics: clusters.map(c => ({ topic: c.label, count: c.conversations.length }))
      .filter(t => t.count >= 2)
      .sort((a, b) => b.count - a.count),
    writingPatterns: analyzeWritingPatterns(userMessages),
  };
}

function groupExpertise(expertise) {
  const groups = { Languages: [], Frameworks: [], 'Data & ML': [], 'Databases': [], 'DevOps & Cloud': [], Tools: [] };
  const categoryMap = {
    python: 'Languages', javascript: 'Languages', typescript: 'Languages', java: 'Languages',
    rust: 'Languages', golang: 'Languages', ruby: 'Languages', php: 'Languages',
    swift: 'Languages', kotlin: 'Languages', scala: 'Languages', csharp: 'Languages', cpp: 'Languages',
    react: 'Frameworks', vue: 'Frameworks', angular: 'Frameworks', nextjs: 'Frameworks',
    svelte: 'Frameworks', django: 'Frameworks', flask: 'Frameworks', fastapi: 'Frameworks',
    express: 'Frameworks', spring: 'Frameworks', rails: 'Frameworks', laravel: 'Frameworks',
    nestjs: 'Frameworks', tailwind: 'Frameworks', bootstrap: 'Frameworks',
    pandas: 'Data & ML', numpy: 'Data & ML', tensorflow: 'Data & ML', pytorch: 'Data & ML',
    sklearn: 'Data & ML', matplotlib: 'Data & ML', jupyter: 'Data & ML',
    postgres: 'Databases', postgresql: 'Databases', mysql: 'Databases', mongodb: 'Databases',
    redis: 'Databases', sqlite: 'Databases', sqlalchemy: 'Databases', prisma: 'Databases',
    docker: 'DevOps & Cloud', kubernetes: 'DevOps & Cloud', aws: 'DevOps & Cloud',
    gcp: 'DevOps & Cloud', azure: 'DevOps & Cloud', terraform: 'DevOps & Cloud',
    nginx: 'DevOps & Cloud', linux: 'DevOps & Cloud', github: 'DevOps & Cloud', gitlab: 'DevOps & Cloud',
    jenkins: 'DevOps & Cloud',
    git: 'Tools', vscode: 'Tools', vim: 'Tools', neovim: 'Tools',
    figma: 'Tools', notion: 'Tools', slack: 'Tools', jira: 'Tools',
  };
  for (const item of expertise) {
    const category = categoryMap[item.keyword] || 'Tools';
    groups[category].push(item);
  }
  return Object.fromEntries(Object.entries(groups).filter(([, items]) => items.length > 0));
}

function profileToMarkdown(profile) {
  const lines = [
    '# Your Profile -- For Claude Project Instructions', '',
    '> This profile was automatically generated from your ChatGPT conversation history.',
    '> Copy this into your Claude Project\'s Custom Instructions, or upload as a Project Knowledge file.',
    '> Review and edit to ensure accuracy.', '',
  ];

  lines.push('## Who I Am');
  if (profile.role) {
    lines.push(`- Role: ${profile.role.title} (detected from ${profile.role.mentions} conversation${profile.role.mentions > 1 ? 's' : ''})`);
  } else {
    lines.push('- Role: Not detected -- add your role/profession here');
  }
  lines.push('');

  if (profile.expertise.length > 0) {
    lines.push('## Technical Expertise');
    const grouped = groupExpertise(profile.expertise);
    for (const [category, items] of Object.entries(grouped)) {
      lines.push(`- **${category}**: ${items.map(i => `${i.name} (${i.mentions})`).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Communication Preferences');
  const style = profile.communicationStyle;
  lines.push(`- I prefer ${style.verbosity} answers`);
  if (style.codeFirst) lines.push('- I often include code in my questions (code-first approach)');
  if (style.usesMarkdown) lines.push('- I use markdown formatting in my messages');
  lines.push(`- My question style tends to be ${style.questionStyle}`);
  lines.push('');

  if (profile.recurringTopics.length > 0) {
    lines.push('## Topics I Care About');
    for (const topic of profile.recurringTopics.slice(0, 10)) {
      lines.push(`- ${topic.topic} (${topic.count} conversations)`);
    }
    lines.push('');
  }

  lines.push('## How I Work');
  const wp = profile.writingPatterns;
  lines.push(`- Average message length: ${wp.avgLength} characters (${wp.avgLength < 100 ? 'concise' : wp.avgLength < 300 ? 'moderate' : 'detailed'})`);
  if (wp.usesCodeBlocks) lines.push('- I frequently share code in my conversations');
  lines.push(`- Average conversation depth: ${wp.avgConversationLength} messages`);
  lines.push('');

  return lines.join('\n');
}

// ─── Knowledge Summarizer (simplified) ───
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100) || 'untitled';
}

function summarizeClusters(clusters) {
  return clusters.map(cluster => {
    const title = cluster.label;
    const filename = `topic_${sanitizeFilename(title.toLowerCase().replace(/^your\s+/i, ''))}.md`;
    const lines = [`# ${cluster.label}`, ''];

    const dates = cluster.conversations
      .filter(c => c.createdAt)
      .map(c => c.createdAt)
      .sort((a, b) => a - b);

    if (dates.length > 0) {
      const start = dates[0].toISOString().slice(0, 7);
      const end = dates[dates.length - 1].toISOString().slice(0, 7);
      lines.push(`> Synthesized from ${cluster.conversations.length} conversations (${start === end ? start : `${start} to ${end}`}).`);
      lines.push('');
    }

    // Notable conversations
    const notable = [...cluster.conversations]
      .filter(c => c.messages && c.messages.length > 0)
      .sort((a, b) => b.messages.length - a.messages.length);

    if (notable.length > 0) {
      lines.push('## Notable Conversations');
      for (const conv of notable.slice(0, 8)) {
        const date = conv.createdAt ? conv.createdAt.toISOString().slice(0, 10) : 'Unknown date';
        lines.push(`- **${conv.title}** (${date}) -- ${conv.messages.length} messages`);
      }
      lines.push('');
    }

    return { title, filename, markdown: lines.join('\n') };
  });
}

// ─── Memory Converter (simplified) ───
function convertMemories(memoriesText) {
  if (!memoriesText || !memoriesText.trim()) return '';
  const lines = ['# ChatGPT Memories', '', '> These are facts and preferences that ChatGPT had memorized about you.', ''];
  const entries = memoriesText.split(/\n/).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(l => l.length > 0);
  for (const entry of entries) lines.push(`- ${entry}`);
  lines.push('');
  return lines.join('\n');
}

function convertCustomInstructions(instructionsText) {
  if (!instructionsText || !instructionsText.trim()) return '';
  return ['## Custom Instructions (from ChatGPT)', '', instructionsText.trim(), ''].join('\n');
}

// ─── Worker Message Handler ───
self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'parse') {
    try {
      const { rawData, memoriesText, instructionsText } = data;

      // Stage 1: Parse metadata
      self.postMessage({ type: 'progress', percent: 15, text: `Parsing ${rawData.length.toLocaleString()} conversations...` });
      const metadata = parseConversations(rawData, true);

      // Stage 2: Full parse
      self.postMessage({ type: 'progress', percent: 35, text: 'Full parsing...' });
      const conversations = parseConversations(rawData, false);

      // Stage 3: Statistics
      self.postMessage({ type: 'progress', percent: 50, text: 'Computing statistics...' });
      const stats = computeStatistics(conversations);

      // Stage 4: Topic clustering
      self.postMessage({ type: 'progress', percent: 65, text: 'Analyzing topic patterns...' });
      const clusters = clusterConversations(conversations);

      // Stage 5: Profile building
      self.postMessage({ type: 'progress', percent: 80, text: 'Building your profile...' });
      const totalMsgs = conversations.reduce((s, c) => s + (c.messages?.length || 0), 0);
      const avgConvLen = conversations.length > 0 ? Math.round(totalMsgs / conversations.length) : 0;
      const profile = buildUserProfile(conversations, clusters);
      profile.writingPatterns.avgConversationLength = avgConvLen;
      const pm = profileToMarkdown(profile);

      // Handle memories/instructions
      let profileMd = pm;
      if (instructionsText && instructionsText.trim()) {
        profileMd += '\n' + convertCustomInstructions(instructionsText);
      }

      // Stage 6: Knowledge summaries
      self.postMessage({ type: 'progress', percent: 90, text: 'Generating knowledge base...' });
      const knowledgeSummaries = summarizeClusters(clusters);

      const memoriesMarkdown = convertMemories(memoriesText);

      self.postMessage({ type: 'progress', percent: 100, text: 'Done!' });

      // Send results back
      self.postMessage({
        type: 'result',
        data: {
          metadata,
          conversations,
          stats,
          clusters,
          profile,
          profileMarkdown: profileMd,
          knowledgeSummaries,
          memoriesMarkdown,
        },
      });

    } catch (err) {
      self.postMessage({ type: 'error', message: err.message || 'Worker processing failed' });
    }
  }
};
