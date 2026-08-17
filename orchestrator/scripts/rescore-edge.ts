import "../src/server/config/env";
import { getProfile } from "../src/server/services/profile";
import { scoreJobSuitability } from "../src/server/services/scorer";
import * as jobsRepo from "../src/server/repositories/jobs";
import { closeDb } from "../src/server/db/index";
import { asyncPool } from "../src/server/utils/async-pool";

const SCORING_CONCURRENCY = 2;

async function main() {
  const allJobs = await jobsRepo.getAllJobs();
  const targets = allJobs.filter(
    (j) =>
      j.status !== "applied" &&
      j.status !== "in_progress" &&
      (j.suitabilityScore === null || j.suitabilityScore === undefined),
  );
  console.log(
    `Jobs: ${allJobs.length} | to score: ${targets.length} (applied/in_progress/scored untouched)`,
  );

  const rawProfile = await getProfile();
  if (
    !rawProfile ||
    typeof rawProfile !== "object" ||
    Array.isArray(rawProfile)
  ) {
    throw new Error("Invalid resume profile format");
  }
  const profile = rawProfile as Record<string, unknown>;

  let scored = 0;
  let failed = 0;
  const failures: string[] = [];

  await asyncPool({
    items: targets,
    concurrency: SCORING_CONCURRENCY,
    task: async (job) => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const result = await scoreJobSuitability(job, profile);
          await jobsRepo.updateJob(job.id, {
            ...result.jobUpdates,
            suitabilityScore: result.score,
            suitabilityReason: result.reason,
            jobBrief: result.jobBrief,
          });
          scored++;
          console.log(
            `[ok] ${result.score} ${job.employer ?? "?"} — ${job.title ?? "?"}`,
          );
          return;
        } catch (error) {
          const message = (error as Error).message;
          failed++;
          if (attempt < 4) {
            console.error(
              `[retry ${attempt}] ${job.employer ?? "?"}: ${message.slice(0, 120)}`,
            );
            await new Promise((r) => setTimeout(r, 20000 * attempt));
          } else {
            failures.push(job.id);
            console.error(
              `[fail] ${job.employer ?? "?"} — ${job.title ?? "?"}: ${message.slice(0, 200)}`,
            );
          }
        }
      }
    },
  });

  console.log(`\nDone: ${scored} scored, ${failed} failed`);
  if (failures.length) {
    console.log("Failed ids:", failures.join(","));
  }
  closeDb();
}

main().catch((error) => {
  console.error("Fatal:", error);
  closeDb();
  process.exit(1);
});