import fs from "fs";

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const API = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404 && res.status !== 422) {
    throw new Error(
      `${method} ${path} failed: ${res.status} ${await res.text()}`
    );
  }
  if (res.status === 204) return null;
  return { status: res.status, data: await res.json() };
}

function parseTodoMd(content) {
  const lines = content.split("\n");
  const items = [];
  let currentLabel = null;
  let currentItem = null;

  for (const line of lines) {
    const headerMatch = line.match(/^## (.+)$/);
    if (headerMatch) {
      currentLabel = headerMatch[1].trim().toLowerCase();
      currentItem = null;
      continue;
    }

    if (!currentLabel) continue;

    const openMatch = line.match(/^- \[ \] (.+)$/);
    if (openMatch) {
      currentItem = {
        title: openMatch[1].trim(),
        body: "",
        label: currentLabel,
      };
      items.push(currentItem);
      continue;
    }

    if (line.match(/^- \[\.\] /)) {
      currentItem = null;
      continue;
    }

    if (line.match(/^- /)) {
      currentItem = null;
      continue;
    }

    if (
      currentItem &&
      (line.startsWith("  ") || line.startsWith("```") || line === "")
    ) {
      currentItem.body += line + "\n";
    }
  }

  for (const item of items) {
    item.body = item.body.trimEnd();
  }

  return items;
}

async function ensureLabel(name) {
  const res = await api(
    "GET",
    `/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`
  );
  if (res && res.status === 404) {
    await api("POST", `/repos/${owner}/${repo}/labels`, {
      name,
      color: "ededed",
    });
    console.log(`Created label: ${name}`);
  }
}

async function getAllIssues() {
  const issues = [];
  let page = 1;
  while (true) {
    const res = await api(
      "GET",
      `/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`
    );
    if (!res || res.data.length === 0) break;
    issues.push(...res.data.filter((i) => !i.pull_request));
    page++;
  }
  return issues;
}

async function run() {
  const content = fs.readFileSync("todo.md", "utf-8");
  const todoItems = parseTodoMd(content);
  console.log(`Parsed ${todoItems.length} open todo items`);

  const existingIssues = await getAllIssues();

  const labels = [...new Set(todoItems.map((i) => i.label))];
  for (const label of labels) {
    await ensureLabel(label);
  }

  const todoTitles = new Set(todoItems.map((i) => i.title));

  for (const item of todoItems) {
    const existing = existingIssues.find((i) => i.title === item.title);
    if (existing) {
      if (existing.state === "closed") {
        await api(
          "PATCH",
          `/repos/${owner}/${repo}/issues/${existing.number}`,
          { state: "open" }
        );
        console.log(`Reopened issue #${existing.number}: ${item.title}`);
      }
      continue;
    }
    const res = await api("POST", `/repos/${owner}/${repo}/issues`, {
      title: item.title,
      body: item.body || undefined,
      labels: [item.label],
    });
    console.log(`Created issue #${res.data.number}: ${item.title}`);
  }

  const openIssues = existingIssues.filter((i) => i.state === "open");
  for (const issue of openIssues) {
    const issueLabels = issue.labels.map((l) =>
      typeof l === "string" ? l : l.name
    );
    const isManagedByUs = issueLabels.some((l) => labels.includes(l));
    if (isManagedByUs && !todoTitles.has(issue.title)) {
      await api("PATCH", `/repos/${owner}/${repo}/issues/${issue.number}`, {
        state: "closed",
        state_reason: "completed",
      });
      console.log(`Closed issue #${issue.number}: ${issue.title}`);
    }
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
