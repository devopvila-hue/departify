import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "@/app/api";
import { readStoredOrganizationId, useOrg } from "@/app/org-context";

function errorCopy(code: string | undefined): string {
  switch (code) {
    case "invalid_state":
    case "org_or_user_mismatch":
      return "La autorización expiró o no se pudo validar. Vuelve a Conexiones e inténtalo de nuevo.";
    case "TIKTOK_BUSINESS_NO_ADVERTISERS":
      return "La cuenta de TikTok no tiene ninguna cuenta publicitaria disponible para esta empresa.";
    case "TIKTOK_NO_PROFILE":
      return "TikTok autorizó la conexión, pero no hemos podido leer el perfil autorizado.";
    default:
      return "No hemos podido terminar la conexión con TikTok. Vuelve a Conexiones e inténtalo de nuevo.";
  }
}

export function TikTokOAuthCallbackRoute({ business = false }: { business?: boolean }) {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState("Completando la conexión…");
  const done = useRef(false);
  const toolId = business ? "tiktok_ads" : "tiktok";

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const effectiveOrgId = organizationId ?? readStoredOrganizationId();
    const code = params.get(business ? "auth_code" : "code") ?? params.get("code");
    const state = params.get("state");
    const providerError = params.get("error");
    window.history.replaceState({}, "", `/connections/${toolId}/callback`);
    if (providerError) {
      setMessage("Has cancelado la autorización de TikTok. Puedes volver a intentarlo cuando quieras.");
      return;
    }
    if (!effectiveOrgId || !code || !state) {
      setMessage("La autorización de TikTok no se completó correctamente. Vuelve a Conexiones e inténtalo de nuevo.");
      return;
    }
    void (async () => {
      const result = await api.finishExternalConnect(effectiveOrgId, toolId, code, state);
      if (result?.operational) {
        navigate(result.returnPath === "/chat" || result.returnPath === "/marketing" ? result.returnPath : "/conexiones", { replace: true });
        return;
      }
      setMessage(errorCopy(result?.error?.code));
    })();
  }, [business, navigate, organizationId, params, toolId]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero" role="alert">
        <p className="dfy-eyebrow">{business ? "TikTok Ads" : "TikTok"}</p>
        <h1>{message.startsWith("Completando") ? "Completando la conexión…" : "No se pudo conectar TikTok"}</h1>
        <p className="dfy-hero__lead">{message}</p>
      </section>
    </div>
  );
}

