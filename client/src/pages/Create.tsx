import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVault } from "../context/VaultContext";
import { useToast } from "../context/ToastContext";
import { SeedPhraseDisplay } from "../components/SeedPhraseInput";
import { Button } from "../components/ui/Button";
import { generateMnemonic, mnemonicToWords } from "../utils/bip39";
import {
  type BurnTimerOption,
  BURN_TIMER_OPTIONS,
  BURN_TIMER_LABELS,
} from "../types/types";

type Step = "options" | "seed" | "confirm";

export function Create() {
  const navigate = useNavigate();
  const { createVault, isLoading, error, clearError } = useVault();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>("options");
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [burnTimer, setBurnTimer] = useState<BurnTimerOption>("never");
  const [mnemonic, setMnemonic] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const words = mnemonic ? mnemonicToWords(mnemonic) : [];

  const handleCopySeedPhrase = useCallback(async () => {
    const seedPhrase = words.join(" ");
    await navigator.clipboard.writeText(seedPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 5000);
  }, [words]);

  const handleGenerateSeed = useCallback(() => {
    const newMnemonic = generateMnemonic(wordCount);
    setMnemonic(newMnemonic);
    setStep("seed");
  }, [wordCount]);

  const handleConfirmStep = useCallback(() => {
    setStep("confirm");
  }, []);

  const handleCreateVault = async () => {
    if (!mnemonic || !confirmed) return;

    clearError();
    const success = await createVault(mnemonic, burnTimer);

    if (success) {
      showToast("Vault created successfully", "success");
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
          {/* Step 1: Options */}
          {step === "options" && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">
                  Create a new vault
                </h1>
                <p className="text-gray-400">
                  Configure your vault settings before generating your seed
                  phrase
                </p>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
                {/* Word count selection */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Seed phrase length
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setWordCount(12)}
                      className={`p-4 rounded-lg border text-left transition-colors ${
                        wordCount === 12
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-gray-700 hover:border-gray-600"
                      }`}>
                      <div className="font-medium text-white">12 words</div>
                      <div className="text-sm text-gray-400">
                        128-bit entropy
                      </div>
                    </button>
                    <button
                      onClick={() => setWordCount(24)}
                      className={`p-4 rounded-lg border text-left transition-colors ${
                        wordCount === 24
                          ? "border-cyan-500 bg-cyan-500/10"
                          : "border-gray-700 hover:border-gray-600"
                      }`}>
                      <div className="font-medium text-white">24 words</div>
                      <div className="text-sm text-gray-400">
                        256-bit entropy
                      </div>
                    </button>
                  </div>
                </div>

                {/* Burn timer selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Auto-delete timer
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {BURN_TIMER_OPTIONS.map((option) => (
                      <button
                        key={option}
                        onClick={() => setBurnTimer(option)}
                        className={`p-3 rounded-lg border text-sm transition-colors ${
                          burnTimer === option
                            ? "border-cyan-500 bg-cyan-500/10 text-white"
                            : "border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white"
                        }`}>
                        {BURN_TIMER_LABELS[option]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {burnTimer === "never"
                      ? "Your vault will never be automatically deleted"
                      : `Your vault will be permanently deleted after ${BURN_TIMER_LABELS[burnTimer]}`}
                  </p>
                </div>
              </div>

              <Button onClick={handleGenerateSeed} size="lg" fullWidth>
                Generate seed phrase
              </Button>
            </>
          )}

          {/* Step 2: Display seed phrase */}
          {step === "seed" && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">
                  Save your seed phrase
                </h1>
                <p className="text-gray-400">
                  Write down these words in order and store them securely
                </p>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
                <SeedPhraseDisplay words={words} wordCount={wordCount} />
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={handleCopySeedPhrase}
                    className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-white transition-colors ${
                      copied ? "bg-white/15" : "text-white hover:bg-white/15"
                    }`}>
                    {copied ? (
                      <>
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
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        <span>Copy Vault Phrase</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Security warning */}
              <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div className="text-sm">
                    <p className="font-medium text-yellow-400 mb-1">
                      Store this phrase securely
                    </p>
                    <ul className="text-yellow-400/80 space-y-1">
                      <li>Write it down on paper - do not store digitally</li>
                      <li>Keep it in a safe location</li>
                      <li>Never share it with anyone</li>
                      <li>If lost, your vault cannot be recovered</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep("options")}
                  className="flex-1">
                  Back
                </Button>
                <Button onClick={handleConfirmStep} className="flex-1">
                  I've saved my phrase
                </Button>
              </div>
            </>
          )}

          {/* Step 3: Confirm and create */}
          {step === "confirm" && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">
                  Confirm your vault
                </h1>
                <p className="text-gray-400">
                  Review your settings and confirm to create your vault
                </p>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
                {/* Summary */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-3 border-b border-gray-800">
                    <span className="text-gray-400">Seed phrase length</span>
                    <span className="text-white font-medium">
                      {wordCount} words
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-gray-800">
                    <span className="text-gray-400">Auto-delete timer</span>
                    <span className="text-white font-medium">
                      {BURN_TIMER_LABELS[burnTimer]}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="text-gray-400">Storage limit</span>
                    <span className="text-white font-medium">5 GB</span>
                  </div>
                </div>

                {/* Confirmation checkbox */}
                <label className="flex items-start gap-3 mt-6 pt-6 border-t border-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-gray-900"
                  />
                  <span className="text-sm text-gray-400">
                    I confirm that I have securely stored my seed phrase and
                    understand that losing it means permanent loss of access to
                    my vault.
                  </span>
                </label>
              </div>

              {/* Error message */}
              {error && (
                <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep("seed")}
                  disabled={isLoading}
                  className="flex-1">
                  Back
                </Button>
                <Button
                  onClick={handleCreateVault}
                  disabled={!confirmed || isLoading}
                  loading={isLoading}
                  className="flex-1">
                  Create vault
                </Button>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="text-center mt-6">
            <span className="text-gray-500 text-sm">
              Already have a vault?{" "}
            </span>
            <Link
              to="/login"
              className="text-cyan-500 hover:text-cyan-400 text-sm">
              Open it
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
