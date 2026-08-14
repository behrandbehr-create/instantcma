// api/analyze-swing.js - Vercel Serverless Function
// Turns SwingLab's measured biomechanics into a personalized ATP-coach letter.
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    try {
        const { aggregate, scores, topThree } = req.body || {};
        if (!aggregate || !Array.isArray(scores)) {
            return res.status(400).json({ error: 'Missing aggregate/scores payload' });
        }

        const anthropic = new Anthropic({ apiKey });
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: 900,
            messages: [{
                role: 'user',
                content: `You are a veteran ATP tour coach reviewing a club player's swing session that was measured with markerless 33-point pose tracking. The player is preparing for their tennis club championships in 30 days. Their self-diagnosis: "my body mechanics are pretty stiff, I'm just swinging with my arm and not my body."

Measured session data (medians across ${aggregate.swings} swings, scored 0-100 against ATP reference bands):
${scores.map(s => `- ${s.label}: ${s.value === null ? 'n/a' : Number(s.value).toFixed(2)} (score ${s.score}/100) [reference: ${s.ref}]`).join('\n')}

The three weakest areas: ${topThree.join(', ')}.

Write a coaching letter of 3-4 short paragraphs, addressed directly to the player. Requirements:
- Speak like a real tour coach: direct, encouraging, technical but plain-spoken.
- Identify the single root cause that connects the weakest measurements, and explain the cause-and-effect chain in their swing.
- Reference 1-2 specific measured numbers from the data above.
- End with what "week one" should feel like on court - the one sensation to chase.
- No greetings like "Dear player", no sign-off, no markdown headers. Plain paragraphs only.`
            }]
        });

        const letter = message.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n')
            .trim();

        return res.status(200).json({ letter });
    } catch (error) {
        console.error('analyze-swing error:', error);
        return res.status(500).json({ error: 'Analysis failed' });
    }
};
