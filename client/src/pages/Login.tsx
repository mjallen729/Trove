import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import { SeedPhraseInput } from "../components/SeedPhraseInput";
import { Button } from "../components/ui/Button";

export function Login() {
  const navigate = useNavigate();
  const { unlockVault, isLoading, error, clearError } = useVault();
  const { showToast } = useToast();
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [isValid, setIsValid] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  const handleValidChange = useCallback((valid: boolean, words: string[]) => {
    setIsValid(valid);
    if (valid) {
      setMnemonic(words.join(" "));
    }
  }, []);

  const handleComplete = useCallback((mnemonicStr: string) => {
    setMnemonic(mnemonicStr);
  }, []);

  const handleUnlock = async () => {
    if (!mnemonic) return;

    clearError();
    const success = await unlockVault(mnemonic);

    if (success) {
      showToast("Vault unlocked successfully", "success");
      navigate("/vault");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <Link to="/" className="flex items-center gap-2 w-fit">
          <svg
            className="w-8 h-8 text-cyan-500"
            viewBox="0 0 24 24"
            fill="currentColor">
            <path d="M12 2C9.24 2 7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2h-1V7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v3H9V7c0-1.66 1.34-3 3-3zm0 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" />
          </svg>
          <span className="text-2xl font-bold text-white">Trove</span>
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Open your vault
            </h1>
            <p className="text-gray-400">
              Enter your seed phrase to access your encrypted files
            </p>
          </div>

          {/* Word count toggle */}
          <div className="flex justify-center gap-2 mb-6">
            <button
              onClick={() => setWordCount(12)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                wordCount === 12
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}>
              12 words
            </button>
            <button
              onClick={() => setWordCount(24)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                wordCount === 24
                  ? "bg-cyan-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}>
              24 words
            </button>
          </div>

          {/* Seed phrase input */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <SeedPhraseInput
              key={wordCount}
              wordCount={wordCount}
              onComplete={handleComplete}
              onValidChange={handleValidChange}
              disabled={isLoading}
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg">
              <p className="text-red-400 text-sm text-center">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-4">
            <Button
              onClick={handleUnlock}
              disabled={!isValid || isLoading}
              loading={isLoading}
              size="lg"
              fullWidth>
              Unlock vault
            </Button>

            <div className="text-center">
              <span className="text-gray-500 text-sm">
                Don't have a vault?{" "}
              </span>
              <Link
                to="/create"
                className="text-cyan-500 hover:text-cyan-400 text-sm">
                Create one
              </Link>
            </div>
          </div>

          {/* Security notice */}
          <div className="mt-8 p-4 bg-gray-900/50 border border-gray-800 rounded-lg">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-cyan-500 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-sm text-gray-400">
                <p className="font-medium text-gray-300 mb-1">
                  Your keys, your data
                </p>
                <p>
                  Your seed phrase never leaves your device. All encryption
                  happens locally in your browser. We cannot recover your vault
                  if you lose your seed phrase.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
