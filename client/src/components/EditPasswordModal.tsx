/**
 * @module components/EditPasswordModal
 * @description Set up or enter the vault edit password. Setup mode briefs the
 * user and asks for a confirmed password; unlock mode asks for the password.
 */
import { useState, type FormEvent } from "react";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

const MIN_PASSWORD_LENGTH = 8;

interface EditPasswordModalProps {
  mode: "setup" | "unlock";
  isOpen: boolean;
  onClose: () => void;
  /** Resolves false when the password was rejected (unlock mode only) */
  onSubmit: (password: string) => Promise<boolean>;
}

export function EditPasswordModal({
  mode,
  isOpen,
  onClose,
  onSubmit,
}: EditPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSetup = mode === "setup";

  const reset = () => {
    setPassword("");
    setConfirm("");
    setFieldError(null);
    setError(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setError(null);

    if (isSetup) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setFieldError(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
        );
        return;
      }
      if (password !== confirm) {
        setFieldError("Passwords do not match");
        return;
      }
    } else if (!password) {
      setFieldError("Enter the edit password");
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await onSubmit(password);
      if (ok) {
        reset();
        onClose();
      } else {
        setFieldError("Incorrect password");
        setIsSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isSetup ? "Set edit password" : "Unlock editing"}
      closeOnOverlayClick={!isSubmitting}
      closeOnEscape={!isSubmitting}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {isSetup && (
          <p className="text-sm text-gray-400">
            Anyone with the seed phrase can view and download files. With an
            edit password set, uploading, creating folders, and deleting also
            require this password. It cannot be changed or removed in this
            version, so store it somewhere safe.
          </p>
        )}

        <Input
          type="password"
          label={isSetup ? "Edit password" : undefined}
          placeholder={isSetup ? "At least 8 characters" : "Edit password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete={isSetup ? "new-password" : "current-password"}
          disabled={isSubmitting}
          error={!isSetup ? (fieldError ?? undefined) : undefined}
        />

        {isSetup && (
          <Input
            type="password"
            label="Confirm password"
            placeholder="Repeat the password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={isSubmitting}
            error={fieldError ?? undefined}
          />
        )}

        {error && (
          <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            {isSetup ? "Set password" : "Unlock"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
