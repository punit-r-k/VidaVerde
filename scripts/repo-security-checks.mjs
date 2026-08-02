import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bidiRegex = /[\u202A-\u202E\u2066-\u2069]/u;
const textFileRegex =
  /(?:^|\/)(?:\.env(?:\.example)?|\.gitignore)$|\.(?:[cm]?[jt]sx?|gs|json|md|css|sql|ya?ml|txt)$/i;

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
    name: "stripe-secret",
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/
  },
  {
    name: "stripe-webhook-secret",
    regex: /\bwhsec_[0-9A-Za-z]{16,}\b/
  },
  {
    name: "easypost-api-key",
    regex: /\bEZA[KT][A-Za-z0-9_]{16,}\b/
  },
  {
    name: "google-api-key",
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/
  },
  {
    name: "jwt-token",
    regex: /\beyJ[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\b/
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
  "EZTK_your_test_key",
  "https://your-project-id.supabase.co",
  "https://your-site-url"
];

const scannedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repoRoot,
    encoding: "utf8"
  }
)
  .split("\0")
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => textFileRegex.test(file.replaceAll("\\", "/")))
  .filter((file) => fs.existsSync(path.join(repoRoot, file)));

const findings = [];

for (const relativeFile of scannedFiles) {
  const normalizedPath = relativeFile.replaceAll("\\", "/");
  const basename = path.posix.basename(normalizedPath).toLowerCase();
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
    findings.push({
      file: relativeFile,
      line: 1,
      rule: "tracked-environment-file",
      detail: "Environment files containing deploy-time credentials must not be committed."
    });
  }

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

console.log(
  `Repository security checks passed for ${scannedFiles.length} tracked and untracked text files.`
);
