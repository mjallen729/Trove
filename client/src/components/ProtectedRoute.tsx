import { Navigate } from "react-router-dom";
import { useVault } from "../context/VaultContext";
import { Spinner } from "./ui/Spinner";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isUnlocked, isLoading } = useVault();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" />
          <p className="text-gray-400">Unlocking vault...</p>
        </div>
      </div>
    );
  }

  if (!isUnlocked) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
