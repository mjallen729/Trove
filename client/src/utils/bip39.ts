import * as bip39 from "bip39";

// English wordlist for autocomplete (2048 words)
export const BIP39_WORDLIST = bip39.wordlists.english;

/**
 * Generate a new BIP39 mnemonic
 * @param wordCount 12 for 128-bit entropy, 24 for 256-bit entropy
 */
export function generateMnemonic(wordCount: 12 | 24 = 12): string {
  const strength = wordCount === 12 ? 128 : 256;
  return bip39.generateMnemonic(strength);
}

/**
 * Validate entire mnemonic phrase (checksum and wordlist)
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

/**
 * Check if a single word is in the BIP39 wordlist
 */
export function isValidWord(word: string): boolean {
  if (!word || typeof word !== "string") return false;
  return BIP39_WORDLIST.includes(word.toLowerCase().trim());
}

/**
 * Get autocomplete suggestions for partial word input
 * @param partial The partial word to match
 * @param limit Maximum number of suggestions to return
 */
export function getWordSuggestions(
  partial: string,
  limit: number = 8
): string[] {
  if (!partial || partial.length < 1) return [];

  const lowered = partial.toLowerCase().trim();
  return BIP39_WORDLIST.filter((word) => word.startsWith(lowered)).slice(
    0,
    limit
  );
}

/**
 * Get exact match or null if partial doesn't uniquely match a word
 */
export function getExactMatch(partial: string): string | null {
  const suggestions = getWordSuggestions(partial, 2);
  if (suggestions.length === 1) {
    return suggestions[0];
  }
  return null;
}

/**
 * Check if word is valid AND no other valid words start with it
 * Used for auto-advance: "sun" returns false (sunny, sunset exist), "sunset" returns true
 */
export function isUniqueValidWord(word: string): boolean {
  if (!isValidWord(word)) return false;
  const longerMatches = BIP39_WORDLIST.filter(
    (w) => w.startsWith(word) && w !== word
  );
  return longerMatches.length === 0;
}

/**
 * Parse a pasted mnemonic string into array of words
 */
export function parseMnemonic(input: string): string[] {
  return input
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * Normalize mnemonic (lowercase, single spaces, trimmed)
 */
export function normalizeMnemonic(words: string[]): string {
  return words
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 0)
    .join(" ");
}

/**
 * Convert mnemonic string to array of words
 */
export function mnemonicToWords(mnemonic: string): string[] {
  return parseMnemonic(mnemonic);
}

/**
 * Convert array of words to mnemonic string
 */
export function wordsToMnemonic(words: string[]): string {
  return normalizeMnemonic(words);
}

/**
 * Validate word count (must be 12 or 24)
 */
export function isValidWordCount(count: number): count is 12 | 24 {
  return count === 12 || count === 24;
}

/**
 * Get the expected word count based on partial input
 * Returns null if ambiguous
 */
export function detectWordCount(words: string[]): 12 | 24 | null {
  const count = words.length;
  if (count <= 12) return 12;
  if (count <= 24) return 24;
  return null;
}

/**
 * Check if all words in array are valid BIP39 words
 */
export function allWordsValid(words: string[]): boolean {
  return words.every(isValidWord);
}

/**
 * Find the first invalid word in array (returns index, or -1 if all valid)
 */
export function findFirstInvalidWord(words: string[]): number {
  return words.findIndex((word) => !isValidWord(word));
}

/**
 * Get validation state for each word
 */
export function getValidationStates(words: string[]): boolean[] {
  return words.map((word) => word.length === 0 || isValidWord(word));
}
