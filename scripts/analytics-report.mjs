import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAnalyticsReportFromRows,
  createAnalyticsReportClient,
  fetchAnalyticsRows,
  formatAnalyticsReportMarkdown,
  parseAnalyticsRange
} from "../lib/analytics/report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

const parseArgs = (argv) => {
  const config = {
    range: "30d",
    format: "md"
  };

  for (const arg of argv) {
    if (arg.startsWith("--range=")) {
      config.range = arg.slice("--range=".length);
      continue;
    }

    if (arg.startsWith("--format=")) {
      config.format = arg.slice("--format=".length);
    }
  }

  return config;
};

const printError = (message) => {
  console.error(`analytics-report: ${message}`);
};

const main = async () => {
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));

  const args = parseArgs(process.argv.slice(2));
  const range = parseAnalyticsRange(args.range);
  const format = args.format === "json" ? "json" : "md";

  const client = createAnalyticsReportClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  });

  const rows = await fetchAnalyticsRows({
    client,
    since: range.since
  });

  const report = buildAnalyticsReportFromRows(rows, {
    rangeLabel: range.label
  });

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatAnalyticsReportMarkdown(report));
};

main().catch((error) => {
  printError(error?.message || "Unable to build the analytics report.");
  process.exitCode = 1;
});
