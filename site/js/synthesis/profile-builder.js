/**
 * User profile extraction from conversation patterns.
 * Builds a synthesized profile document for Claude Project Instructions.
 */

// Curated list of tools/frameworks to detect
const TECH_KEYWORDS = {
  // Languages
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', java: 'Java',
  rust: 'Rust', golang: 'Go', ruby: 'Ruby', php: 'PHP', swift: 'Swift',
  kotlin: 'Kotlin', scala: 'Scala', csharp: 'C#', cpp: 'C++',
  // Frontend
  react: 'React', vue: 'Vue', angular: 'Angular', nextjs: 'Next.js', svelte: 'Svelte',
  tailwind: 'Tailwind CSS', bootstrap: 'Bootstrap',
  // Backend
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', express: 'Express',
  spring: 'Spring', rails: 'Rails', laravel: 'Laravel', nestjs: 'NestJS',
  // Data
  pandas: 'pandas', numpy: 'NumPy', tensorflow: 'TensorFlow', pytorch: 'PyTorch',
  sklearn: 'scikit-learn', matplotlib: 'Matplotlib', jupyter: 'Jupyter',
  // Databases
  postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB',
  redis: 'Redis', sqlite: 'SQLite', sqlalchemy: 'SQLAlchemy', prisma: 'Prisma',
  // DevOps / Cloud
  docker: 'Docker', kubernetes: 'Kubernetes', aws: 'AWS', gcp: 'GCP', azure: 'Azure',
  terraform: 'Terraform', github: 'GitHub', gitlab: 'GitLab', jenkins: 'Jenkins',
  nginx: 'Nginx', linux: 'Linux',
  // Tools
  git: 'Git', vscode: 'VS Code', vim: 'Vim', neovim: 'Neovim',
  figma: 'Figma', notion: 'Notion', slack: 'Slack', jira: 'Jira',
};

const ROLE_PATTERNS = [
  /\bi(?:'m| am) (?:a |an )([\w\s]+?)(?:\.|,|\band\b|$)/gi,
  /\bi work (?:as|in) (?:a |an )?([\w\s]+?)(?:\.|,|\band\b|$)/gi,
  /\bmy (?:job|role|position|title) (?:is|as) (?:a |an )?([\w\s]+?)(?:\.|,|$)/gi,
  /\bas (?:a |an )([\w\s]+?),? i\b/gi,
];

const DECISION_PATTERNS = [
  /\bi (?:prefer|always use|usually use|like to use|chose|decided|go with)\b/gi,
  /\bi(?:'ll| will) (?:go with|use|stick with)\b/gi,
  /\bbetter to\b/gi,
];

/**
 * Build a user profile from parsed conversations.
 * @param {Array} conversations - Full conversation objects.
 * @param {Array} clusters - Topic clusters from topic-clusterer.
 * @returns {Object} UserProfile
 */
export function buildUserProfile(conversations, clusters = []) {
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

/**
 * Generate the _CLAUDE_PROFILE.md document.
 */
export function profileToMarkdown(profile) {
  const lines = [
    '# Your Profile -- For Claude Project Instructions',
    '',
    '> This profile was automatically generated from your ChatGPT conversation history.',
    '> Copy this into your Claude Project\'s Custom Instructions, or upload as a Project Knowledge file.',
    '> Review and edit to ensure accuracy.',
    '',
  ];

  // Who I Am
  lines.push('## Who I Am');
  if (profile.role) {
    lines.push(`- Role: ${profile.role.title} (detected from ${profile.role.mentions} conversation${profile.role.mentions > 1 ? 's' : ''})`);
  } else {
    lines.push('- Role: Not detected -- add your role/profession here');
  }
  lines.push('');

  // Technical Expertise
  if (profile.expertise.length > 0) {
    lines.push('## Technical Expertise');
    const grouped = groupExpertise(profile.expertise);
    for (const [category, items] of Object.entries(grouped)) {
      const itemStr = items.map(i => `${i.name} (${i.mentions})`).join(', ');
      lines.push(`- **${category}**: ${itemStr}`);
    }
    lines.push('');
  }

  // Communication Preferences
  lines.push('## Communication Preferences');
  const style = profile.communicationStyle;
  lines.push(`- I prefer ${style.verbosity} answers`);
  if (style.codeFirst) {
    lines.push('- I often include code in my questions (code-first approach)');
  }
  if (style.usesMarkdown) {
    lines.push('- I use markdown formatting in my messages');
  }
  lines.push(`- My question style tends to be ${style.questionStyle}`);
  lines.push('');

  // Recurring Topics
  if (profile.recurringTopics.length > 0) {
    lines.push('## Topics I Care About');
    for (const topic of profile.recurringTopics.slice(0, 10)) {
      lines.push(`- ${topic.topic} (${topic.count} conversations)`);
    }
    lines.push('');
  }

  // How I Work
  lines.push('## How I Work');
  const wp = profile.writingPatterns;
  lines.push(`- Average message length: ${wp.avgLength} characters (${wp.avgLength < 100 ? 'concise' : wp.avgLength < 300 ? 'moderate' : 'detailed'})`);
  if (wp.usesCodeBlocks) {
    lines.push('- I frequently share code in my conversations');
  }
  lines.push(`- Average conversation depth: ${wp.avgConversationLength} messages`);
  lines.push('');

  return lines.join('\n');
}

function extractUserMessages(conversations) {
  const messages = [];
  for (const conv of conversations) {
    if (!conv.messages) continue;
    for (const msg of conv.messages) {
      if (msg.authorRole === 'user') {
        const text = msg.contentParts.map(p => p.text || '').join(' ');
        messages.push(text);
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
        if (role.length > 2 && role.length < 50) {
          roleCounts[role] = (roleCounts[role] || 0) + 1;
        }
      }
    }
  }

  const entries = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  const [title, mentions] = entries[0];
  return {
    title: title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    mentions,
  };
}

function detectExpertise(messages) {
  const allText = messages.join(' ').toLowerCase();
  const results = [];

  for (const [keyword, name] of Object.entries(TECH_KEYWORDS)) {
    // Count word-boundary matches
    const regex = new RegExp(`\\b${keyword.replace(/[+#]/g, '\\$&')}\\b`, 'gi');
    const matches = allText.match(regex);
    if (matches && matches.length >= 2) {
      results.push({ name, keyword, mentions: matches.length });
    }
  }

  results.sort((a, b) => b.mentions - a.mentions);
  return results.slice(0, 20);
}

function analyzeCommunicationStyle(messages) {
  if (!messages.length) {
    return { verbosity: 'moderate', codeFirst: false, usesMarkdown: false, questionStyle: 'mixed' };
  }

  const avgLen = messages.reduce((sum, m) => sum + m.length, 0) / messages.length;

  let verbosity;
  if (avgLen < 50) verbosity = 'concise, direct';
  else if (avgLen < 200) verbosity = 'moderate-length';
  else verbosity = 'detailed, context-rich';

  const codeMessages = messages.filter(m => m.includes('```') || m.includes('def ') || m.includes('function '));
  const codeFirst = codeMessages.length / messages.length > 0.15;

  const mdMessages = messages.filter(m => /^#{1,3}\s|\*\*|^\s*-\s/m.test(m));
  const usesMarkdown = mdMessages.length / messages.length > 0.1;

  const specificStarters = messages.filter(m => /^(fix|write|create|build|convert|debug|update|add|implement|remove)/i.test(m.trim()));
  const questionStyle = specificStarters.length / messages.length > 0.3 ? 'specific and action-oriented' : 'exploratory and open-ended';

  return { verbosity, codeFirst, usesMarkdown, questionStyle };
}

function analyzeWritingPatterns(messages) {
  const avgLength = messages.length > 0
    ? Math.round(messages.reduce((sum, m) => sum + m.length, 0) / messages.length)
    : 0;

  const usesCodeBlocks = messages.filter(m => m.includes('```')).length / Math.max(messages.length, 1) > 0.1;

  return {
    avgLength,
    usesCodeBlocks,
    avgConversationLength: 0, // Set by caller with conversation-level data
  };
}

function groupExpertise(expertise) {
  const groups = {
    Languages: [],
    Frameworks: [],
    'Data & ML': [],
    'Databases': [],
    'DevOps & Cloud': [],
    Tools: [],
  };

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

  // Remove empty groups
  return Object.fromEntries(Object.entries(groups).filter(([, items]) => items.length > 0));
}
