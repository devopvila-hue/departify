import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The current company (organization) the CEO is running. Persisted in
 * localStorage so a reload returns to the same company.
 */
const STORAGE_KEY = "departify_customer_zero";

interface OrgContextValue {
  organizationId: string | null;
  setOrganizationId: (organizationId: string | null) => void;
}

const OrgContext = createContext<OrgContextValue>({
  organizationId: null,
  setOrganizationId: () => {},
});

function readStored(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { organizationId?: string };
    return parsed.organizationId ?? null;
  } catch {
    return null;
  }
}

/**
 * The stored organization id is a NAVIGATION preference, not authorization.
 * Backend membership is the authoritative check.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function readStoredOrganizationId(): string | null {
  return readStored();
}

export function OrgProvider(props: { children: ReactNode }) {
  const [organizationId, setValue] = useState<string | null>(() => readStored());

  const setOrganizationId = useCallback((next: string | null) => {
    setValue(next);
    try {
      if (next) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ organizationId: next }),
        );
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const value = useMemo(
    () => ({ organizationId, setOrganizationId }),
    [organizationId, setOrganizationId],
  );

  return <OrgContext.Provider value={value}>{props.children}</OrgContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}
