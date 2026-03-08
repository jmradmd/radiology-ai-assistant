import { RAG_CONFIG } from "@rad-assist/shared";

export { generateEmbedding } from "@rad-assist/api/lib/embedding-client";

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  metadata?: {
    section?: string;
    page?: number;
    isTable?: boolean;
  };
}

/**
 * Reciprocal Rank Fusion for hybrid search
 */
export function reciprocalRankFusion<T extends { id: string }>(
  ...rankings: T[][]
): T[] {
  const k = 60; // RRF constant
  const scores = new Map<string, { item: T; score: number }>();

  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const item = ranking[i];
      const rrf = 1 / (k + i + 1);
      
      if (scores.has(item.id)) {
        scores.get(item.id)!.score += rrf;
      } else {
        scores.set(item.id, { item, score: rrf });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

/**
 * Build RAG prompt with context
 */
export function buildRAGPrompt(
  query: string,
  context: SearchResult[]
): string {
  const contextText = context
    .map(
      (c, i) =>
        `[${i + 1}] ${c.documentTitle}${c.metadata?.section ? ` - ${c.metadata.section}` : ""}:\n${c.content}`
    )
    .join("\n\n");

  return `You are a radiology protocol assistant for the your institution radiology department.

RULES:
1. ONLY answer based on the provided protocol documents
2. If information is not in the context, say "This information is not found in our protocols"
3. ALWAYS cite your sources with [Source: Document Name, Section X.Y] format
4. For dosing information, quote the exact text from the protocol
5. Never provide patient-specific medical advice
6. If uncertain, acknowledge the uncertainty
7. Be concise and clinically relevant

CONTEXT:
${contextText}

USER QUESTION: ${query}`;
}

/**
 * Simple text chunking with overlap
 */
export function chunkText(
  text: string,
  chunkSize: number = RAG_CONFIG.CHUNK_SIZE,
  overlap: number = RAG_CONFIG.CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length;
    
    if (currentLength + sentenceWords > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
      
      // Keep overlap
      const overlapSentences = Math.ceil(overlap / 50); // ~50 words per sentence
      currentChunk = currentChunk.slice(-overlapSentences);
      currentLength = currentChunk.join(" ").split(/\s+/).length;
    }
    
    currentChunk.push(sentence);
    currentLength += sentenceWords;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}

/**
 * Detect if text is a table (for special handling)
 */
export function isTableContent(text: string): boolean {
  const tableIndicators = [
    /\|.*\|.*\|/,  // Markdown tables
    /\t.*\t.*\t/,  // Tab-separated
    /^\s*\d+\.\s+.*\s+\d+/m,  // Numbered lists with values
  ];
  
  return tableIndicators.some((pattern) => pattern.test(text));
}
