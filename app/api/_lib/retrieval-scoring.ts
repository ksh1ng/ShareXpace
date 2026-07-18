const STOP_WORDS = new Set(["a", "an", "and", "are", "best", "do", "for", "how", "i", "is", "of", "our", "the", "to", "we", "what", "which", "with"]);

export const SYNONYMS: Record<string, string> = {
  affordable: "moderate",
  eight: "8",
  five: "5",
  four: "4",
  jr: "rail",
  nine: "9",
  one: "1",
  railway: "rail",
  seven: "7",
  six: "6",
  ten: "10",
  three: "3",
  ticket: "pass",
  tickets: "pass",
  train: "rail",
  trains: "rail",
  travelling: "travel",
  two: "2",
};

function terms(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map((term) => SYNONYMS[term] ?? term).filter((term) => !STOP_WORDS.has(term)));
}

export function lexicalSimilarity(left: string, right: string) {
  const a = terms(left);
  const b = terms(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((term) => b.has(term)).length;
  return Math.min(0.98, (intersection / Math.min(a.size, b.size)) * 0.82 + (intersection / new Set([...a, ...b]).size) * 0.18);
}
