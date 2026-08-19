import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireSession, workStoreForRoutes } from "./customer-zero-v2.js";
import { findOperationalGoogleIdentityForOrg } from "../../customer-zero/credential-resolver.js";
import { GoogleDriveAdapter } from "../../customer-zero/google-drive-adapter.js";
import { googleApiFetch } from "../../customer-zero/google-tokens.js";
import { type DepartmentTask } from "../../customer-zero/department-work.js";
import type { ServerDeps } from "../deps.js";

export let myWorkerId = `worker-${randomUUID().slice(0, 8)}`;
export function setMyWorkerIdForTests(id: string) {
  myWorkerId = id;
}

// Estimate video generation cost based on real BYOK usage
export const ESTIMATED_VIDEO_COST = 0.15;

export async function registerVideoRoutes(server: FastifyInstance, deps: ServerDeps) {
  server.post<{
    Params: { organizationId: string };
    Body: { prompt: string; aspectRatio?: string; duration?: number; budget?: number; idempotencyKey?: string };
  }>(
    "/api/customer-zero/:organizationId/video/generate",
    async (request, reply) => {
      const { organizationId } = request.params;
      const { prompt, aspectRatio = "9:16", duration = 15, budget = 1.00, idempotencyKey } = request.body;

      // 1. Validate session
      const session = await requireSession(organizationId, deps);
      const userId = request.authUser?.id ?? organizationId;
      const workStore = workStoreForRoutes();

      // 2. Fetch OpenAI credentials (BYOK)
      if (!deps.llmCredentials) {
        return reply.code(400).send({
          error: {
            code: "VIDEO_BYOK_MISSING",
            message: "Para crear vídeos necesitas conectar tu clave de OpenAI en Configuración."
          }
        });
      }

      const credential = await deps.llmCredentials.get(organizationId, "openai");
      if (!credential || !credential.apiKey) {
        return reply.code(400).send({
          error: {
            code: "VIDEO_BYOK_MISSING",
            message: "Para crear vídeos necesitas conectar tu clave de OpenAI en Configuración."
          }
        });
      }

      // 3. Check if Google Drive is connected
      const writeIdentity = await findOperationalGoogleIdentityForOrg(organizationId, "drive.write");
      if (!writeIdentity) {
        return reply.code(400).send({
          error: {
            code: "GOOGLE_DRIVE_MISSING",
            message: "Google Drive todavía no está conectado para escritura. Conéctalo desde Conexiones para poder crear vídeos."
          }
        });
      }

      // 4. Budget Guard Check (Budget Guard)
      if (ESTIMATED_VIDEO_COST > budget) {
        return reply.code(400).send({
          error: {
            code: "VIDEO_BUDGET_EXCEEDED",
            message: `El presupuesto de vídeo de $${budget.toFixed(2)} es insuficiente para el coste estimado de $${ESTIMATED_VIDEO_COST.toFixed(2)}.`
          }
        });
      }

      // 5. Idempotency Check (Idempotency)
      const effectiveIdempotencyKey = idempotencyKey || `video_${organizationId}_${Buffer.from(prompt).toString("base64").slice(0, 16)}`;
      const existingTasks = await workStore.listTasksForOrg(organizationId, 50);
      const existing = existingTasks.find(
        (t: DepartmentTask) =>
          t.source?.type === "video_generation" &&
          t.source.idempotencyKey === effectiveIdempotencyKey
      );

      if (existing) {
        // Reuse existing VideoJob / Task
        if (existing.status === "completed" || existing.status === "failed") {
          return reply.code(200).send({
            status: existing.status,
            job: mapTaskToJob(existing),
          });
        }
        return reply.code(201).send({
          status: "queued",
          job: mapTaskToJob(existing),
        });
      }

      // 6. Create durable DepartmentTask as the VideoJob
      const task = await workStore.createTask({
        organizationId,
        departmentId: "marketing",
        objectiveId: null,
        requestedBy: userId,
        title: "Generación de Vídeo de Marketing",
        summary: prompt,
        capability: "marketing.video.prepare",
        toolId: "departify.video.generate",
        status: "queued",
        statusMessage: "En cola para renderización...",
        progress: 0,
        requiredCapabilities: ["marketing.video.prepare", "drive.write"],
        startedAt: null,
        completedAt: null,
        resultId: null,
        errorCode: null,
        errorMessage: null,
        timeoutMs: 300_000, // 5 mins
        source: {
          type: "video_generation",
          idempotencyKey: effectiveIdempotencyKey,
          aspectRatio,
          duration,
          budget,
          estimatedCost: ESTIMATED_VIDEO_COST,
          providerOperations: [],
          artifact: null,
          driveFileId: null,
        },
      });

      // 7. Dispatch async background execution (No-background-promise as reliability guarantee)
      // The background execution runs asynchronously, but updates the durable task store on each progress step!
      // On boot or reload, incomplete tasks can be recovered or reconciled.
      void (async () => {
        await executeVideoJobReconciliation(task.id, deps);
      })();

      return reply.code(201).send({
        status: "queued",
        job: mapTaskToJob(task),
      });
    }
  );

  server.get<{
    Params: { organizationId: string; jobId: string };
  }>(
    "/api/customer-zero/:organizationId/video/jobs/:jobId",
    async (request, reply) => {
      const { organizationId, jobId } = request.params;
      await requireSession(organizationId, deps);
      const workStore = workStoreForRoutes();
      const task = await workStore.getTask(jobId);
      if (!task || task.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Job not found" });
      }
      return reply.code(200).send({ job: mapTaskToJob(task) });
    }
  );
}

// Map the persistent DepartmentTask structure to the clean VideoJob contract expected by the client
function mapTaskToJob(task: DepartmentTask) {
  const metadata = task.source?.type === "video_generation" ? task.source : null;
  return {
    id: task.id,
    organizationId: task.organizationId,
    userId: task.requestedBy,
    prompt: task.summary,
    provider: "openai",
    aspectRatio: metadata?.aspectRatio ?? "9:16",
    duration: metadata?.duration ?? 15,
    status: task.status,
    progress: Math.round(task.progress * 100),
    createdAt: task.createdAt,
    startedAt: task.startedAt || undefined,
    completedAt: task.completedAt || undefined,
    artifact: metadata?.artifact || undefined,
    error: task.errorMessage || undefined,
  };
}

// Durable Reconciliation and Execution Loop (Reconciliation & Recovery)
export async function executeVideoJobReconciliation(taskId: string, deps: ServerDeps) {
  const workStore = workStoreForRoutes();
  const task = await workStore.getTask(taskId);
  if (!task || task.status === "completed" || task.status === "failed") return;

  const now = new Date();
  const isInMemory = workStore.constructor.name !== "SupabaseDepartmentWorkStore";

  // Concurrency lease check (Gap 2)
  const leaseExpiryTime = task.source?.type === "video_generation" ? task.source.leaseExpiresAt : null;
  const isLeasedByOther =
    task.assignedEmployeeId &&
    task.assignedEmployeeId !== myWorkerId &&
    leaseExpiryTime &&
    new Date(leaseExpiryTime) > now;

  if (isLeasedByOther) {
    console.log(`[Reconciliation] Task ${taskId} is currently leased by another active worker: ${task.assignedEmployeeId}. Skipping.`);
    return;
  }

  const newLeaseExpiry = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5-minute lease

  let activeTask: DepartmentTask | null = null;
  try {
    if (isInMemory) {
      // Single-threaded JS in-memory store is naturally atomic
      const tasksMap = (workStore as any).tasks;
      const current = tasksMap.get(taskId);
      if (!current || current.status === "completed" || current.status === "failed") return;

      const curLease = current.source?.leaseExpiresAt;
      const leasedByOther =
        current.assignedEmployeeId &&
        current.assignedEmployeeId !== myWorkerId &&
        curLease &&
        new Date(curLease) > now;

      if (leasedByOther) {
        console.log(`[Reconciliation] Concurrency race: Task ${taskId} already locked by ${current.assignedEmployeeId}. Skipping.`);
        return;
      }

      activeTask = {
        ...current,
        status: "running",
        statusMessage: "Iniciando renderizador de vídeo...",
        progress: 0.1,
        startedAt: current.startedAt || now.toISOString(),
        assignedEmployeeId: myWorkerId,
        source: {
          ...current.source,
          leaseExpiresAt: newLeaseExpiry,
        } as any,
      };
      tasksMap.set(taskId, activeTask);
    } else {
      // Supabase Store: Atomic update with conditional postgres checks
      const admin = (workStore as any).admin;
      const { data, error } = await admin
        .from("department_tasks")
        .update({
          status: "running",
          status_message: "Iniciando renderizador de vídeo...",
          progress: 0.1,
          started_at: task.startedAt || now.toISOString(),
          assigned_employee_id: myWorkerId,
          source: {
            ...task.source,
            leaseExpiresAt: newLeaseExpiry,
          },
        })
        .eq("id", taskId)
        .or(`assigned_employee_id.is.null,assigned_employee_id.eq.${myWorkerId},source->>leaseExpiresAt.lt.${now.toISOString()}`)
        .select()
        .single();

      if (error || !data) {
        console.log(`[Reconciliation] Concurrency lock: Failed to claim task ${taskId} (another worker instance obtained the lease).`);
        return;
      }

      activeTask = await workStore.getTask(taskId);
    }
  } catch (err) {
    console.error(`[Reconciliation] Error claiming task ${taskId}:`, err);
    return;
  }

  if (!activeTask) return;

  const metadata = activeTask.source?.type === "video_generation" ? activeTask.source : null;
  if (!metadata) return;

  try {
    // 1. Fetch OpenAI credentials (BYOK)
    const credential = await deps.llmCredentials!.get(activeTask.organizationId, "openai");
    if (!credential || !credential.apiKey) {
      throw new Error("Clave de OpenAI no configurada o inválida.");
    }

    // 2. Fetch Google Drive credentials
    const writeIdentity = await findOperationalGoogleIdentityForOrg(activeTask.organizationId, "drive.write");
    if (!writeIdentity) {
      throw new Error("Google Drive no conectado para escritura.");
    }

    // Check if GDrive upload was already completed in a previous attempt (Drive Idempotency check!)
    if (metadata.artifact && metadata.driveFileId) {
      console.log(`Reusing existing Google Drive upload: ${metadata.artifact}`);
      await completeJobSuccessfully(activeTask, metadata.artifact, metadata.driveFileId);
      return;
    }

    // A. Trigger Cloud Run generation POST /generate
    await workStore.updateTask(taskId, {
      status: "running",
      statusMessage: "Componiendo escenas y títulos (40%)...",
      progress: 0.4,
    });

    const cloudRunUrl = "https://departify-video-889174753014.europe-west1.run.app/generate";
    const response = await fetch(cloudRunUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId: activeTask.id,
        organizationId: activeTask.organizationId,
        prompt: activeTask.summary,
        aspectRatio: metadata.aspectRatio,
        duration: metadata.duration,
        budget: metadata.budget,
        openaiApiKey: credential.apiKey,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let cleanMessage = `Error de renderizado: ${errText}`;
      if (errText.includes("VIDEO_BUDGET_EXCEEDED")) {
        cleanMessage = "Gasto de generación superaría el presupuesto del trabajo.";
      }
      throw new Error(cleanMessage);
    }

    // B. Receive MP4 binary buffer
    await workStore.updateTask(taskId, {
      status: "running",
      statusMessage: "Procesando archivo final (70%)...",
      progress: 0.7,
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // C. Upload binary buffer to Google Drive using 2-step media upload
    await workStore.updateTask(taskId, {
      status: "running",
      statusMessage: "Subiendo vídeo a tu Google Drive (85%)...",
      progress: 0.85,
    });

    const adapter = new GoogleDriveAdapter({ organizationId: activeTask.organizationId, userId: writeIdentity.userId });
    const accessToken = await (adapter as any).getAccessToken(GoogleDriveAdapter.WRITE_SCOPE);
    if (!accessToken) {
      throw new Error("No se pudo renovar el acceso de Google Drive.");
    }

    // Resolve or create a "Departify" folder
    let parentFolderId: string | undefined = undefined;
    const folderResult = await adapter.createFolder({ name: "Departify" });
    if (folderResult.success && folderResult.value?.id) {
      parentFolderId = folderResult.value.id;
    }

    // Create metadata
    const fileName = `Departify_Video_${Date.now().toString(36)}.mp4`;
    const metaRes = await googleApiFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: fileName,
        mimeType: "video/mp4",
        ...(parentFolderId ? { parents: [parentFolderId] } : {}),
      }),
    });

    if (!metaRes.ok) {
      throw new Error(`Error de Google Drive al crear metadatos de archivo: ${metaRes.status}`);
    }

    const fileMetadata = await metaRes.json() as { id: string };
    const fileId = fileMetadata.id;

    // Upload media chunk
    const uploadRes = await googleApiFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "video/mp4",
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`Error de Google Drive al subir stream de vídeo: ${uploadRes.status}`);
    }

    // Update file to get the webViewLink (using GET /drive/v3/files/{id}?fields=webViewLink)
    const fileInfoRes = await googleApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    let webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
    if (fileInfoRes.ok) {
      const fileInfo = await fileInfoRes.json() as { webViewLink?: string };
      if (fileInfo.webViewLink) webViewLink = fileInfo.webViewLink;
    }

    await completeJobSuccessfully(activeTask, webViewLink, fileId);
  } catch (err: any) {
    const cleanError = err.message || "Error desconocido en el renderizado";
    const code = cleanError.includes("VIDEO_BUDGET_EXCEEDED") ? "VIDEO_BUDGET_EXCEEDED" : "VIDEO_RENDER_FAILED";
    await workStore.updateTask(taskId, {
      status: "failed",
      statusMessage: "Error de generación de vídeo.",
      progress: 1.0,
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage: cleanError,
    });
  }
}

async function completeJobSuccessfully(task: DepartmentTask, webViewLink: string, fileId: string) {
  const workStore = workStoreForRoutes();
  const metadata = task.source?.type === "video_generation" ? task.source : null;

  // 1. Create a DepartmentResult
  const result = await workStore.createResult({
    organizationId: task.organizationId,
    departmentId: "marketing",
    relatedWorkItemId: task.id,
    title: "Vídeo de Marketing Generado",
    summary: `Tu vídeo sobre «${task.summary}» está listo en Google Drive.`,
    content: `Se ha completado la composición del vídeo con éxito.\n\n[Ver vídeo en tu Google Drive](${webViewLink})`,
    source: "departify.video.generate",
    producedByCapability: "marketing.video.prepare",
    data: {
      webViewLink,
      driveFileId: fileId,
    },
  });

  // 2. Complete the task
  await workStore.updateTask(task.id, {
    status: "completed",
    statusMessage: "Vídeo completado y subido.",
    progress: 1.0,
    completedAt: new Date().toISOString(),
    resultId: result.id,
    source: {
      ...metadata!,
      artifact: webViewLink,
      driveFileId: fileId,
    },
  });
}

// Global VideoJob recovery loop triggered automatically on server boot-up
export async function recoverAllActiveVideoJobsOnBoot(deps: ServerDeps) {
  try {
    const { workStoreForRoutes } = await import("./customer-zero-v2.js");
    const workStore = workStoreForRoutes();

    if (workStore.constructor.name === "SupabaseDepartmentWorkStore") {
      const admin = (workStore as any).admin;
      const { data, error } = await admin
        .from("department_tasks")
        .select("id")
        .eq("tool_id", "departify.video.generate")
        .in("status", ["queued", "running"]);

      if (!error && data) {
        for (const row of data) {
          void executeVideoJobReconciliation(row.id, deps);
        }
      }
    } else {
      const tasksMap = (workStore as any).tasks;
      if (tasksMap) {
        for (const task of tasksMap.values()) {
          if (
            task.toolId === "departify.video.generate" &&
            (task.status === "queued" || task.status === "running")
          ) {
            void executeVideoJobReconciliation(task.id, deps);
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to recover active video jobs on boot:", e);
  }
}
