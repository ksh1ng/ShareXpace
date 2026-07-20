const MAX_CHUNKS = 200;
const CHUNK_CHARACTERS = 1_600;
const CHUNK_OVERLAP = 240;

export function chunkDocument(text: string) {
  const chunks: Array<{ content: string; charStart: number; charEnd: number; tokenCount: number }> = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(text.length, start + CHUNK_CHARACTERS);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("。", end));
      const boundary = Math.max(paragraph, sentence);
      if (boundary > start + Math.floor(CHUNK_CHARACTERS * 0.55)) end = boundary + (boundary === paragraph ? 2 : 1);
    }
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        charStart: start,
        charEnd: end,
        tokenCount: Math.max(1, Math.ceil(content.length / 4)),
      });
    }
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}
