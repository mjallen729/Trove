import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";

export function Landing() {
  return (
    <div className="min-h-screen bg-gray-950 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-950 to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-900/20 via-transparent to-transparent" />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
        }}
      />

      {/* Header */}
      <header className="relative z-10 p-6">
        <div className="flex items-center gap-2">
          <svg
            className="w-8 h-8 text-cyan-500"
            viewBox="0 0 24 24"
            fill="currentColor">
            <path d="M12 2C9.24 2 7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2h-1V7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v3H9V7c0-1.66 1.34-3 3-3zm0 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" />
          </svg>
          <span className="text-2xl font-bold text-white">Trove</span>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex items-center justify-center min-h-[calc(100vh-120px)] px-6">
        <div className="max-w-lg w-full">
          {/* Hero card */}
          <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-800 rounded-2xl p-8 shadow-2xl">
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Take back control of your data
            </h1>
            <p className="text-gray-400 mb-8 text-lg">
              Take advantage of cloud storage without sacrificing privacy with
              anonymous, fully encrypted vaults.
            </p>

            <div className="flex flex-col gap-3">
              <Link to="/create">
                <Button variant="primary" size="lg" fullWidth>
                  Create vault
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" size="lg" fullWidth>
                  Open vault
                </Button>
              </Link>
            </div>

            {/* Features list */}
            <div className="mt-8 pt-6 border-t border-gray-800">
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-gray-400 text-sm">
                  <svg
                    className="w-5 h-5 text-cyan-500 flex-shrink-0"
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
                  Zero-knowledge encryption
                </li>
                <li className="flex items-center gap-3 text-gray-400 text-sm">
                  <svg
                    className="w-5 h-5 text-cyan-500 flex-shrink-0"
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
                  Anonymous seed-based accounts
                </li>
                <li className="flex items-center gap-3 text-gray-400 text-sm">
                  <svg
                    className="w-5 h-5 text-cyan-500 flex-shrink-0"
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
                  5GB free storage
                </li>
                <li className="flex items-center gap-3 text-gray-400 text-sm">
                  <svg
                    className="w-5 h-5 text-cyan-500 flex-shrink-0"
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
                  Automatic burn timer
                </li>
              </ul>
            </div>
          </div>

          {/* Security note */}
          <p className="text-center text-gray-600 text-xs mt-6">
            Your files are encrypted client-side. We never see your data or your
            keys.
          </p>
        </div>
      </main>
    </div>
  );
}
