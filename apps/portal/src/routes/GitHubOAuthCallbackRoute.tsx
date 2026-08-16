import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "@/app/api";
import { useOrg } from "@/app/org-context";

export function GitHubOAuthCallbackRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState("Completando la conexión del proyecto…");

  useEffect(() => {
    if (!organizationId) return;
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setMessage("No se ha completado la autorización. Puedes volver a SEO e intentarlo de nuevo.");
      return;
    }
    void (async () => {
      const result = await api.finishExternalConnect(organizationId, "github_repository", code, state);
      if (result?.operational) {
        navigate("/seo", { replace: true });
        return;
      }
      setMessage(result?.error?.message ?? "No se pudo conectar el proyecto. Puedes volver a SEO e intentarlo de nuevo.");
    })();
  }, [navigate, organizationId, params]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">SEO</p>
        <h1>Conectar el proyecto de tu web</h1>
        <p className="dfy-hero__lead">{message}</p>
      </section>
    </div>
  );
}
