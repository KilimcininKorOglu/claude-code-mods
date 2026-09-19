// The input of ExitPlanMode as a tool.call hook receives it, so the hook's matcher
// and `e` type-check. The headless /plugin-types lists no plan-mode tool; the engine
// adds `plan` and `planFilePath` to the model's input (measured on 2.1.278).
import 'claude-code'

declare module 'claude-code' {
  interface BuiltinToolInputs {
    ExitPlanMode: { plan?: string; planFilePath?: string; allowedPrompts?: unknown[] }
  }
}
