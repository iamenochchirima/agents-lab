import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(webRoot, "../..");
const outputPath = path.join(webRoot, "src/generated/document-catalog.ts");
const contentOutputPath = path.join(webRoot, "src/generated/document-content.ts");
const navigationPath = path.join(repositoryRoot, "docs/navigation.json");

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  ".vite",
  "coverage",
  ".pytest_cache",
  "__pycache__",
]);

const excludedFiles = new Set([
  "apps/web/src/generated/document-catalog.ts",
  "apps/web/src/generated/document-content.ts",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") {
      continue;
    }

    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walk(absolutePath)));
    } else if (entry.isFile()) {
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
      if (!excludedFiles.has(relativePath)) {
        paths.push(relativePath);
      }
    }
  }

  return paths;
}

function titleFromMarkdown(content, fallback) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

function excerptFromMarkdown(content) {
  const lines = content.split(/\r?\n/);
  const paragraph = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---" || trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith("- ")) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    paragraph.push(trimmed);
  }

  return paragraph.join(" ").slice(0, 180);
}

function sectionForPath(relativePath) {
  const [first, second] = relativePath.split("/");
  if (!second) return "Project";
  if (first === "docs") return second ? `Docs / ${second}` : "Docs";
  if (first === "apps") return `Apps / ${second}`;
  if (first === "src") return "Source";
  if (first === "tests") return "Tests";
  if (first === "platforms") return "Platforms";
  if (first === "environments") return "Environments";
  if (first === "scenarios") return "Scenarios";
  if (first === "experiments") return "Experiments";
  if (first === "infra") return "Infrastructure";
  return first[0].toUpperCase() + first.slice(1);
}

function isDocumentPath(relativePath) {
  return relativePath.endsWith(".md");
}

function isPlaceholder(content) {
  return /\bplaceholder\b/i.test(content);
}

async function readDirectoryDescription(directory) {
  try {
    const readme = await readFile(path.join(directory, "README.md"), "utf8");
    return excerptFromMarkdown(readme);
  } catch {
    return "";
  }
}

async function buildTree(relativePaths) {
  const root = {
    name: path.basename(repositoryRoot),
    path: ".",
    kind: "directory",
    description: await readDirectoryDescription(repositoryRoot),
    children: [],
  };

  for (const relativePath of relativePaths) {
    const parts = relativePath.split("/");
    let children = root.children;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = children.find((candidate) => candidate.name === part);

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          kind: isFile ? "file" : "directory",
          description: isFile ? "" : await readDirectoryDescription(path.join(repositoryRoot, currentPath)),
          children: [],
        };
        children.push(node);
      }

      children = node.children;
    }
  }

  const sortTree = (nodes) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach((node) => sortTree(node.children));
  };

  sortTree(root.children);
  return [root];
}

const relativePaths = (await walk(repositoryRoot)).sort();
const documentPaths = relativePaths.filter(isDocumentPath);
const documentEntries = await Promise.all(
  documentPaths.map(async (relativePath) => {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const content = await readFile(absolutePath, "utf8");
    return {
      id: relativePath,
      path: relativePath,
      title: titleFromMarkdown(content, relativePath),
      section: sectionForPath(relativePath),
      excerpt: excerptFromMarkdown(content),
      placeholder: isPlaceholder(content),
      content,
    };
  }),
);

const navigation = JSON.parse(await readFile(navigationPath, "utf8"));
const entriesById = new Map(documentEntries.map((entry) => [entry.id, entry]));
const includedDocumentIds = new Set();
const curatedEntries = [];

for (const section of navigation.sections) {
  for (const id of section.documents) {
    if (includedDocumentIds.has(id)) {
      throw new Error(`Documentation navigation includes "${id}" more than once.`);
    }
    const entry = entriesById.get(id);
    if (!entry) {
      throw new Error(`Documentation navigation references missing document "${id}".`);
    }
    includedDocumentIds.add(id);
    curatedEntries.push({ ...entry, section: section.title });
  }
}

const documents = curatedEntries.map(({ content, ...document }) => document);
const documentContent = Object.fromEntries(
  curatedEntries.map(({ id, content }) => [id, content]),
);

const repositoryTree = await buildTree(relativePaths);
await mkdir(path.dirname(outputPath), { recursive: true });

const output = `// Generated by apps/web/scripts/generate-doc-catalog.mjs. Do not edit.\n\nexport interface DocumentRecord {\n  id: string;\n  path: string;\n  title: string;\n  section: string;\n  excerpt: string;\n  placeholder: boolean;\n}\n\nexport interface RepositoryNode {\n  name: string;\n  path: string;\n  kind: \"directory\" | \"file\";\n  description: string;\n  children: RepositoryNode[];\n}\n\nexport const documents: DocumentRecord[] = ${JSON.stringify(documents, null, 2)};\n\nexport const repositoryTree: RepositoryNode[] = ${JSON.stringify(repositoryTree, null, 2)};\n`;

const contentOutput = `// Generated by apps/web/scripts/generate-doc-catalog.mjs. Do not edit.\n\nexport const documentContent: Record<string, string> = ${JSON.stringify(documentContent, null, 2)};\n`;

await writeFile(outputPath, output, "utf8");
await writeFile(contentOutputPath, contentOutput, "utf8");
console.log(`Generated ${documents.length} documents and a repository tree at ${path.relative(repositoryRoot, outputPath)}.`);
