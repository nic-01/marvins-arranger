import { NextResponse } from 'next/server';

/**
 * Server-side proxy for Claude API pair scoring.
 * Keeps the API key secret (not exposed to browser).
 * Uses Claude Opus 4.6 with extended thinking for best results.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY || '';

interface PairInput {
  songA: { title: string; artist: string; year: number; bpm: number; key: string; genre: string; energy: string };
  songB: { title: string; artist: string; year: number; bpm: number; key: string; genre: string; energy: string };
  algoScore: number;
  mashupPotential: number;
  quality: string;
}

const SYSTEM_PROMPT = `You are a world-class musical director arranging a "100 Years of Music" medley for a live 10-piece band with horns. You have deep knowledge of popular music history, performance dynamics, and audience engagement.

Your job: score candidate song PAIRS for a medley. These are potential neighbors — songs that would be played back-to-back (in either order). Score each pair on:

1. **narrative** (1-10): Do these songs have a natural connection? Cultural link, thematic resonance, artist connection, era-defining pairing? Would audiences feel "yes, of course those go together"? A 10 means iconic pairing (like "Stayin' Alive" into "Le Freak"), a 1 means no connection beyond technical compatibility.

2. **transition** (1-10): Would the transition between these songs be a "moment"? Consider groove continuity, energy flow, key/tempo compatibility (already scored algorithmically — focus on the FEEL). A 10 means the band would nail this and the crowd would roar. A 1 means it would feel forced.

3. **mashup** (1-10): Could these songs be overlaid — one song's groove/instrumental under the other's vocals? Consider rhythmic compatibility, harmonic fit, and whether it would sound intentional vs. chaotic. A 10 means a mashup DJ would already have done this. A 1 means they'd never work together.

Be discriminating. Most pairs should score 3-6. Reserve 8-10 for genuinely special pairings. Give 1-2 for pairs that technically work but have no musical chemistry.

Respond with a JSON array only — no other text.`;

export async function POST(request: Request) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'No ANTHROPIC_API_KEY configured' }, { status: 500 });
  }

  const { pairs } = (await request.json()) as { pairs: PairInput[] };

  if (!pairs || pairs.length === 0) {
    return NextResponse.json({ error: 'No pairs provided' }, { status: 400 });
  }

  const pairList = pairs.map((p, i) => {
    return `[${i + 1}] "${p.songA.title}" - ${p.songA.artist} (${p.songA.year}, ${p.songA.bpm}bpm ${p.songA.key}, ${p.songA.genre}, ${p.songA.energy}) ↔ "${p.songB.title}" - ${p.songB.artist} (${p.songB.year}, ${p.songB.bpm}bpm ${p.songB.key}, ${p.songB.genre}, ${p.songB.energy}) [algo:${p.algoScore}, mashup:${p.mashupPotential}, quality:${p.quality}]`;
  }).join('\n');

  const userMessage = `Score these ${pairs.length} song pairs for a live medley. For each, rate narrative, transition, and mashup potential (1-10) with brief reasoning.

${pairList}

Respond as JSON array:
[
  {"songATitle": "...", "songBTitle": "...", "narrative": N, "transition": N, "mashup": N, "reasoning": "..."},
  ...
]`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2025-04-14',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 16000,
        thinking: {
          type: 'enabled',
          budget_tokens: 10000,
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: `Claude API error ${resp.status}: ${err}` }, { status: resp.status });
    }

    const data = await resp.json();
    const textBlock = data.content.find((b: { type: string }) => b.type === 'text');
    const text = textBlock?.text || '';

    // Parse JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'No JSON array in LLM response', raw: text.slice(0, 500) }, { status: 500 });
    }

    const scores = JSON.parse(jsonMatch[0]).map((s: { narrative: number; transition: number; mashup: number }) => ({
      ...s,
      narrative: Math.min(10, Math.max(1, Math.round(s.narrative))),
      transition: Math.min(10, Math.max(1, Math.round(s.transition))),
      mashup: Math.min(10, Math.max(1, Math.round(s.mashup))),
    }));

    return NextResponse.json({ scores });
  } catch (err) {
    return NextResponse.json({ error: `Failed: ${err}` }, { status: 500 });
  }
}
