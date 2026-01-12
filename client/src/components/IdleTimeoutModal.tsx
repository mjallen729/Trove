import { Button } from "./ui/Button";

interface IdleTimeoutModalProps {
  remainingSeconds: number;
  onStayLoggedIn: () => void;
}

export function IdleTimeoutModal({
  remainingSeconds,
  onStayLoggedIn,
}: IdleTimeoutModalProps) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  const formatTime = () => {
    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${seconds}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-scale-in text-center">
        {/* Warning icon */}
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-500/10 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-orange-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">
          Session expiring soon
        </h2>
        <p className="text-gray-400 mb-4">
          You'll be logged out in{" "}
          <span className="text-orange-400 font-mono font-bold">
            {formatTime()}
          </span>{" "}
          due to inactivity.
        </p>

        {/* Countdown progress bar */}
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-orange-500 transition-all duration-1000 ease-linear"
            style={{
              width: `${(remainingSeconds / 120) * 100}%`, // 2 minutes = 120 seconds
            }}
          />
        </div>

        <Button onClick={onStayLoggedIn} fullWidth>
          Stay logged in
        </Button>

        <p className="text-xs text-gray-500 mt-4">
          For your security, inactive sessions are automatically ended.
        </p>
      </div>
    </div>
  );
}
