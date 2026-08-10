import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "@/app/api";
import { useOrg } from "@/app/org-context";

/**
 * Google OAuth callback — Customer Zero 03.
 *
 * Google redirects the browser here after the CEO authorizes the unified
 * Google connection (`?code=...&state=...`). This route exchanges the code
 * server-side through the authenticated API callback (which validates the
 * state nonce, CSRF / replay / org+user binding and persists the tokens).
 *
 * Failure UX is intentional and business-readable:
 *   - `?error=access_denied` from Google → friendly Spanish/English copy.
 *   - missing code/state → friendly copy, no technical leakage.
 *   - API callback returns a non-connected status → friendly copy, no
 *     exposure of credentials, codes or provider payloads.
 *   - backend unreachable → friendly copy, no stack trace.
 *
 * On success the CEO lands back on /conexiones (replace: true so the
 * /connections/google/callback URL does not become a browser-history
 * entry it could re-execute on back-navigation).
 */
const GOOGLE_ERROR_COPY: Record<string, { es: string; en: string }> = {
  access_denied: {
    es: "Has cancelado la autorización. Puedes volver a intentarlo cuando quieras.",
    en: "You cancelled the authorization. You can try again whenever you want.",
  },
};

/**
 * Business-readable copy for backend callback failures. The backend
 * never exposes credentials; it surfaces a safe error `code`. Each
 * code maps to a message the CEO can act on — and auth failures get an
 * explicit re-login hint, because a stale session produces exactly the
 * "consent OK but not connected" silent loop.
 */
function backendErrorCopy(
  code: string | undefined,
): { es: string; en: string } {
  const authCodes = new Set([
    "invalid_token",
    "expired_token",
    "auth_token_invalid",
  ]);
  if (code && authCodes.has(code)) {
    return {
      es: "Tu sesión ha caducado. Cierra la sesión, entra de nuevo y repite la conexión con Google.",
      en: "Your session has expired. Sign out, sign back in, and retry the Google connection.",
    };
  }
  switch (code) {
    case "invalid_state":
    case "org_mismatch":
    case "user_mismatch":
    case "replay":
      return {
        es: "La autorización expiró o no se pudo validar. Vuelve a Conexiones e inténtalo de nuevo.",
        en: "The authorization expired or could not be validated. Go back to Connections and try again.",
      };
    case "GOOGLE_OAUTH_NOT_CONFIGURED":
    case "GOOGLE_OAUTH_CLIENT_ID":
    case "GOOGLE_OAUTH_CLIENT_SECRET":
      return {
        es: "Departify aún no tiene configuradas sus credenciales de Google. Avísanos para resolverlo.",
        en: "Departify does not have its Google credentials configured yet. Let us know so we can fix it.",
      };
    case "credential_persisted_but_not_readable":
      return {
        es: "Google autorizó la conexión pero no se pudo guardar de forma segura. Vuelve a intentarlo en unos minutos.",
        en: "Google authorized the connection but it could not be stored securely. Please try again in a few minutes.",
      };
    default:
      return {
        es: "No hemos podido terminar la conexión con Google. Inténtalo de nuevo y, si persiste, avísanos.",
        en: "We could not finish the Google connection. Try again and, if it persists, let us know.",
      };
  }
}

export function GoogleOAuthCallbackRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { organizationId } = useOrg();
  const [status, setStatus] = useState<"exchanging" | "error">("exchanging");
  const [message, setMessage] = useState("");
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const code = params.get("code");
    const state = params.get("state");
    const googleError = params.get("error");

    // Google-side failure: user cancelled consent, provider issue, etc.
    if (googleError) {
      done.current = true;
      const copy =
        GOOGLE_ERROR_COPY[googleError] ??
        {
          es: "Google no completó la autorización. Vuelve a Conexiones e inténtalo otra vez.",
          en: "Google did not complete the authorization. Go back to Connections and try again.",
        };
      setStatus("error");
      setMessage(navigator.language.startsWith("es") ? copy.es : copy.en);
      return;
    }

    if (!code || !state || !organizationId) {
      done.current = true;
      setStatus("error");
      setMessage(
        navigator.language.startsWith("es")
          ? "La autorización de Google no se completó correctamente."
          : "The Google authorization was not completed correctly.",
      );
      return;
    }
    done.current = true;
    void (async () => {
      const out = await api.finishGoogleConnect(organizationId, code, state);
      // Finish Google connect never returns raw credentials. We surface a
      // business message based on a non-technical state: connection !=
      // connected → connection failed; null → backend unreachable.
      if (!out) {
        setStatus("error");
        setMessage(
          navigator.language.startsWith("es")
            ? "No hemos podido contactar con Departify. Vuelve a intentarlo en unos minutos."
            : "We could not reach Departify. Please try again in a few minutes.",
        );
        return;
      }
      if (out.connection?.status === "connected") {
        // Success — land on /conexiones (replace: true so the callback
        // URL does not become a browser-history entry that re-executes
        // on back-navigation).
        navigate("/conexiones", { replace: true });
        return;
      }
      // Failure — show the exact safe stage that failed, never a bare
      // "no conectado" with no explanation.
      const copy = backendErrorCopy(out.error?.code);
      const isEs = navigator.language.startsWith("es");
      setStatus("error");
      setMessage(isEs ? copy.es : copy.en);
    })();
  }, [params, organizationId, navigate]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Google</p>
        <h1>
          {status === "exchanging" ? "Completando la conexión…" : "No se pudo conectar Google"}
        </h1>
        <p className="dfy-hero__lead">
          {status === "exchanging"
            ? "Departify está completando la autorización. Vuelves a Conexiones en unos segundos."
            : message}
        </p>
        {status === "error" && (
          <div className="dfy-hero__actions">
            <a href="/conexiones" className="dfy-button">
              {navigator.language.startsWith("es")
                ? "Volver a Conexiones"
                : "Back to Connections"}
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
