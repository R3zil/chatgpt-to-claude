/**
 * Topic clustering via TF-IDF keyword analysis and Jaccard similarity.
 * Entirely client-side, no ML library needed.
 */

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
  python: 'Your Python Projects',
  javascript: 'Your JavaScript Projects',
  typescript: 'Your TypeScript Projects',
  react: 'Your React Development',
  java: 'Your Java Projects',
  rust: 'Your Rust Projects',
  golang: 'Your Go Projects',
  sql: 'Your Database Work',
  css: 'Your Web Styling',
  html: 'Your Web Development',
  api: 'Your API Design',
  docker: 'Your DevOps Work',
  aws: 'Your Cloud Infrastructure',
  recipe: 'Your Cooking & Recipes',
  cook: 'Your Cooking & Recipes',
  food: 'Your Food & Cooking',
  travel: 'Your Travel Research',
  trip: 'Your Travel Plans',
  health: 'Your Health & Wellness',
  fitness: 'Your Fitness Journey',
  writing: 'Your Writing Projects',
  email: 'Your Email & Communication',
  resume: 'Your Career Development',
  interview: 'Your Career Preparation',
  math: 'Your Math & Calculations',
  data: 'Your Data Analysis',
  design: 'Your Design Work',
  business: 'Your Business Ideas',
  marketing: 'Your Marketing Strategy',
  finance: 'Your Financial Planning',
  learning: 'Your Learning & Education',
};

const SIMILARITY_THRESHOLD = 0.15;
const MIN_CLUSTER_SIZE = 2;

/**
 * Cluster conversations by topic using TF-IDF + Jaccard similarity.
 * @param {Array} conversations - Full conversation objects with messages.
 * @returns {Array<{label: string, conversations: Array, keywords: Array}>}
 */
export function clusterConversations(conversations) {
  if (conversations.length < 2) {
    return [{ label: 'All Conversations', conversations, keywords: [] }];
  }

  // Step 1: Extract keywords per conversation
  const convKeywords = conversations.map(conv => extractKeywords(conv));

  // Step 2: Compute IDF
  const docCount = conversations.length;
  const df = {};
  for (const keywords of convKeywords) {
    const seen = new Set();
    for (const { term } of keywords) {
      if (!seen.has(term)) {
        df[term] = (df[term] || 0) + 1;
        seen.add(term);
      }
    }
  }

  // Step 3: Compute TF-IDF scores and keep top 20 per conversation
  const topKeywords = convKeywords.map(keywords => {
    const scored = keywords.map(({ term, count }) => ({
      term,
      tfidf: count * Math.log(docCount / (df[term] || 1)),
    }));
    scored.sort((a, b) => b.tfidf - a.tfidf);
    return new Set(scored.slice(0, 20).map(s => s.term));
  });

  // Step 4: Agglomerative clustering via Jaccard similarity
  const clusters = agglomerativeCluster(conversations, topKeywords);

  // Step 5: Label clusters
  return clusters.map(cluster => {
    const keywords = getClusterKeywords(cluster.indices, topKeywords);
    const label = generateLabel(keywords);
    return {
      label,
      conversations: cluster.indices.map(i => conversations[i]),
      keywords: keywords.slice(0, 10),
    };
  });
}

function extractKeywords(conversation) {
  const termCounts = {};

  // Title words (weighted 3x)
  const titleTokens = tokenize(conversation.title);
  for (const token of titleTokens) {
    termCounts[token] = (termCounts[token] || 0) + 3;
  }

  // User messages (first 500 chars each)
  if (conversation.messages) {
    for (const msg of conversation.messages) {
      if (msg.authorRole !== 'user') continue;
      const text = msg.contentParts.map(p => p.text || '').join(' ').slice(0, 500);
      const tokens = tokenize(text);
      for (const token of tokens) {
        termCounts[token] = (termCounts[token] || 0) + 1;
      }
    }
  }

  return Object.entries(termCounts).map(([term, count]) => ({ term, count }));
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccardSimilarity(setA, setB) {
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function agglomerativeCluster(conversations, topKeywords) {
  // Initialize: each conversation is its own cluster
  let clusters = conversations.map((_, i) => ({ indices: [i] }));

  while (true) {
    let bestSim = 0;
    let bestI = -1;
    let bestJ = -1;

    // Find the two most similar clusters
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = maxPairwiseSimilarity(clusters[i].indices, clusters[j].indices, topKeywords);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < SIMILARITY_THRESHOLD || bestI === -1) break;

    // Merge
    clusters[bestI].indices.push(...clusters[bestJ].indices);
    clusters.splice(bestJ, 1);
  }

  // Split into real clusters and unclustered singles
  const realClusters = clusters.filter(c => c.indices.length >= MIN_CLUSTER_SIZE);
  const singles = clusters.filter(c => c.indices.length < MIN_CLUSTER_SIZE);

  // Group singles into "General"
  if (singles.length > 0) {
    const generalIndices = singles.flatMap(c => c.indices);
    realClusters.push({ indices: generalIndices });
  }

  return realClusters;
}

function maxPairwiseSimilarity(indicesA, indicesB, topKeywords) {
  let maxSim = 0;
  for (const i of indicesA) {
    for (const j of indicesB) {
      const sim = jaccardSimilarity(topKeywords[i], topKeywords[j]);
      if (sim > maxSim) maxSim = sim;
    }
  }
  return maxSim;
}

function getClusterKeywords(indices, topKeywords) {
  const counts = {};
  for (const i of indices) {
    for (const term of topKeywords[i]) {
      counts[term] = (counts[term] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term);
}

function generateLabel(keywords) {
  for (const keyword of keywords) {
    if (TOPIC_TEMPLATES[keyword]) return TOPIC_TEMPLATES[keyword];
  }

  // Default: use first keyword with title case
  if (keywords.length > 0) {
    const word = keywords[0];
    return `Topic: ${word.charAt(0).toUpperCase() + word.slice(1)}`;
  }

  return 'General';
}
