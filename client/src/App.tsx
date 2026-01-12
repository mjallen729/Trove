import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { VaultProvider } from "./context/VaultContext";
import { ToastProvider } from "./context/ToastContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Create } from "./pages/Create";
import { Vault } from "./pages/Vault";

function App() {
  return (
    <BrowserRouter>
      <VaultProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/create" element={<Create />} />
            <Route
              path="/vault"
              element={
                <ProtectedRoute>
                  <Vault />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </VaultProvider>
    </BrowserRouter>
  );
}

export default App;
