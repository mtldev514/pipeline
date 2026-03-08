import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";

async function run(): Promise<void> {
  const accessToken = core.getInput("supabase-access-token", { required: true });
  const projectRef = core.getInput("supabase-project-ref", { required: true });
  const migrationsPath = core.getInput("migrations-path") || "supabase/migrations";

  const queryUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  async function executeSQL(query: string): Promise<unknown[]> {
    const res = await fetch(queryUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      throw new Error(`SQL execution failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  // Read applied versions directly from schema_migrations so we see versions
  // we recorded ourselves (not auto-generated timestamps from the Migrations API).
  core.info("Fetching applied migrations...");
  let appliedVersions: Set<string>;
  try {
    const rows = await executeSQL(
      "SELECT version FROM supabase_migrations.schema_migrations"
    ) as Array<{ version: string }>;
    appliedVersions = new Set(rows.map((r) => r.version));
    core.info(`Found ${appliedVersions.size} applied migration(s)`);
  } catch {
    core.info("Could not read schema_migrations — assuming fresh database");
    appliedVersions = new Set();
  }

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

    // Run the migration SQL via the query endpoint (not the migrations endpoint,
    // which auto-generates timestamp-based versions we cannot control).
    await executeSQL(sql);

    // Record the version in schema_migrations using filename-prefix as the key.
    const v = version.replace(/'/g, "''");
    const n = name.replace(/'/g, "''");
    await executeSQL(
      `INSERT INTO supabase_migrations.schema_migrations(version, name) ` +
      `VALUES ('${v}', '${n}') ON CONFLICT (version) DO NOTHING`
    );

    core.info(`Applied: ${file}`);
    appliedCount++;
  }

  core.setOutput("applied-count", appliedCount);
  core.info(`Done. Applied ${appliedCount} new migration(s)`);
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
