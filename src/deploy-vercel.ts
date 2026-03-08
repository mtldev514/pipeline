import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

async function run(): Promise<void> {
  const token = core.getInput("vercel-token", { required: true });
  const orgId = core.getInput("vercel-org-id", { required: true });
  const projectId = core.getInput("vercel-project-id", { required: true });
  const production = core.getBooleanInput("production");
  const workingDirectory = core.getInput("working-directory") || ".";
  const githubToken = core.getInput("github-token");

  process.env.VERCEL_ORG_ID = orgId;
  process.env.VERCEL_PROJECT_ID = projectId;

  const opts: exec.ExecOptions = { cwd: workingDirectory };
  core.info(`Deploying to Vercel (${production ? "production" : "preview"})`);

  await exec.exec("npm", ["install", "--global", "vercel@latest"], opts);

  let deployUrl = "";
  await exec.exec(
    "vercel",
    [
      "deploy",
      ...(production ? ["--prod"] : []),
      `--token=${token}`,
    ],
    {
      ...opts,
      listeners: {
        stdout: (data: Buffer) => {
          deployUrl += data.toString().trim();
        },
      },
    }
  );

  core.setOutput("url", deployUrl);
  core.info(`Deployed to: ${deployUrl}`);

  // Comment preview URL on pull requests
  if (!production && githubToken && github.context.eventName === "pull_request") {
    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;
    const issueNumber = github.context.payload.pull_request!.number;
    const body = `**Preview deployment ready**\n\n${deployUrl}`;

    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const existing = comments.find(
      (c) =>
        c.user?.type === "Bot" &&
        c.body?.includes("Preview deployment ready")
    );

    if (existing) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      });
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
    }

    core.info("Preview URL commented on PR");
  }
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
