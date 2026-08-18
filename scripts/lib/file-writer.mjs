// Atomic file writer: generate to temp dir, validate, then mv to apps/<name>/.
import {
  mkdir,
  writeFile,
  rename,
  rm,
  access,
  appendFile,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * Write generated files atomically to apps/<name>/.
 * Generates to a temp directory first; moves only on success.
 * @param {string} appName
 * @param {Record<string, string>} files - path -> content map
 * @param {object} registryEntry - YAML entry to append to registry/apps.yml
 * @param {object} opts
 * @param {string} [opts.root] - repo root
 * @param {boolean} [opts.dryRun] - print files without writing
 * @param {boolean} [opts.force] - delete existing app dir before writing
 */
export async function writeApp(appName, files, registryEntry, opts = {}) {
  const root = opts.root || process.cwd();
  const dest = join(root, "apps", appName);
  const registry = join(root, "registry", "apps.yml");

  // Check for collision
  if (!opts.force) {
    try {
      await access(dest);
      throw new Error(
        `apps/${appName} already exists. Use --force to overwrite.`
      );
    } catch (err) {
      if (err.message.includes("already exists")) throw err;
      // ENOENT = free, continue
    }
  } else {
    await rm(dest, { recursive: true, force: true });
  }

  if (opts.dryRun) {
    console.log(`\n--- Dry run: would write ${Object.keys(files).length} files to apps/${appName}/ ---`);
    for (const [path, content] of Object.entries(files)) {
      console.log(`  ${path} (${content.length} bytes)`);
    }
    console.log(`\n--- Registry entry ---`);
    console.log(registryEntry);
    return;
  }

  // Write to temp dir first
  const tmpBase = join(
    tmpdir(),
    `generate-app-${randomBytes(6).toString("hex")}`
  );
  await mkdir(tmpBase, { recursive: true });

  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(tmpBase, relPath);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content);
    }

    // Atomic move
    await mkdir(join(root, "apps"), { recursive: true });
    await rename(tmpBase, dest);
  } catch (err) {
    // Clean up temp dir on failure
    await rm(tmpBase, { recursive: true, force: true });
    throw err;
  }

  // Append registry entry
  await appendFile(registry, registryEntry);

  // Validate the YAML didn't get corrupted
  const registryContent = await readFile(registry, "utf8");
  try {
    const { parse } = await import("yaml");
    parse(registryContent);
  } catch (err) {
    throw new Error(
      `Registry YAML corrupted after append: ${err.message}. ` +
        `The app files are at apps/${appName}/ but the registry needs manual repair.`
    );
  }

  console.log(
    `Wrote ${Object.keys(files).length} files to apps/${appName}/ and updated registry/apps.yml`
  );
}

/**
 * Build a registry YAML entry string for a generated app.
 * @param {object} fields
 * @returns {string}
 */
export function buildRegistryEntry(fields) {
  return (
    `  - id: ${fields.name}\n` +
    `    path: ${fields.name}\n` +
    `    title: ${fields.title || fields.name}\n` +
    `    description: ${fields.description || "Generated neuroimaging webapp."}\n` +
    `    legacy_domain: null\n` +
    `    runtime: ${fields.runtime || "react-vite"}\n` +
    `    model_manifest: ${fields.modelManifest || "null"}\n` +
    `    asset_manifest_schema: ${fields.assetManifestSchema || "null"}\n` +
    `    source: neurodesk/webapps@generated\n` +
    `    license: NOASSERTION\n` +
    `    maintainers: [neurodesk]\n` +
    `    support_status: ${fields.supportStatus || "experimental"}\n` +
    `    shell: ${fields.shell || "imaging-workspace"}\n` +
    `    ci:\n` +
    `      toolchains: [node]\n` +
    `      shared_runtime: true\n` +
    `      release: false\n`
  );
}
