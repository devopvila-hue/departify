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
 * On success the CEO lands back on /conexiones.
 */
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
    if (!code || !state || !organizationId) {
      setStatus("error");
      setMessage("La autorización de Google no se completó correctamente.");
      return;
    }
    done.current = true;
    void (async () => {
      const out = await api.finishGoogleConnect(organizationId, code, state);
      if (!out?.connection || out.connection.status !== "connected") {
        setStatus("error");
        setMessage("Google no devolvió una conexión válida. Inténtalo de nuevo.");
        return;
      }
      navigate("/conexiones", { replace: true });
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
      </section>
    </div>
  );
}
