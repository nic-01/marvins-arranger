/**
 * LLM Integration Layer
 *
 * Uses Claude Opus 4.6 API to provide creative musical intelligence:
 * - Evaluate candidate arrangements for musical narrative
 * - Suggest mashup pairings beyond algorithmic detection
 * - Generate detailed arrangement notes
 * - Identify bridge songs that connect disparate sections
 */

import type { Song } from './types';

// ── API Configuration ───────────────────────────────────────────────────────

let apiKey = '';

export function setApiKey(key: string): void {
  apiKey = key;
}

export function getApiKey(): string {
  return apiKey;
}

export function hasApiKey(): boolean {
  return apiKey.length > 0;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

async function callClaude(
  messages: Message[],
  systemPrompt: string,
  maxTokens: number = 4096
): Promise<string> {
  if (!apiKey) throw new Error('No API key set. Call setApiKey() first.');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.content[0]?.text || '';
}

// ── Song formatting helpers ─────────────────────────────────────────────────

function formatSongCompact(song: Song, idx?: number): string {
  const prefix = idx !== undefined ? `[${idx}] ` : '';
  return `${prefix}"${song.title}" - ${song.artist} (${song.year}) | ${song.bpm}bpm ${song.key} | ${song.genre} | Energy:${song.energy} | ${song.vocal_gender}${song.crowd_singalong ? ' | SINGALONG' : ''}${song.horn_friendly ? ' | HORNS' : ''}`;
}

function formatPathCompact(songs: Song[]): string {
  return songs.map((s, i) => formatSongCompact(s, i)).join('\n');
}

// ── LLM-powered analysis functions ─────────────────────────────────────────

export interface LLMPathEvaluation {
  ranking: number[];           // path indices ranked best to worst
  reasoning: string;           // why this ranking
  suggestedSwaps: SuggestedSwap[];
}

export interface SuggestedSwap {
  position: number;            // index in the path
  currentSongTitle: string;
  suggestedSongTitle: string;
  reason: string;
}

/**
 * Ask the LLM to evaluate and rank candidate paths.
 */
export async function evaluatePaths(
  candidatePaths: Song[][],
  allSongs: Song[]
): Promise<LLMPathEvaluation> {
  const systemPrompt = `You are a world-class musical director arranging a "100 Years of Music" medley for a live band. You have deep knowledge of popular music history, performance dynamics, and audience engagement.

Your job: evaluate candidate song sequences for a medley and rank them by musical quality. Consider:
- Does the sequence tell a compelling musical story through the decades?
- Are transitions between songs musically natural (not just by BPM/key, but by feel and cultural connection)?
- Are there exciting moments of recognition for the audience?
- Is there good variety (tempo, energy, vocal, genre) while maintaining flow?
- Would a band enjoy performing this sequence?

Respond in JSON format only.`;

  const pathDescriptions = candidatePaths.map((path, i) =>
    `=== PATH ${i} (${path.length} songs) ===\n${formatPathCompact(path)}`
  ).join('\n\n');

  const userMessage = `Here are ${candidatePaths.length} candidate medley paths. Rank them from best to worst and suggest up to 3 song swaps that would improve the best path.

${pathDescriptions}

Available songs not in any path that could be swapped in:
${allSongs.filter(s => !candidatePaths.some(p => p.some(ps => ps.id === s.id))).slice(0, 50).map(s => formatSongCompact(s)).join('\n')}

Respond as JSON:
{
  "ranking": [best_path_index, ..., worst_path_index],
  "reasoning": "brief explanation",
  "suggestedSwaps": [
    {"position": 5, "currentSongTitle": "...", "suggestedSongTitle": "...", "reason": "..."}
  ]
}`;

  const response = await callClaude(
    [{ role: 'user', content: userMessage }],
    systemPrompt,
    2048
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as LLMPathEvaluation;
  } catch {
    return {
      ranking: candidatePaths.map((_, i) => i),
      reasoning: response,
      suggestedSwaps: [],
    };
  }
}

// ── Mashup discovery ────────────────────────────────────────────────────────

export interface LLMMashupSuggestion {
  song1Title: string;
  song2Title: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Ask the LLM to identify mashup opportunities beyond algorithmic detection.
 */
export async function discoverMashups(
  selectedSongs: Song[]
): Promise<LLMMashupSuggestion[]> {
  const systemPrompt = `You are a mashup artist and musical director. Given a list of songs in a medley, identify pairs that could work as mashups — where one song's instrumental/groove is played while the other's vocals are sung over it.

Focus on pairs that a musician would recognize as naturally complementary:
- Similar groove/feel even if technically different BPM (could be half/double time)
- Cultural or musical connections audiences would appreciate
- Complementary instrumentation (one provides the bed, the other the melody)

Only suggest mashups you're confident would actually work musically. Respond in JSON.`;

  const userMessage = `Here are the songs in our medley. Identify mashup pairs:

${formatPathCompact(selectedSongs)}

Respond as JSON array:
[
  {"song1Title": "...", "song2Title": "...", "reason": "...", "confidence": "high|medium|low"}
]`;

  const response = await callClaude(
    [{ role: 'user', content: userMessage }],
    systemPrompt,
    2048
  );

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as LLMMashupSuggestion[];
  } catch {
    return [];
  }
}

// ── Arrangement notes generation ────────────────────────────────────────────

export interface LLMArrangementNotes {
  songNotes: Record<string, string>;  // song title → arrangement note
  overallNarrative: string;
}

/**
 * Generate detailed, musician-friendly arrangement notes for the full medley.
 */
export async function generateArrangementNotes(
  orderedSongs: Song[]
): Promise<LLMArrangementNotes> {
  const systemPrompt = `You are a musical director writing arrangement notes for a live band performing a "100 Years of Music" medley. Write practical, musician-friendly notes.

For each song, describe:
- How to enter the song (the musical move, not just "hard cut")
- What section to play and why
- Any special performance notes (groove feel, dynamics, crowd interaction)
- How to exit into the next song

Keep notes concise (1-2 sentences each). Write like you're talking to the band at rehearsal.
Respond in JSON format only.`;

  // Break into chunks if needed (long medleys)
  const songList = orderedSongs.map((s, i) => {
    const prev = i > 0 ? orderedSongs[i - 1] : null;
    const next = i < orderedSongs.length - 1 ? orderedSongs[i + 1] : null;
    return `${i + 1}. ${formatSongCompact(s)}${prev ? `\n   (from: "${prev.title}" ${prev.bpm}bpm ${prev.key})` : ''}${next ? `\n   (to: "${next.title}" ${next.bpm}bpm ${next.key})` : ''}`;
  }).join('\n');

  const userMessage = `Write arrangement notes for this medley sequence:

${songList}

Respond as JSON:
{
  "overallNarrative": "2-3 sentence description of the medley's story arc",
  "songNotes": {
    "Song Title": "arrangement note for band..."
  }
}`;

  const response = await callClaude(
    [{ role: 'user', content: userMessage }],
    systemPrompt,
    4096
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as LLMArrangementNotes;
  } catch {
    return {
      songNotes: {},
      overallNarrative: response,
    };
  }
}

// ── Bridge song identification ──────────────────────────────────────────────

export interface BridgeSongSuggestion {
  title: string;
  insertAfter: string;    // title of song it should follow
  reason: string;
}

/**
 * Identify songs from the catalog that could serve as bridges
 * between two otherwise incompatible songs.
 */
export async function suggestBridgeSongs(
  currentPath: Song[],
  catalog: Song[],
  problematicTransitions: { fromIdx: number; toIdx: number; cost: number }[]
): Promise<BridgeSongSuggestion[]> {
  if (problematicTransitions.length === 0) return [];

  const systemPrompt = `You are a musical director solving transition problems in a medley. Given pairs of songs that don't transition well, suggest "bridge songs" from the catalog that could be inserted between them to smooth the transition.

A good bridge song:
- Has BPM/key compatible with both neighbors
- Provides a natural genre/energy stepping stone
- Is recognizable enough to justify inclusion
- Could work as a short 8-bar snippet

Respond in JSON format only.`;

  const problems = problematicTransitions.slice(0, 5).map(t => {
    const from = currentPath[t.fromIdx];
    const to = currentPath[t.toIdx];
    return `FROM: ${formatSongCompact(from)}\nTO: ${formatSongCompact(to)}\n(transition cost: ${t.cost.toFixed(0)})`;
  }).join('\n---\n');

  const pathIds = new Set(currentPath.map(s => s.id));
  const availableSongs = catalog
    .filter(s => !pathIds.has(s.id))
    .map(s => formatSongCompact(s))
    .join('\n');

  const userMessage = `These transitions in our medley are rough. Suggest bridge songs to insert:

PROBLEMATIC TRANSITIONS:
${problems}

AVAILABLE SONGS:
${availableSongs}

Respond as JSON array:
[{"title": "...", "insertAfter": "title of song before insertion point", "reason": "..."}]`;

  const response = await callClaude(
    [{ role: 'user', content: userMessage }],
    systemPrompt,
    2048
  );

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as BridgeSongSuggestion[];
  } catch {
    return [];
  }
}
