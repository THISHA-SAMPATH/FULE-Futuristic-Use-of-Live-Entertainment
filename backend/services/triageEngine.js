const URGENT = [
  [/\b(attack\w*|assault\w*|weapon|gun|knife|threat\w*|hurt\w*|harm\w*|trap\w*|being followed|following me|won't leave|help me now|duress)\b/i, 8],
  [/\b(?:cannot|can't|unable to)\s+(?:leave|escape|get away|move)\b/i, 8],
  [/\b(help|emergency|unsafe|scared|harass(?:ed|ment)|stalk(?:ed|ing)|panic|can't get away)\b/i, 5],
  [/\b(alone|lost|uncomfortable|concerned|suspicious|need someone)\b/i, 2]
];

const ACTIONS = {
  CRITICAL: 'ALERT_GUARDIANS_AND_CALL_112',
  ELEVATED: 'CONTACT_TRUSTED_CIRCLE',
  LOW: 'CHECK_IN_WITH_STREAMER'
};

function capWords(value, maxWords = 15) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function matchPolarity(text, pattern) {
  const matcher = new RegExp(pattern.source, `${pattern.flags.replaceAll('g', '')}g`);
  let foundNegated = false;
  for (const match of text.matchAll(matcher)) {
    const start = Math.max(
      text.lastIndexOf('.', match.index), text.lastIndexOf('!', match.index),
      text.lastIndexOf('?', match.index), text.lastIndexOf(';', match.index),
      text.lastIndexOf('\n', match.index)
    ) + 1;
    const prefix = text.slice(start, match.index);
    const negated = /\b(?:no|not|never|without|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|can't|cannot)\b(?:[\s,]+[\p{L}\p{N}'-]+){0,3}[\s,]*$/iu.test(prefix);
    if (!negated) return 'positive';
    foundNegated = true;
  }
  return foundNegated ? 'negated' : 'none';
}

function scoreIncident({ audio_transcript_snippet = '', source = 'button', local_hour = new Date().getHours(), risk_level = 'standard' }) {
  const text = String(audio_transcript_snippet).slice(0, 4000).trim();
  let score = 0;
  const signals = [];
  for (const [pattern, weight] of URGENT) {
    const polarity = matchPolarity(text, pattern);
    if (polarity === 'positive') { score += weight; signals.push(pattern.source.replaceAll('\\b', '').replace(/[()|?]/g, '')); }
    else if (polarity === 'negated') { score -= weight; signals.push('negated_urgent_signal'); }
  }
  if (['button', 'shake', 'keyboard'].includes(source)) score += 3;
  if (['duress_pin', 'safe_walk_duress'].includes(source)) score += 8;
  if (!text) score += 4;
  if (local_hour >= 22 || local_hour < 5) score += 1;
  if (risk_level === 'high') score += 4;
  if (risk_level === 'elevated') score += 1;
  score = Math.max(0, score);
  return { score, text, signals };
}

export function createRuleBasedTriage() {
  return {
    name: 'rule-based',
    analyze(input) {
      const { score, text, signals } = scoreIncident(input);
      const threat_level = score >= 7 ? 'CRITICAL' : score >= 3 ? 'ELEVATED' : 'LOW';
      const summary = text
        ? capWords(text.replace(/[\r\n]+/g, ' ').replace(/[^\p{L}\p{N}\s.,!?'-]/gu, '').replace(/\s+/g, ' '))
        : `${threat_level === 'CRITICAL' ? 'Emergency button activated' : 'Safety check requested'}; transcript unavailable.`;
      return {
        threat_level,
        summary: capWords(summary || 'Safety check requested; no transcript supplied.', 15),
        recommended_action: ACTIONS[threat_level],
        score,
        signals,
        engine: this.name
      };
    }
  };
}

let triageEngine = createRuleBasedTriage();
export function setTriageEngine(engine) {
  if (!engine || typeof engine.analyze !== 'function') throw new TypeError('Triage engine must implement analyze(input).');
  triageEngine = engine;
}
export async function runTriage(input) { return triageEngine.analyze(input); }
export function provisionalTriage(input) { return createRuleBasedTriage().analyze(input); }
export function triageHealth() { return `available:${triageEngine.name}`; }
export { capWords, scoreIncident, ACTIONS };
