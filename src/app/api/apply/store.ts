export type ApplyStatus = "queued" | "dispatched" | "worker_unconfigured" | "running" | "review" | "failed";

export interface ApplyJob {
  id: string;
  status: ApplyStatus;
  createdAt: string;
  message: string;
  progress?: unknown;
  result?: unknown;
}

export const jobs = new Map<string, ApplyJob>();
