/**
 * `$.gemini`, added by the gemini-core plugin: the Gemini key, the tier, and
 * each Gemini mod's model and thinking level, in one place.
 *
 * A method must answer within 10 s (measured on 2.1.278), so the request is
 * not sent here: `request` builds it, the caller sends it with
 * `$.http.fetch`, and `read` reads the answer and says whether to ask again.
 */

/** A Gemini thinking level. Which ones a model takes differs per model; an unsupported one is Gemini's HTTP 400. */
export type GeminiThinking = 'minimal' | 'low' | 'medium' | 'high'

export type GeminiTier = 'free' | 'paid'

/** A Gemini mod: its plugin name, and the model it uses until /gemini-core sets another. */
export type GeminiEnroll = { consumer: string; defaultModel: string }

/** What a Gemini mod runs with; `keys` counts the keys tried in turn, `thinking` absent is the model's own default. */
export type GeminiSettings = { hasKey: boolean; keys: number; tier: GeminiTier; model: string; thinking?: GeminiThinking }

/**
 * A generateContent POST with the key in a header, never in the URL. `tried`
 * holds why the keys before this one failed for the same request; send the
 * request with `url` and `init` and give the whole object back to `read`.
 */
export type GeminiHttp = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string }; tried?: readonly string[] }

/** `request`'s answer: the request with what it runs with, or why there is none. */
export type GeminiPrepared = { http: GeminiHttp; model: string; tier: GeminiTier } | { error: string }

/** The answer text and its token counts; `finishReason` is Gemini's, such as `STOP` or `MAX_TOKENS`. */
export type GeminiAnswer = { text: string; inputTokens: number; outputTokens: number; finishReason?: string }

/** One HTTP response, the request that got it, and where the caller is in its attempts. */
export type GeminiResponse = {
  /** The request as sent; its key says which key the next attempt moves on from. */
  http: GeminiHttp
  status: number
  ok: boolean
  text: string
  /** 1 for the first request. */
  attempt: number
  /** Milliseconds since the first request started. */
  elapsedMs: number
  /** No new attempt starts once this much has passed; 60000 when absent. */
  deadlineMs?: number
}

/**
 * `read`'s answer: the answer, why there is none, how long to wait before
 * sending the same request again, or the same request with the next key, to
 * send at once (after an HTTP 429 or a key error).
 */
export type GeminiRead = { answer: GeminiAnswer } | { error: string } | { retryInMs: number } | { next: GeminiHttp }

/** A change /gemini-core makes; `consumer` names the mod a model or thinking change is for. */
export type GeminiChange =
  | { tier: GeminiTier }
  | { consumer: string; model: string }
  | { consumer: string; thinking: GeminiThinking | null }
  | { reset: true }

export type Gemini = {
  /** Records a Gemini mod and its default model; call it at session start. */
  enroll(input: GeminiEnroll): Promise<void>
  /** What a mod runs with now. */
  settings(input: { consumer: string }): Promise<GeminiSettings>
  /** The request for a generateContent body, with the mod's model and thinking level. */
  request(input: { consumer: string; body: Record<string, unknown> }): Promise<GeminiPrepared>
  /** Reads a response; asks for another attempt after an HTTP 503 while the deadline allows, and moves to the next key after a 429 or a key error. */
  read(input: GeminiResponse): Promise<GeminiRead>
  /** Stores a change and answers the line /gemini-core prints. A mod may hook `gemini.configure` to follow its own changes. */
  configure(input: GeminiChange): Promise<string>
}

declare module 'claude-code' {
  interface EngineInterface {
    gemini: Gemini
  }
}
