import { randomUUID } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { NextRequest, NextResponse } from "next/server";
import { jobs, type ApplyJob } from "./store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const supportedHosts = [
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "icims.com",
  "taleo.net",
];

function validateJobUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid job posting URL.");
  }

  if (
    url.protocol !== "https:" ||
    !supportedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new Error(
      "Use a Greenhouse, Lever, Workday, iCIMS, or Taleo job URL.",
    );
  }
  return url;
}

async function parseResume(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string> {
  if (contentType === "text/plain" || filename.toLowerCase().endsWith(".txt")) {
    return new TextDecoder().decode(bytes).trim();
  }
  // PDF.js may transfer/detach the input buffer. Parse an isolated copy so the
  // original bytes remain available for the worker payload below.
  const document = await getDocumentProxy(bytes.slice());
  const result = await extractText(document, { mergePages: true });
  return result.text.trim();
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const rawUrl = String(form.get("jobUrl") || "");
    const resume = form.get("resume");
    const apiKey = String(form.get("geminiApiKey") || "").trim();
    const anthropicApiKey = String(form.get("anthropicApiKey") || "").trim();
    const provider = String(
      form.get("provider") || process.env.LLM_PROVIDER || "gemini",
    ).toLowerCase();
    const mockLLM = String(form.get("mockLLM") || "true") === "true";
    const slowMo = Number(form.get("slowMo") || 100);

    const jobUrl = validateJobUrl(rawUrl).toString();
    if (!(resume instanceof File))
      throw new Error("Attach a PDF resume before starting.");
    const isPdf =
      resume.type === "application/pdf" ||
      resume.name.toLowerCase().endsWith(".pdf");
    const isText =
      resume.type === "text/plain" ||
      resume.name.toLowerCase().endsWith(".txt");
    if (!isPdf && !isText)
      throw new Error(
        "Resume must be a PDF, or a TXT file for the local demo.",
      );
    if (resume.size > MAX_RESUME_BYTES)
      throw new Error("Resume must be 10 MB or smaller.");
    const hasServerGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== "your-gemini-key-here",
    );
    const hasServerAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const workerUrl = process.env.WORKER_URL;
    const workerHandlesLLM = Boolean(workerUrl);
    if (
      !mockLLM &&
      provider === "gemini" &&
      !apiKey &&
      !hasServerGeminiKey &&
      !workerHandlesLLM
    )
      throw new Error(
        "Add a Gemini API key or configure GEMINI_API_KEY on the server, or configure WORKER_URL.",
      );
    if (
      !mockLLM &&
      provider === "anthropic" &&
      !anthropicApiKey &&
      !hasServerAnthropicKey &&
      !workerHandlesLLM
    )
      throw new Error(
        "Add a Claude API key or configure ANTHROPIC_API_KEY on the server.",
      );
    if (!Number.isFinite(slowMo) || slowMo < 0 || slowMo > 5000)
      throw new Error("Slow-mo must be between 0 and 5000 milliseconds.");

    const bytes = new Uint8Array(await resume.arrayBuffer());
    const resumeText = await parseResume(bytes, resume.name, resume.type);
    if (!resumeText)
      throw new Error("We could not extract readable text from that PDF.");

    const id = randomUUID();
    const job: ApplyJob = {
      id,
      status: "queued",
      createdAt: new Date().toISOString(),
      message: "Payload validated and queued.",
    };
    jobs.set(id, job);

    if (workerUrl) {
      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.WORKER_SHARED_SECRET
            ? { authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}` }
            : {}),
        },
        body: JSON.stringify({
          id,
          jobUrl,
          resume: {
            filename: resume.name,
            contentType: resume.type,
            base64: Buffer.from(bytes).toString("base64"),
            text: resumeText,
          },
          settings: {
            provider,
            apiKey: apiKey || undefined,
            anthropicApiKey: anthropicApiKey || undefined,
            mockLLM,
            slowMo,
          },
        }),
      });
      if (!workerResponse.ok)
        throw new Error(`Worker rejected the job (${workerResponse.status}).`);
      job.status = "dispatched";
      job.message = "Worker accepted the application run.";
    } else {
      job.status = "worker_unconfigured";
      job.message =
        "No WORKER_URL is configured. Configure the browser worker before live runs.";
    }

    return NextResponse.json(
      {
        jobId: id,
        status: job.status,
        message: job.message,
        resumePreview: resumeText.slice(0, 280),
        streamUrl: `/api/apply?jobId=${id}`,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start application run.",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId)
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  if (!jobs.has(jobId))
    return NextResponse.json(
      { error: "Application run not found." },
      { status: 404 },
    );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastPayload = "";
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // The client may have closed the stream first.
        }
      };
      const send = () => {
        const job = jobs.get(jobId);
        if (!job) return;
        const payload = JSON.stringify(job);
        if (closed || payload === lastPayload) return;
        lastPayload = payload;
        try {
          controller.enqueue(
            encoder.encode(`event: status\ndata: ${payload}\n\n`),
          );
        } catch {
          close();
        }
      };
      send();
      heartbeat = setInterval(() => {
        send();
        if (jobs.get(jobId)?.status === "failed") {
          close();
        }
      }, 1000);
      timeout = setTimeout(() => {
        close();
      }, 25_000);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}
