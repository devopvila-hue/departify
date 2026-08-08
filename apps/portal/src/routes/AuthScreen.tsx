/**
 * Login / register screen — Phase P0-A.
 *
 * The only entry to Departify. Supabase Auth owns credentials; this form only
 * forwards them. After a successful login/signup the root route re-renders
 * and the CEO continues to the organization flow.
 */

import { useState, type FormEvent } from "react";

import { useAuth } from "@/app/auth-context";

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
      } else {
        const result = await signUp(email.trim(), password);
        if (result === "confirm") {
          setError(
            "Te hemos enviado un correo para confirmar tu cuenta. Revisa tu bandeja de entrada.",
          );
          setMode("login");
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No hemos podido iniciar sesión. Inténtalo de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = email.trim().length > 0 && password.length > 0;

  return (
    <main className="customer-zero" aria-labelledby="auth-title">
      <section className="customer-zero__panel">
        <p className="customer-zero__label">Departify</p>
        <h1 id="auth-title">
          {mode === "login" ? "Entra en tu empresa" : "Crea tu cuenta"}
        </h1>

        <form onSubmit={submit} className="customer-zero__form">
          <label className="customer-zero__field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="customer-zero__field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>

          {error && (
            <p className="customer-zero__state customer-zero__state--error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="customer-zero__submit"
            disabled={!canSubmit || busy}
          >
            {busy
              ? "Espera…"
              : mode === "login"
                ? "Entrar"
                : "Crear cuenta"}
          </button>
        </form>

        <button
          type="button"
          className="auth-screen__switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "¿No tienes cuenta? Regístrate"
            : "¿Ya tienes cuenta? Entra"}
        </button>
      </section>
    </main>
  );
}
