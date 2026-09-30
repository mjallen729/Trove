/**
 * @module components/SettingsModal
 * @description Vault settings dialog.
 */
import { Modal } from "./ui/Modal";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      {null}
    </Modal>
  );
}
