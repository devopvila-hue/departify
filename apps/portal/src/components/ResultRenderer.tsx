/**
 * ResultRenderer — canonical contract-driven renderer for DepartmentResult.
 *
 * Every DepartmentResult carries a `data.contract` string identifying
 * the canonical structured payload it represents. The Portal dispatches
 * on that contract:
 *
 *   seo.audit.result         → <SeoDashboard />
 *   (any other / null)       → <GenericResultView />
 *
 * Identity (Marketing head badge) is derived from result.departmentId.
 * Marketing's head is shown ONLY when departmentId === "marketing".
 * No identity is fabricated for departments without a canonical head
 * (e.g. SEO has no head registered today).
 *
 * Markdown body is NEVER rendered as the primary interface when a
 * structured contract exists. Legacy/unstructured results get a clean
 * title + summary card only.
 */
import { Badge, Card } from "./primitives";
import { SeoDashboard } from "./SeoDashboard";
import type { DepartmentResult, DepartmentTask, SeoResultContract } from "@/app/api";

interface ResultRendererProps {
  result: DepartmentResult;
  taskIndex?: ReadonlyMap<string, DepartmentTask>;
}

function readSeoContract(result: DepartmentResult): SeoResultContract | null {
  const data = result.data;
  if (!data || typeof data !== "object") return null;
  const candidate = (data as { seoContract?: unknown }).seoContract;
  if (!candidate || typeof candidate !== "object") return null;
  const obj = candidate as { contract?: unknown; version?: unknown };
  if (obj.contract !== "seo.audit.result") return null;
  if (obj.version !== 1) return null;
  return candidate as SeoResultContract;
}

function resolveContract(result: DepartmentResult): string | null {
  const data = result.data;
  if (!data || typeof data !== "object") return null;
  const candidate = (data as { contract?: unknown }).contract;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

const DEPARTMENT_LABEL: Readonly<Record<string, string>> = {
  marketing: "Marketing",
  seo: "SEO",
};

function departmentLabel(departmentId: string): string {
  return DEPARTMENT_LABEL[departmentId] ?? departmentId;
}

export function ResultRenderer({ result, taskIndex }: ResultRendererProps) {
  const contract = resolveContract(result);

  if (contract === "seo.audit.result") {
    const seoContract = readSeoContract(result);
    if (seoContract) {
      // Resolve live state for the derived tasks.
      const derivedTasks =
        taskIndex && seoContract.derivedTaskIds.length > 0
          ? seoContract.derivedTaskIds
              .map((id) => taskIndex.get(id))
              .filter((t): t is DepartmentTask => Boolean(t))
          : [];
      return (
        <Card title={result.title}>
          <DepartmentBadge departmentId={result.departmentId} />
          <SeoDashboard contract={seoContract} derivedTasks={derivedTasks} />
        </Card>
      );
    }
  }

  return <GenericResultView result={result} />;
}

function GenericResultView({ result }: { result: DepartmentResult }) {
  return (
    <Card title={result.title}>
      <DepartmentBadge departmentId={result.departmentId} />
      <p className="dfy-result">{result.summary}</p>
      {/* No raw Markdown body. Unknown / missing contract. */}
    </Card>
  );
}

function DepartmentBadge({ departmentId }: { departmentId: string }) {
  if (departmentId === "marketing") {
    return (
      <Badge tone="neutral">
        Marketing · Elvira
      </Badge>
    );
  }
  if (departmentId === "seo") {
    return <Badge tone="neutral">SEO</Badge>;
  }
  return <Badge tone="neutral">{departmentLabel(departmentId)}</Badge>;
}