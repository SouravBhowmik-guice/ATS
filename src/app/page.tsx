"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  KeyRound,
  Play,
  Settings2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useState } from "react";
import {
  ExecutionConsole,
  type ExecutionLog,
} from "../components/ExecutionConsole";
import { HumanVerificationModal } from "../components/HumanVerificationModal";
import { ResumeDropzone } from "../components/ResumeDropzone";

const baseLogs: ExecutionLog[] = [];
const time = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
type ReviewData = {
  jobUrl: string;
  company: string;
  title: string;
  evaluation: {
    score: number;
    recommendation: string;
    fitAnalysis: string;
    matchStrengths: string[];
    matchGaps: string[];
  };
  values: Array<{ label: string; value: string }>;
  answers: Array<{ label: string; answer: string }>;
};

export default function Home() {
  const [jobUrl, setJobUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [logs, setLogs] = useState(baseLogs);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [provider, setProvider] = useState("gemini");
  const [mockLLM, setMockLLM] = useState(false);
  const [slowMo, setSlowMo] = useState(100);

  async function startRun() {
    if (!jobUrl || !file || running) return;
    setRunning(true);
    setLogs([]);
    const payload = new FormData();
    payload.set("jobUrl", jobUrl);
    payload.set("resume", file);
    const keyInput = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement | null;
    payload.set("geminiApiKey", keyInput?.value || "");
    payload.set("anthropicApiKey", keyInput?.value || "");
    payload.set("provider", provider);
    payload.set("mockLLM", String(mockLLM));
    payload.set("slowMo", String(slowMo));
    const response = await fetch("/api/apply", {
      method: "POST",
      body: payload,
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setLogs([
        {
          id: "error",
          text: result.error || "Unable to start application run.",
          stage: "error",
          time: time(),
        },
      ]);
      setRunning(false);
      return;
    }
    const result = (await response.json()) as { streamUrl: string };
    const events = new EventSource(result.streamUrl);
    events.addEventListener("status", (event) => {
      const update = JSON.parse(event.data) as {
        status: string;
        message: string;
        progress?: { stage?: string };
        result?: {
          job?: { url?: string; company?: string; title?: string };
          evaluation?: {
            score: number;
            recommendation: string;
            fitAnalysis: string;
            matchStrengths: string[];
            matchGaps: string[];
          };
          resume?: { email?: string; github?: string; linkedin?: string };
          draftedAnswers?: Array<{ fieldLabel: string; answer: string }>;
        };
      };
      const stage =
        update.progress?.stage === "failed"
          ? "error"
          : update.progress?.stage === "review"
            ? "complete"
            : "running";
      setLogs((current) => [
        ...current,
        { id: crypto.randomUUID(), text: update.message, stage, time: time() },
      ]);
      if (update.progress?.stage === "review" && update.result) {
        setReviewData({
          jobUrl: update.result.job?.url || jobUrl,
          company: update.result.job?.company || "Detected company",
          title: update.result.job?.title || "Internship application",
          evaluation: update.result.evaluation || {
            score: 0,
            recommendation: "unknown",
            fitAnalysis: "No evaluation returned.",
            matchStrengths: [],
            matchGaps: [],
          },
          values: [
            {
              label: "Email",
              value: update.result.resume?.email || "Not found",
            },
            {
              label: "GitHub",
              value: update.result.resume?.github || "Not found",
            },
            {
              label: "LinkedIn",
              value: update.result.resume?.linkedin || "Not found",
            },
            { label: "Resume", value: file.name },
          ],
          answers: (update.result.draftedAnswers || []).map((answer) => ({
            label: answer.fieldLabel,
            answer: answer.answer,
          })),
        });
        setRunning(false);
        setShowReview(true);
        events.close();
      }
      if (update.progress?.stage === "failed") {
        setRunning(false);
        events.close();
      }
    });
  }

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-[#17211d] text-[#b8f2d0]">
            <Sparkles size={18} />
          </div>
          <span className="text-sm font-extrabold tracking-[-0.03em]">
            ATS<span className="text-[#3baa70]">-Buster</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-semibold text-[#7c8980] sm:inline">
            Human-led automation
          </span>
          <button
            onClick={() => setShowSettings((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#dbe4db] bg-white/70 px-3 py-2 text-xs font-bold hover:bg-white"
          >
            <Settings2 size={15} /> Settings
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="max-w-3xl">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#43976b]"
          >
            <span className="size-2 rounded-full bg-[#47c883]" /> Internship
            applications, minus the busywork
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-5xl font-extrabold leading-[.98] tracking-[-0.075em] text-[#17211d] sm:text-7xl"
          >
            Make the first move.
            <br />
            <span className="text-[#4aa974]">Keep the final word.</span>
          </motion.h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#6a776f]">
            ATS-Buster prepares your internship application across Greenhouse,
            Lever, and Workday, then stops so you can review every answer before
            it leaves your hands.
          </p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="rounded-3xl border border-[#dce5dc] bg-[#fbfcf8]/90 p-5 shadow-[0_18px_60px_rgba(67,93,73,0.08)] sm:p-7"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#849087]">
                  New application
                </p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">
                  Give the agent a starting point
                </h2>
              </div>
              <BriefcaseBusiness className="text-[#5aa979]" size={22} />
            </div>
            <label
              className="mb-2 block text-xs font-bold text-[#546259]"
              htmlFor="job-url"
            >
              Job posting URL
            </label>
            <div className="relative">
              <input
                id="job-url"
                value={jobUrl}
                onChange={(event) => setJobUrl(event.target.value)}
                placeholder="https://boards.greenhouse.io/company/jobs/12345"
                className="w-full rounded-xl border border-[#dce5dc] bg-white px-4 py-3.5 pr-11 text-sm outline-none transition placeholder:text-[#a0aaa2] focus:border-[#66bd8a] focus:ring-4 focus:ring-[#ccefd9]"
              />
              <ArrowUpRight
                className="absolute right-4 top-4 text-[#96a39a]"
                size={17}
              />
            </div>
            <div className="my-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#98a49b]">
              <span className="h-px flex-1 bg-[#e2e9e2]" />
              Candidate profile
              <span className="h-px flex-1 bg-[#e2e9e2]" />
            </div>
            <ResumeDropzone file={file} onFileChange={setFile} />
            <button
              disabled={!jobUrl || !file || running}
              onClick={startRun}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#17211d] px-4 py-3.5 text-sm font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-[#2a4034] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={16} fill="currentColor" />
              {running ? "Agent is working..." : "Prepare application"}
              <ChevronRight size={16} />
            </button>
          </motion.section>
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#849087]">
                  Execution monitor
                </p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">
                  A transparent run
                </h2>
              </div>
              <span className="font-mono text-[10px] text-[#8a978e]">
                4 stages
              </span>
            </div>
            <ExecutionConsole logs={logs} />
            <div className="mt-4 grid grid-cols-4 gap-2">
              {["Detect", "Extract", "Populate", "Review"].map(
                (label, index) => (
                  <div
                    key={label}
                    className={`rounded-xl border p-3 ${logs.some((log) => log.id === `${index}-run` && log.stage === "complete") ? "border-[#b8e9c9] bg-[#eaf8ee]" : "border-[#dce5dc] bg-white/50"}`}
                  >
                    <span className="font-mono text-[10px] text-[#94a198]">
                      0{index + 1}
                    </span>
                    <p className="mt-2 text-[11px] font-bold text-[#536158]">
                      {label}
                    </p>
                  </div>
                ),
              )}
            </div>
          </motion.section>
        </div>
      </section>
      {showSettings && (
        <div className="fixed right-5 top-20 z-40 w-80 rounded-2xl border border-[#dce5dc] bg-[#fbfcf8] p-5 shadow-2xl sm:right-8">
          <div className="flex items-center gap-2">
            <KeyRound size={17} className="text-[#419467]" />
            <p className="font-extrabold">Execution settings</p>
          </div>
          <label className="mt-5 block text-xs font-bold text-[#65736a]">
            Gemini API key{" "}
            <input
              type="password"
              placeholder="Stored only for this run"
              className="mt-2 w-full rounded-lg border border-[#dce5dc] bg-white px-3 py-2 text-sm outline-none focus:border-[#66bd8a]"
            />
          </label>
          <label className="mt-4 flex items-center justify-between text-xs font-bold text-[#65736a]">
            Mock LLM
            <span className="relative">
              <input
                type="checkbox"
                checked={mockLLM}
                onChange={(event) => setMockLLM(event.target.checked)}
                className="peer sr-only"
              />
              <span className="block h-6 w-11 rounded-full bg-[#cdd8cf] peer-checked:bg-[#55bd82] after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
            </span>
          </label>
          <label className="mt-4 block text-xs font-bold text-[#65736a]">
            Slow-mo delay: {slowMo}ms
            <input
              type="range"
              min="0"
              max="1000"
              step="50"
              value={slowMo}
              onChange={(event) => setSlowMo(Number(event.target.value))}
              className="mt-3 w-full accent-[#3eaa70]"
            />
          </label>
          <p className="mt-4 text-[11px] leading-5 text-[#8a968e]">
            {mockLLM
              ? "Mock mode is on for a safe local demo."
              : "Live LLM mode will send the key to your configured worker."}
          </p>
        </div>
      )}
      <HumanVerificationModal
        data={showReview ? reviewData : null}
        onClose={() => setShowReview(false)}
        onApprove={() => setShowReview(false)}
      />
    </main>
  );
}
