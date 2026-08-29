import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { recordUsage } from "./usage.js";

let _client: OpenAI | null = null;
const client = () => (_client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
const model = () => process.env.PERCEPTION_MODEL ?? "gpt-5.6-luna";

/**
 * PERCEPTION. Cheap multimodal pass over one captured screen.
 * Answers only "what is literally here" — never "does this matter".
 * Significance is the user's call (they pressed the key) and the agent's (cognition).
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["what_it_is", "kind", "fields_filled", "fields_missing", "deadline", "next_step", "stakes", "effort_minutes", "confidence"],
  properties: {
    what_it_is: { type: "string", description: "Concrete name of the thing on screen, e.g. 'NSF grant application, section 3 of 7'" },
    kind: { type: "string", enum: ["form", "reply", "intention", "renewal", "promise", "other"] },
    fields_filled: { type: "array", items: { type: "string" } },
    fields_missing: { type: "array", items: { type: "string" } },
    deadline: { type: ["string", "null"], description: "ISO date ONLY if a due date is literally printed on the page. Otherwise null." },
    next_step: { type: "string", description: "The single next action needed to move this forward." },
    stakes: { type: "string", enum: ["official", "money", "work", "social", "personal", "none"],
      description: "What kind of consequence this carries, judged ONLY from what is visible: official/government form, money involved, work obligation, another person waiting, personal task, or none." },
    effort_minutes: { type: "integer", description: "Honest estimate of minutes needed to finish what remains, from what is visible." },
    confidence: { type: "number" },
  },
} as const;

const PROMPT = `You are reading one screenshot the user deliberately saved because they were interrupted.

Report ONLY what is visibly on the screen. Do not infer, do not speculate, do not judge importance.
If a due date is not literally printed on the page, deadline MUST be null.

NEVER extract or repeat secrets: passwords, card numbers, CVVs, OTPs, API keys, tokens,
government ID numbers. If you see one, omit it entirely.`;

// Defence in depth: strip anything secret-shaped even if the model ignores the instruction.
const SECRETS: RegExp[] = [
  /\b(?:\d[ -]*?){13,19}\b/g,               // card numbers
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,             // API keys
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\b\d{6}\b(?=.*(?:otp|code|verification))/gi,
];
const scrub = (s: string) => SECRETS.reduce((acc, re) => acc.replace(re, "[redacted]"), s);

export type Extraction = {
  what_it_is: string;
  kind: string;
  fields_filled: string[];
  fields_missing: string[];
  deadline: string | null;
  next_step: string;
  stakes: string;
  effort_minutes: number;
  confidence: number;
};

export async function extract(
  imagePath: string,
  meta: { app?: string; windowTitle?: string; url?: string },
  question?: string
): Promise<Extraction> {
  const b64 = readFileSync(imagePath).toString("base64");
  const context = [
    meta.app && `App: ${meta.app}`,
    meta.windowTitle && `Window: ${meta.windowTitle}`,
    meta.url && `URL: ${meta.url}`,
    question && `Focus especially on: ${question}`,
  ].filter(Boolean).join("\n");

  const res = await client().chat.completions.create({
    model: model(),
    messages: [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: context || "Read this screen." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "screen_extraction", schema: SCHEMA, strict: true },
    },
  });

  recordUsage({
    source: "perception", model: model(),
    input: res.usage?.prompt_tokens ?? 0,
    output: res.usage?.completion_tokens ?? 0,
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  return JSON.parse(scrub(raw)) as Extraction;
}
