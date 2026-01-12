import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ClipboardEvent,
  type ChangeEvent,
} from "react";
import {
  isValidWord,
  isUniqueValidWord,
  getWordSuggestions,
  parseMnemonic,
  wordsToMnemonic,
} from "../utils/bip39";

interface SeedPhraseInputProps {
  wordCount: 12 | 24;
  onComplete: (mnemonic: string) => void;
  onValidChange?: (isValid: boolean, words: string[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  initialWords?: string[];
}

export function SeedPhraseInput({
  wordCount,
  onComplete,
  onValidChange,
  disabled = false,
  readOnly = false,
  initialWords,
}: SeedPhraseInputProps) {
  const [words, setWords] = useState<string[]>(
    initialWords || Array(wordCount).fill("")
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Grid layout: 3 columns for 12 words, 4 columns for 24 words
  const columns = wordCount === 12 ? 3 : 4;

  // Calculate validation state for each word
  const validationState = words.map((word) =>
    word.length === 0 ? null : isValidWord(word)
  );

  // Check if all words are valid
  const allValid = words.every(
    (word, i) => word.length > 0 && validationState[i] === true
  );

  // Notify parent of validation changes
  useEffect(() => {
    onValidChange?.(allValid, words);
    if (allValid) {
      onComplete(wordsToMnemonic(words));
    }
  }, [allValid, words, onComplete, onValidChange]);

  // Focus first empty or invalid input on mount
  useEffect(() => {
    if (!disabled && !readOnly) {
      const firstEmptyIndex = words.findIndex((w) => w.length === 0);
      const targetIndex = firstEmptyIndex >= 0 ? firstEmptyIndex : 0;
      inputRefs.current[targetIndex]?.focus();
      setActiveIndex(targetIndex);
    }
  }, []);

  const updateWord = useCallback(
    (index: number, value: string) => {
      const newWords = [...words];
      newWords[index] = value.toLowerCase().trim();
      setWords(newWords);

      const uniqueValid = isUniqueValidWord(value);

      // Auto-advance only when word is valid AND no other words start with it
      if (uniqueValid && index < wordCount - 1) {
        setSuggestions([]);
        const nextIndex = index + 1;
        setActiveIndex(nextIndex);
        setTimeout(() => inputRefs.current[nextIndex]?.focus(), 0);
      } else if (value.length > 0) {
        // Show suggestions for partial input OR valid words with longer alternatives
        // e.g., "sun" shows dropdown with sun (exact match first), sunny, sunset
        const newSuggestions = getWordSuggestions(value);
        // Sort exact match to the top if it exists
        const sortedSuggestions = newSuggestions.sort((a, b) => {
          if (a === value) return -1;
          if (b === value) return 1;
          return 0;
        });
        setSuggestions(sortedSuggestions);
        setSelectedSuggestionIndex(0);
      } else {
        setSuggestions([]);
      }
    },
    [words, wordCount]
  );

  const selectSuggestion = useCallback(
    (word: string) => {
      updateWord(activeIndex, word);
      setSuggestions([]);

      // Move to next input
      if (activeIndex < wordCount - 1) {
        const nextIndex = activeIndex + 1;
        setActiveIndex(nextIndex);
        setTimeout(() => inputRefs.current[nextIndex]?.focus(), 0);
      }
    },
    [activeIndex, wordCount, updateWord]
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>, index: number) => {
      updateWord(index, e.target.value);
    },
    [updateWord]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, index: number) => {
      // Handle suggestion navigation
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestionIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestionIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectSuggestion(suggestions[selectedSuggestionIndex]);
          return;
        }
        if (e.key === "Escape") {
          setSuggestions([]);
          return;
        }
      }

      // Move between inputs
      if (e.key === "Tab" && !e.shiftKey) {
        if (validationState[index] === true && index < wordCount - 1) {
          e.preventDefault();
          const nextIndex = index + 1;
          setActiveIndex(nextIndex);
          inputRefs.current[nextIndex]?.focus();
        }
      } else if (e.key === "Tab" && e.shiftKey) {
        if (index > 0) {
          e.preventDefault();
          const prevIndex = index - 1;
          setActiveIndex(prevIndex);
          inputRefs.current[prevIndex]?.focus();
        }
      } else if (e.key === "Enter" && validationState[index] === true) {
        e.preventDefault();
        if (index < wordCount - 1) {
          const nextIndex = index + 1;
          setActiveIndex(nextIndex);
          inputRefs.current[nextIndex]?.focus();
        }
      } else if (e.key === "Backspace" && words[index] === "" && index > 0) {
        e.preventDefault();
        const prevIndex = index - 1;
        setActiveIndex(prevIndex);
        inputRefs.current[prevIndex]?.focus();
      }
    },
    [
      suggestions,
      selectedSuggestionIndex,
      selectSuggestion,
      validationState,
      wordCount,
      words,
    ]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const pastedText = e.clipboardData.getData("text");
      const pastedWords = parseMnemonic(pastedText);

      // If pasted text contains multiple words, fill the grid
      if (pastedWords.length > 1) {
        e.preventDefault();

        // Use exactly wordCount words (or fill what we have)
        const newWords = Array(wordCount).fill("");
        for (let i = 0; i < Math.min(pastedWords.length, wordCount); i++) {
          newWords[i] = pastedWords[i];
        }
        setWords(newWords);
        setSuggestions([]);

        // Focus last filled input or first empty
        const lastFilledIndex = Math.min(pastedWords.length, wordCount) - 1;
        setActiveIndex(lastFilledIndex);
        inputRefs.current[lastFilledIndex]?.focus();
      }
    },
    [wordCount]
  );

  const handleFocus = useCallback(
    (index: number) => {
      setActiveIndex(index);
      // Show suggestions if there's partial input
      const word = words[index];
      if (word.length > 0 && !isValidWord(word)) {
        setSuggestions(getWordSuggestions(word));
      } else {
        setSuggestions([]);
      }
    },
    [words]
  );

  const handleBlur = useCallback(() => {
    // Delay hiding suggestions to allow click
    setTimeout(() => setSuggestions([]), 150);
  }, []);

  // Check if input should be disabled (sequential unlocking)
  const isInputDisabled = (index: number): boolean => {
    if (disabled || readOnly) return true;
    // First input is always enabled
    if (index === 0) return false;
    // Enable if previous word is valid OR if we have a value (for paste support)
    return validationState[index - 1] !== true && words[index].length === 0;
  };

  return (
    <div className="w-full">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: wordCount }, (_, index) => (
          <div key={index} className="relative">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-5 text-right">
                {index + 1}.
              </span>
              <input
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                value={words[index]}
                onChange={(e) => handleChange(e, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onPaste={handlePaste}
                onFocus={() => handleFocus(index)}
                onBlur={handleBlur}
                disabled={isInputDisabled(index)}
                readOnly={readOnly}
                className={`
                  w-full px-3 py-2 rounded-lg border text-sm font-mono
                  bg-gray-800 text-white placeholder-gray-500
                  focus:outline-none focus:ring-2 focus:ring-cyan-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors
                  ${validationState[index] === true ? "border-green-500" : ""}
                  ${validationState[index] === false ? "border-red-500" : ""}
                  ${validationState[index] === null ? "border-gray-600" : ""}
                `}
                placeholder={`Word ${index + 1}`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {validationState[index] === true && (
                <span className="text-green-500 text-sm">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </span>
              )}
            </div>

            {/* Autocomplete dropdown */}
            {activeIndex === index && suggestions.length > 0 && !readOnly && (
              <div className="absolute z-20 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {suggestions.map((suggestion, suggestionIndex) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => selectSuggestion(suggestion)}
                    className={`
                      w-full px-3 py-2 text-left text-sm font-mono text-white
                      hover:bg-gray-700 transition-colors
                      ${suggestionIndex === selectedSuggestionIndex ? "bg-gray-700" : ""}
                    `}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-300"
            style={{
              width: `${(words.filter((_, i) => validationState[i] === true).length / wordCount) * 100}%`,
            }}
          />
        </div>
        <span className="text-xs text-gray-400">
          {words.filter((_, i) => validationState[i] === true).length}/
          {wordCount}
        </span>
      </div>
    </div>
  );
}

// Display-only version for showing seed phrase
export function SeedPhraseDisplay({
  words,
  wordCount = 12,
}: {
  words: string[];
  wordCount?: 12 | 24;
}) {
  const columns = wordCount === 12 ? 3 : 4;

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {words.map((word, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-5 text-right">
            {index + 1}.
          </span>
          <div className="flex-1 px-3 py-2 rounded-lg border border-gray-600 bg-gray-800 text-white font-mono text-sm">
            {word}
          </div>
        </div>
      ))}
    </div>
  );
}
