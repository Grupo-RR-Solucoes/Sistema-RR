import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadEnv(envPath) {
  const raw = await fs.readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  const repoRoot = path.resolve(process.cwd());
  await loadEnv(path.join(repoRoot, ".env.local"));

  const args = process.argv.slice(2);
  const body = {};

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--execute") {
      body.execute = true;
      continue;
    }
    if (token === "--cnpj") {
      body.cnpjs = body.cnpjs || [];
      body.cnpjs.push(String(args[i + 1] || ""));
      i += 1;
      continue;
    }
    if (token === "--yearFrom") {
      body.yearFrom = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--monthFrom") {
      body.monthFrom = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--yearTo") {
      body.yearTo = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--monthTo") {
      body.monthTo = Number(args[i + 1]);
      i += 1;
      continue;
    }
  }

  if (body.execute !== true) {
    body.execute = false;
  }

  const routePath = path.join(
    repoRoot,
    ".next",
    "server",
    "app",
    "api",
    "import",
    "closing-history",
    "route.js"
  );

  const mod = await import(pathToFileURL(routePath).href);
  const postHandler =
    mod.POST || mod.default?.routeModule?.userland?.POST || mod.default?.POST;

  if (typeof postHandler !== "function") {
    throw new Error("Nao foi possivel localizar o handler POST compilado.");
  }
  const req = new Request("http://localhost/api/import/closing-history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const res = await postHandler(req);
  const text = await res.text();
  process.stdout.write(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
