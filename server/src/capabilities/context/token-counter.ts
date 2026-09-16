import type { ContextMessage, ContextTokenCounter, TokenCount } from "./contracts.js";

/**
 * A conservative fallback for providers without a locally available tokenizer.
 * It deliberately reports `estimated`; callers must not present it as provider
 * accounting. A model-specific tokenizer can replace this adapter later.
 */
export class CharacterTokenEstimator implements ContextTokenCounter {
  constructor(
    private readonly basis = "character-estimator-v1",
    private readonly charactersPerToken = 3,
    private readonly messageOverheadTokens = 8,
  ) {
    if (!Number.isFinite(charactersPerToken) || charactersPerToken <= 0) {
      throw new Error("charactersPerToken must be greater than zero.");
    }
    if (!Number.isInteger(messageOverheadTokens) || messageOverheadTokens < 0) {
      throw new Error("messageOverheadTokens must be a non-negative integer.");
    }
  }

  count(messages: readonly ContextMessage[]): TokenCount {
    const textCharacters = messages.reduce((total, message) => total + [...message.content].length, 0);
    const tokens = Math.ceil(textCharacters / this.charactersPerToken) + messages.length * this.messageOverheadTokens;
    return { tokens, quality: "estimated", basis: this.basis };
  }
}

export class FixedTokenCounter implements ContextTokenCounter {
  constructor(
    private readonly tokensByMessage: Readonly<Record<string, number>>,
    private readonly basis = "fixed-test-counter-v1",
  ) {}

  count(messages: readonly ContextMessage[]): TokenCount {
    const tokens = messages.reduce((total, message) => total + (this.tokensByMessage[message.messageId] ?? 0), 0);
    return { tokens, quality: "exact", basis: this.basis };
  }
}
