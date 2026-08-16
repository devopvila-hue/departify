import { useState, type FormEvent, type ReactNode } from "react";

import type { CredentialFieldDefinition, CredentialHelpDefinition } from "@/app/api";

const TRUSTED_EXTERNAL_HOSTS = new Set([
  "developer.wordpress.org",
  "shopify.dev",
  "help.shopify.com",
]);

/** Only build-time/provider-registry links may leave the portal. */
export function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_EXTERNAL_HOSTS.has(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export interface CredentialSetupGuideProps {
  providerName: string;
  logo?: ReactNode;
  help: CredentialHelpDefinition;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

export function CredentialSetupGuide(props: CredentialSetupGuideProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const actionUrl = safeExternalUrl(props.help.actionUrl);
  const docsUrl = safeExternalUrl(props.help.docsUrl);

  function updateField(field: CredentialFieldDefinition, value: string) {
    setValues((current) => ({ ...current, [field.id]: value }));
  }

  function toggleSecret(fieldId: string) {
    setVisibleSecrets((current) => {
      const next = new Set(current);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void props.onSubmit(values);
  }

  return (
    <div className="dfy-overlay dfy-overlay--front" role="presentation">
      <section className="dfy-dialog dfy-manage-dialog dfy-credential-guide" role="dialog" aria-modal="true" aria-labelledby="credential-guide-title">
        <div className="dfy-dialog__header">
          <div className="dfy-dialog__identity">
            {props.logo}
            <div>
              <h2 id="credential-guide-title">Conectar {props.providerName}</h2>
              <p>Los datos se guardan de forma segura y se comprueban antes de activar la conexión.</p>
            </div>
          </div>
          <button type="button" className="dfy-icon-button" aria-label="Cerrar configuración" onClick={props.onClose}>×</button>
        </div>

        <div className="dfy-credential-guide__instructions">
          <h3>Qué necesitas</h3>
          <p>{props.help.whatYouNeed}</p>
          <h3>Cómo conseguirlo</h3>
          <ol>
            {props.help.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {(actionUrl || docsUrl) && (
            <div className="dfy-credential-guide__links">
              {actionUrl && <a href={actionUrl} target="_blank" rel="noopener noreferrer">{props.help.actionLabel}</a>}
              {docsUrl && docsUrl !== actionUrl && <a href={docsUrl} target="_blank" rel="noopener noreferrer">Ver guía oficial ↗</a>}
            </div>
          )}
          {props.help.note && <p className="dfy-dialog__hint">{props.help.note}</p>}
        </div>

        <form onSubmit={submit}>
          <div className="dfy-credential-guide__fields">
            {props.help.fields.map((field) => {
              const secret = field.secret || field.type === "password";
              const visible = visibleSecrets.has(field.id);
              return (
                <label className="dfy-search-field" key={field.id}>
                  <span>{field.label}</span>
                  <span className="dfy-credential-guide__input-wrap">
                    <input
                      type={secret && !visible ? "password" : field.type === "url" ? "url" : "text"}
                      value={values[field.id] ?? ""}
                      placeholder={field.placeholder}
                      autoComplete={secret ? "new-password" : "off"}
                      onChange={(event) => updateField(field, event.target.value)}
                    />
                    {secret && (
                      <button type="button" className="dfy-button dfy-button--ghost dfy-credential-guide__toggle" onClick={() => toggleSecret(field.id)}>
                        {visible ? "Ocultar" : "Mostrar"}
                      </button>
                    )}
                  </span>
                  {field.helpText && <small>{field.helpText}</small>}
                </label>
              );
            })}
          </div>
          {props.error && <p className="dfy-connections-notice" role="alert">{props.error}</p>}
          <div className="dfy-dialog__actions">
            <button type="button" className="dfy-button dfy-button--ghost" onClick={props.onClose}>Cancelar</button>
            <button type="submit" className="dfy-button" disabled={props.busy}>
              {props.busy ? "Verificando…" : "Conectar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
