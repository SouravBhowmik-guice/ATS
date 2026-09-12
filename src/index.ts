#!/usr/bin/env node

import { scrapeJobPosting, getApplicationFormUrl } from "./evaluator/job-scraper.js";
import { parseResume } from "./evaluator/resume-parser.js";
import { evaluateJobFit } from "./evaluator/scorer.js";
import { analyzeFormFields, waitForForm } from "./explorer/form-analyzer.js";
import { draftAnswers } from "./drafter/answer-generator.js";
import { WebcmdSession } from "./filler/webcmd-session.js";
import { fillForm, pauseBeforeSubmit } from "./filler/form-filler.js";
import { saveApplication, updateApplicationStatus, getApplications, getStats, initDB } from "./tracker/database.js";
import { cfg, ensureDirectories } from "./config.js";
import { existsSync } from "fs";

// ─── ASCII Art ─────────────────────────────────────────────────────────────────

const BANNER = `
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║     🚀  A P P L Y F L O W                                ║
  ║     Agentic Job Application Assistant                     ║
  ║                                                           ║
  ║     Evaluate → Explore → Draft → Pre-fill → Review        ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function printStep(step: number, total: number, title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  STEP ${step}/${total}: ${title}`);
  console.log(`${"─".repeat(60)}`);
}

function printScoreBar(score: number): string {
  const filled = "█".repeat(Math.round(score));
  const empty = "░".repeat(10 - Math.round(score));
  return `[${filled}${empty}] ${score}/10`;
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function cmdApply(jobUrl: string, resumePath?: string): Promise<void> {
  console.log(BANNER);

  const rPath = resumePath || cfg.resumePath;

  // Validate inputs
  if (!existsSync(rPath)) {
    console.error(`\n  ❌ Resume not found: ${rPath}`);
    console.error(`  💡 Create a resume at data/resumes/placeholder.txt or set RESUME_PATH in .env`);
    process.exit(1);
  }

  // Initialize tracker
  initDB();

  const session = new WebcmdSession();
  let applicationId: number | undefined;
  let closeSessionOnExit = false;

  try {
    // ── Step 1: Scrape & Evaluate ──────────────────────────────────────────
    printStep(1, 5, "EVALUATE — Scraping job posting & scoring fit");

    const job = await scrapeJobPosting(jobUrl);
    const resume = parseResume(rPath);

    console.log("\n  📊 Evaluating job-resume fit...");
    const evaluation = await evaluateJobFit(job, resume);

    console.log(`\n  ╔════════════════════════════════════════╗`);
    console.log(`  ║  Job Fit Score: ${printScoreBar(evaluation.score)}    ║`);
    console.log(`  ║  Verdict: ${evaluation.recommendation.padEnd(28)}  ║`);
    console.log(`  ╚════════════════════════════════════════╝`);

    // Save to tracker
    applicationId = saveApplication({
      jobUrl,
      company: job.company,
      title: job.title,
      score: evaluation.score,
      status: "evaluated",
      answers: [],
    });

    // Check if score is low — ask user
    if (evaluation.score < 7) {
      console.log(`\n  ⚠️  This job scores ${evaluation.score}/10 — below the 7/10 threshold.`);
      console.log(`  💡 Gaps: ${evaluation.matchGaps.join(", ")}`);
      console.log(`  ℹ️  Continuing anyway (you can stop at any time with Ctrl+C)...\n`);
    }

    // ── Step 2: Explore Form ───────────────────────────────────────────────
    printStep(2, 5, "EXPLORE — Analyzing application form structure");

    await session.launch();
    const formUrl = await getApplicationFormUrl(job);
    await session.navigate(formUrl);

    const hasForm = await waitForForm(session);
    if (!hasForm) {
      console.log("  ⚠️  No form detected. The application might require navigation.");
      console.log("  💡 Try providing the direct application URL instead.");
      return;
    }

    const formAnalysis = await analyzeFormFields(session);
    updateApplicationStatus(applicationId, "explored");

    // ── Step 3: Draft Answers ──────────────────────────────────────────────
    printStep(3, 5, "DRAFT — Generating tailored answers");

    const draftedAnswers = await draftAnswers(formAnalysis.customQuestions, job, resume);
    updateApplicationStatus(applicationId, "drafted");

    // ── Step 4: Pre-fill ───────────────────────────────────────────────────
    printStep(4, 5, "PRE-FILL — Automating form completion");

    const { filled, skipped, failed } = await fillForm(
      session,
      formAnalysis,
      resume,
      draftedAnswers,
      rPath
    );
    updateApplicationStatus(applicationId, "prefilled");

    // ── Step 5: Human-in-the-loop ──────────────────────────────────────────
    printStep(5, 5, "REVIEW — Human-in-the-loop gateway");

    await pauseBeforeSubmit(session, formAnalysis.submitButtonSelector);

    // Print summary
    console.log("\n  📋 Application Summary");
    console.log("  ──────────────────────");
    console.log(`  🏢 Company:  ${job.company}`);
    console.log(`  💼 Title:    ${job.title}`);
    console.log(`  📍 Location: ${job.location}`);
    console.log(`  📊 Score:    ${evaluation.score}/10`);
    console.log(`  📝 Filled:   ${filled} fields`);
    console.log(`  ⏭️  Skipped:  ${skipped} fields`);
    console.log(`  ❌ Failed:   ${failed} fields`);
    console.log(`  🔗 URL:      ${jobUrl}`);
    console.log("");
    console.log("  🛑 Browser is paused above the Submit button.");
    console.log("  👉  Review the pre-filled form and click Submit when ready.");
    console.log("  👉  Press Ctrl+C here to exit (browser stays open).\n");

    // Keep the process alive so the browser stays open for review.
    // Session is intentionally NOT closed — the webcmd daemon keeps it alive.
    //
    // A bare `process.on("SIGINT")` promise does NOT hold the Node event loop
    // once the main async work finishes (unlike old Playwright handles), so we
    // use a timer ref as a keep-alive and clear it on exit.
    closeSessionOnExit = false;
    await new Promise<void>((resolve) => {
      const keepAlive = setInterval(() => {}, 30_000);
      process.on("SIGINT", () => {
        clearInterval(keepAlive);
        console.log("\n  👋 ApplyFlow exiting. Session stays open for your review.\n");
        resolve();
      });
    });
  } catch (err) {
    closeSessionOnExit = true;
    console.error(`\n  ❌ Error: ${err}`);
    if (applicationId) {
      updateApplicationStatus(applicationId, "skipped");
    }
  } finally {
    if (closeSessionOnExit) {
      await session.close();
    }
  }
}

async function cmdHistory(): Promise<void> {
  console.log(BANNER);

  initDB();

  const apps = getApplications();
  const stats = getStats();

  console.log("  📊 Application Statistics");
  console.log("  ─────────────────────────");
  console.log(`  Total applications: ${stats.total}`);
  console.log(`  Average score: ${stats.avgScore.toFixed(1)}/10`);
  for (const [status, count] of Object.entries(stats.byStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  if (apps.length === 0) {
    console.log("\n  ℹ️  No applications tracked yet. Run `npm run apply` to start.\n");
    return;
  }

  console.log("\n  📋 Recent Applications");
  console.log("  ──────────────────────");

  for (const app of apps.slice(0, 10)) {
    const icon =
      app.score >= 8 ? "🟢" : app.score >= 6 ? "🟡" : app.score >= 4 ? "🟠" : "🔴";
    console.log(
      `  ${icon} ${app.company.padEnd(20)} | ${app.title.slice(0, 30).padEnd(30)} | ${app.score}/10 | ${app.status}`
    );
  }
  console.log("");
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDirectories();

  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "apply": {
      const jobUrl = args[1];
      const resumePath = args[2];

      if (!jobUrl) {
        console.error("  Usage: applyflow apply <job-url> [resume-path]");
        console.error("  Example: applyflow apply https://boards.greenhouse.io/company/jobs/12345");
        process.exit(1);
      }

      await cmdApply(jobUrl, resumePath);
      break;
    }

    case "history":
      await cmdHistory();
      break;

    case "help":
    case "--help":
    case "-h":
      console.log(BANNER);
      console.log("  Commands:");
      console.log("    apply <url> [resume-path]  — Evaluate, explore, draft, and pre-fill a job application");
      console.log("    history                    — View tracked applications and stats");
      console.log("    help                       — Show this help message");
      console.log("");
      console.log("  Examples:");
      console.log("    applyflow apply https://boards.greenhouse.io/stripe/jobs/12345");
      console.log("    applyflow apply https://jobs.lever.co/company/abc123 ./my-resume.txt");
      console.log("    applyflow history");
      console.log("");
      break;

    default:
      console.log(`  Unknown command: ${command}`);
      console.log("  Run `applyflow help` for usage information.");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  ❌ Fatal error: ${err}`);
  process.exit(1);
});
