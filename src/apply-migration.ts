import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";

interface Migration {
  version: string;
  name: string;
}

async function run(): Promise<void> {
  const accessToken = core.getInput("supabase-access-token", { required: true });
  const projectRef = core.getInput("supabase-project-ref", { required: true });
  const migrationsPath = core.getInput("migrations-path") || "supabase/migrations";

  const apiBase = `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // Fetch already-applied migrations
  core.info("Fetching applied migrations...");
  const appliedRes = await fetch(apiBase, { headers });
  if (!appliedRes.ok) {
    throw new Error(`Failed to fetch migrations: ${appliedRes.status} ${await appliedRes.text()}`);
  }

  const applied: Migration[] = await appliedRes.json();
  const appliedVersions = new Set(applied.map((m) => m.version));
  core.info(`Found ${appliedVersions.size} applied migration(s)`);

  // Find local migration files
  const fullPath = path.resolve(migrationsPath);
  if (!fs.existsSync(fullPath)) {
    core.info(`No migrations directory at ${fullPath}, skipping`);
    core.setOutput("applied-count", 0);
    return;
  }

  const files = fs
    .readdirSync(fullPath)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;

  for (const file of files) {
    const version = file.match(/^(\d+)/)?.[1];
    if (!version) {
      core.warning(`Skipping ${file}: no version prefix`);
      continue;
    }

    if (appliedVersions.has(version)) {
      core.info(`Already applied: ${file}`);
      continue;
    }

    const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
    const sql = fs.readFileSync(path.join(fullPath, file), "utf-8");

    core.info(`Applying: ${file}`);
    const res = await fetch(apiBase, {
      method: "POST",
      headers,
      body: JSON.stringify({ version, name, query: sql }),
    });

    if (!res.ok) {
      throw new Error(`Failed to apply ${file}: ${res.status} ${await res.text()}`);
    }

    core.info(`Applied: ${file}`);
    appliedCount++;
  }

  core.setOutput("applied-count", appliedCount);
  core.info(`Done. Applied ${appliedCount} new migration(s)`);
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
