// Deterministic test brain: returns scripted turns, then "OK".
// The whole engine is testable hermetically — no GPU, no services.

import type { Brain, ChatMessage, ChatOptions } from '../protocol/types.js'

export class EchoBrain implements Brain {
  readonly id = 'echo'
  readonly label = 'Echo (deterministic test brain)'

  #script: string[]

  constructor(script: string[]) {
    this.#script = [...script]
  }

  async chat(_messages: ChatMessage[], _opts?: ChatOptions): Promise<string> {
    return this.#script.shift() ?? 'OK'
  }
}
