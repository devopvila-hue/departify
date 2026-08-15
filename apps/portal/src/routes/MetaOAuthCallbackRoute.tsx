import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api, readGoogleOAuthReturnPath } from "@/app/api";
import { readStoredOrganizationId, useOrg } from "@/app/org-context";

function metaErrorCopy(code: string | undefined): string {
  switch (code) {
    case "invalid_state":
    case "org_or_user_mismatch":
      return "La autorización expiró o no se pudo validar. Vuelve a Conexiones e inténtalo de nuevo.";
    case "META_BUSINESS_NO_SOCIAL_ASSETS":
      return "La cuenta de Meta no tiene ninguna página de Facebook o cuenta de Instagram profesional disponible para esta empresa.";
    default:
      return "No hemos podido terminar la conexión con Facebook e Instagram. Vuelve a Conexiones e inténtalo de nuevo.";
  }
}

export function MetaOAuthCallbackRoute() {
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
    const providerError = params.get("error");
    const effectiveOrgId = organizationId ?? readStoredOrganizationId();
    done.current = true;
    window.history.replaceState({}, "", "/connections/meta_business/callback");

    if (providerError) {
      setStatus("error");
      setMessage("Has cancelado la autorización de Meta. Puedes volver a intentarlo cuando quieras.");
      return;
    }
    if (!code || !state || !effectiveOrgId) {
      setStatus("error");
      setMessage("La autorización de Meta no se completó correctamente. Vuelve a Conexiones e inténtalo de nuevo.");
      return;
    }

    void (async () => {
      const out = await api.finishMetaConnect(effectiveOrgId, code, state);
      if (out?.connection?.status === "connected") {
        const returnPath = out.returnPath === "/" || out.returnPath === "/conexiones" || out.returnPath === "/chat"
          ? out.returnPath
          : readGoogleOAuthReturnPath();
        navigate(returnPath, { replace: true });
        return;
      }
      setStatus("error");
      setMessage(metaErrorCopy(out?.error?.code));
    })();
  }, [navigate, organizationId, params]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero" role={status === "error" ? "alert" : undefined}>
        <p className="dfy-eyebrow">Facebook e Instagram</p>
        <h1>{status === "exchanging" ? "Completando la conexión…" : "No se pudo conectar Meta"}</h1>
        <p className="dfy-hero__lead">
          {status === "exchanging"
            ? "Departify está verificando las páginas y cuentas sociales disponibles. Vuelves a Conexiones en unos segundos."
            : message}
        </p>
        {status === "error" && (
          <div className="dfy-hero__actions">
            <button type="button" className="dfy-button" onClick={() => navigate("/conexiones", { replace: true })}>
              Volver a Conexiones
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
