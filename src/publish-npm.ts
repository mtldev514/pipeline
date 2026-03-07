import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";

async function getExecOutput(
  command: string,
  args: string[],
  options?: exec.ExecOptions
): Promise<string> {
  let output = "";
  await exec.exec(command, args, {
    ...options,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}

async function run(): Promise<void> {
  const npmToken = core.getInput("npm-token", { required: true });
  const version = core.getInput("version") || "auto";
  const access = core.getInput("access") || "public";
  const tag = core.getInput("tag") || "latest";
  const workingDirectory = core.getInput("working-directory") || ".";

  const cwd = path.resolve(workingDirectory);
  const opts: exec.ExecOptions = { cwd };

  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    core.setFailed(`No package.json found at ${pkgPath}`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const pkgName = pkg.name as string;
  const currentVersion = pkg.version as string;

  core.info(`Package: ${pkgName}@${currentVersion}`);

  // Set up .npmrc for authentication
  const npmrc = path.join(cwd, ".npmrc");
  const hasNpmrc = fs.existsSync(npmrc);
  fs.writeFileSync(
    npmrc,
    `//registry.npmjs.org/:_authToken=${npmToken}\n`,
    "utf-8"
  );

  try {
    if (version === "auto") {
      // Auto mode: detect if version changed vs previous commit
      let previousVersion = "0.0.0";
      try {
        previousVersion = await getExecOutput(
          "git",
          ["show", "HEAD~1:package.json"],
          { ...opts, silent: true }
        );
        previousVersion = JSON.parse(previousVersion).version;
      } catch {
        core.info("Could not read previous package.json, treating as new package");
      }

      if (currentVersion === previousVersion) {
        core.info(`Version unchanged (${currentVersion}), skipping publish`);
        core.setOutput("published", false);
        core.setOutput("version", currentVersion);
        return;
      }

      core.info(`Version changed: ${previousVersion} -> ${currentVersion}`);
    } else if (version !== "none") {
      // Bump version: patch, minor, or major
      core.info(`Bumping version: ${version}`);

      await exec.exec("git", ["config", "user.name", "GitHub Actions"], opts);
      await exec.exec(
        "git",
        ["config", "user.email", "actions@github.com"],
        opts
      );

      await exec.exec(
        "npm",
        ["version", version, "-m", "chore: release v%s", "--no-git-tag-version"],
        opts
      );

      const bumped = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const newVersion = bumped.version as string;
      core.info(`Bumped to ${newVersion}`);

      await exec.exec("git", ["add", "package.json", "package-lock.json"], opts);
      await exec.exec(
        "git",
        ["commit", "-m", `chore: release v${newVersion}`],
        opts
      );
      await exec.exec("git", ["tag", `v${newVersion}`], opts);
      await exec.exec("git", ["push", "--follow-tags"], opts);
    }

    // Publish
    const publishArgs = ["publish", `--access=${access}`, `--tag=${tag}`];
    await exec.exec("npm", publishArgs, opts);

    const finalPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const publishedVersion = finalPkg.version as string;

    core.setOutput("published", true);
    core.setOutput("version", publishedVersion);
    core.info(`Published ${pkgName}@${publishedVersion}`);

    // Write job summary
    await core.summary
      .addHeading(`Published ${pkgName}@${publishedVersion}`)
      .addRaw(`Install: \`npm install ${pkgName}@${publishedVersion}\``)
      .write();
  } finally {
    // Clean up .npmrc if we created it
    if (!hasNpmrc && fs.existsSync(npmrc)) {
      fs.unlinkSync(npmrc);
    }
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
