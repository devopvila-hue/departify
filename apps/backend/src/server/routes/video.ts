import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireSession } from "./customer-zero-v2.js";
import { findOperationalGoogleIdentityForOrg } from "../../customer-zero/credential-resolver.js";
import { GoogleDriveAdapter } from "../../customer-zero/google-drive-adapter.js";
import { googleApiFetch } from "../../customer-zero/google-tokens.js";
import type { ServerDeps } from "../deps.js";

export interface VideoJob {
  id: string;
  organizationId: string;
  userId: string;
  prompt: string;
  provider: string;
  aspectRatio: string;
  duration: number;
  status: "queued" | "running" | "composing" | "uploading" | "completed" | "failed";
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  artifact?: string;
  error?: string;
}

// In-memory video jobs store (P0 - durable during app execution, zero schema changes required)
const videoJobs = new Map<string, VideoJob>();

export async function registerVideoRoutes(server: FastifyInstance, deps: ServerDeps) {
  server.post<{
    Params: { organizationId: string };
    Body: { prompt: string; aspectRatio?: string; duration?: number };
  }>(
    "/api/customer-zero/:organizationId/video/generate",
    async (request, reply) => {
      const { organizationId } = request.params;
      const { prompt, aspectRatio = "9:16", duration = 15 } = request.body;

      // 1. Validate session
      const session = await requireSession(organizationId, deps);
      const userId = request.authUser?.id ?? organizationId;

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

      // 4. Create VideoJob
      const jobId = randomUUID();
      const job: VideoJob = {
        id: jobId,
        organizationId,
        userId,
        prompt,
        provider: "openai",
        aspectRatio,
        duration,
        status: "queued",
        progress: 0,
        createdAt: new Date().toISOString(),
      };
      videoJobs.set(jobId, job);

      // 5. Dispatch async background task for Cloud Run video generation
      void (async () => {
        job.status = "running";
        job.progress = 10;
        job.startedAt = new Date().toISOString();

        try {
          // A. Trigger Cloud Run generation POST /generate
          const cloudRunUrl = "https://departify-video-889174753014.europe-west1.run.app/generate";
          job.status = "composing";
          job.progress = 40;

          const response = await fetch(cloudRunUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: job.prompt,
              aspectRatio: job.aspectRatio,
              duration: job.duration,
              openaiApiKey: credential.apiKey,
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Cloud Run failed with status ${response.status}: ${errText}`);
          }

          // B. Receive MP4 binary buffer
          job.status = "uploading";
          job.progress = 80;
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // C. Upload binary buffer to Google Drive using 2-step media upload
          const adapter = new GoogleDriveAdapter({ organizationId, userId: writeIdentity.userId });
          const accessToken = await (adapter as any).getAccessToken(GoogleDriveAdapter.WRITE_SCOPE);
          if (!accessToken) {
            throw new Error("Failed to retrieve Google Drive write access token.");
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
            throw new Error(`Google Drive metadata creation failed with status ${metaRes.status}`);
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
            throw new Error(`Google Drive media upload failed with status ${uploadRes.status}`);
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

          job.status = "completed";
          job.progress = 100;
          job.completedAt = new Date().toISOString();
          job.artifact = webViewLink;
        } catch (err: any) {
          job.status = "failed";
          job.progress = 100;
          job.error = err.message || "Unknown error during video generation";
        }
      })();

      return reply.code(201).send({
        status: "queued",
        job,
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
      const job = videoJobs.get(jobId);
      if (!job || job.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Job not found" });
      }
      return reply.code(200).send({ job });
    }
  );
}
