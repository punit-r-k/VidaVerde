import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bidiRegex = /[\u202A-\u202E\u2066-\u2069]/u;
const textFileRegex =
  /\.(?:[cm]?[jt]sx?|json|md|css|sql|ya?ml|txt|env(?:\.example)?|gitignore)$/i;

const secretRules = [
  {
    name: "private-key-material",
    regex: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/
  },
  {
    name: "aws-access-key",
    regex: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: "github-token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/
  },
  {
    name: "stripe-live-secret",
    regex: /\bsk_live_[0-9A-Za-z]{16,}\b/
  },
  {
    name: "stripe-live-restricted",
    regex: /\brk_live_[0-9A-Za-z]{16,}\b/
  },
  {
    name: "slack-token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
  }
];

const allowlistedFragments = [
  "replace-with-a-long-random-secret",
  "your-service-role-key",
  "sk_live_or_test_key",
  "pk_live_or_test_key",
  "whsec_from_stripe_endpoint",
  "https://your-project-id.supabase.co",
  "https://your-site-url"
];

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".next-dev",
  "node_modules"
]);

const collectTrackedTextFiles = (directory, relativePrefix = "") => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativePrefix, entry.name);

    if (entry.isDirectory()) {
      collected.push(...collectTrackedTextFiles(absolutePath, relativePath));
      continue;
    }

    if (textFileRegex.test(relativePath)) {
      collected.push(relativePath);
    }
  }

  return collected;
};

const trackedFiles = collectTrackedTextFiles(repoRoot);

const findings = [];

for (const relativeFile of trackedFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  const content = fs.readFileSync(absoluteFile, "utf8");
  const lines = content.split(/\r?\n/u);

  lines.forEach((line, index) => {
    if (bidiRegex.test(line)) {
      findings.push({
        file: relativeFile,
        line: index + 1,
        rule: "bidi-unicode",
        detail: "Bidirectional Unicode control character detected."
      });
    }

    for (const rule of secretRules) {
      if (!rule.regex.test(line)) continue;
      if (allowlistedFragments.some((fragment) => line.includes(fragment))) continue;

      findings.push({
        file: relativeFile,
        line: index + 1,
        rule: rule.name,
        detail: "Potential secret or credential material detected."
      });
    }
  });
}

if (findings.length > 0) {
  console.error("Repository security checks failed:");
  findings.forEach((finding) => {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.detail}`
    );
  });
  process.exit(1);
}

console.log(`Repository security checks passed for ${trackedFiles.length} tracked text files.`);
