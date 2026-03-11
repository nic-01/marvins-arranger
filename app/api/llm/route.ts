import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.ANTHROPIC_API_KEY || '';

// Allow up to 60s for LLM calls (Vercel Pro limit)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 500 });
  }

  try {
    const body = await req.json();

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: body.max_tokens || 16000,
        thinking: body.thinking,
        system: body.system,
        messages: body.messages,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: `Claude API error ${resp.status}: ${err}` }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ hasKey: apiKey.length > 0 });
}
