/**
 * Policy document serving API
 *
 * Serves policy source files from configured folders.
 * Supports both institution policy folders and teams files.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import {
  ALL_POLICY_FOLDERS as SHARED_POLICY_FOLDERS,
  TEAMS_STANDARD_DOCS_SOURCE_COLLECTION,
} from "@rad-assist/shared";

const INSTITUTION_FOLDER_ALIASES = {
  INSTITUTION_A: ["institution-a-policies"],
  INSTITUTION_B: ["institution-b-policies"],
  TEAMS: ["teams_standard_docs", TEAMS_STANDARD_DOCS_SOURCE_COLLECTION],
} as const;

const LEGACY_POLICY_FOLDERS = [] as const;
const ALL_POLICY_FOLDERS = [
  ...new Set([...SHARED_POLICY_FOLDERS, ...LEGACY_POLICY_FOLDERS]),
];
const SUPPORTED_FILE_EXTENSIONS = [".pdf", ".docx", ".pptx", ".txt", ".md"] as const;

// Security: Block directory traversal attempts
const FORBIDDEN_PATTERNS = [
  /\.\./, // Parent directory
  /\.\//, // Current directory explicit
  /%2e/i, // URL-encoded dots
  /%2f/i, // URL-encoded slashes
  /\\/, // Backslashes
  /^\/|^\\/, // Absolute paths
];

function isSafePath(filename: string): boolean {
  return !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(filename));
}

function normalizeFilenameIdentity(filename: string): string {
  const nameWithoutExt = path.parse(filename).name;
  return nameWithoutExt
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFilenameMatch(candidateName: string, requestedFilename: string): boolean {
  const normalizedCandidate = candidateName.toLowerCase();
  const normalizedRequested = requestedFilename.toLowerCase();
  const requestExt = path.extname(normalizedRequested);

  if (requestExt.length > 0) {
    const candidateExt = path.extname(normalizedCandidate);
    if (candidateExt !== requestExt) return false;
  }

  if (normalizedCandidate === normalizedRequested) {
    return true;
  }

  const candidateBase = path.parse(candidateName).name.toLowerCase();
  const requestedBase = path.parse(requestedFilename).name.toLowerCase();
  if (candidateBase === requestedBase) {
    return true;
  }

  return (
    normalizeFilenameIdentity(candidateName) ===
    normalizeFilenameIdentity(requestedFilename)
  );
}

/**
 * Get all possible policy directories
 */
function getPolicyDirs(): string[] {
  const dirs: string[] = [];

  // Check environment variable first
  if (process.env.POLICIES_DIR) {
    const envDir = path.resolve(process.env.POLICIES_DIR);
    if (fs.existsSync(envDir)) {
      dirs.push(envDir);
    }
  }

  // Add all configured institution folders
  for (const folder of ALL_POLICY_FOLDERS) {
    const candidates = [
      path.join(process.cwd(), "../../", folder), // Monorepo root
      path.join(process.cwd(), "../", folder),
      path.join(process.cwd(), folder),
      path.resolve(".", folder),
    ];

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved) && !dirs.includes(resolved)) {
        dirs.push(resolved);
      }
    }
  }

  return dirs;
}

/**
 * Determine institution from directory path
 */
function getInstitutionFromPath(dirPath: string): string {
  for (const [institution, folders] of Object.entries(INSTITUTION_FOLDER_ALIASES)) {
    if (folders.some((folder) => dirPath.includes(folder))) {
      return institution;
    }
  }
  return "UNKNOWN";
}

/**
 * Recursively search a directory for a file
 */
function searchDirectory(dir: string, filename: string): string | null {
  if (!fs.existsSync(dir)) return null;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith(".") || entry.name.startsWith("~")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const found = searchDirectory(fullPath, filename);
        if (found) return found;
      } else if (entry.isFile()) {
        if (isFilenameMatch(entry.name, filename)) {
          return fullPath;
        }
      }
    }
  } catch (error) {
    console.error(`Error searching directory ${dir}:`, error);
  }

  return null;
}

function findPolicyFile(
  filename: string
): { path: string; institution: string } | null {
  const policyDirs = getPolicyDirs();

  for (const dir of policyDirs) {
    const found = searchDirectory(dir, filename);
    if (found) {
      return {
        path: found,
        institution: getInstitutionFromPath(dir),
      };
    }
  }

  return null;
}

function getSearchCandidates(filename: string): string[] {
  const normalized = filename.trim();
  if (!normalized) return [];

  const candidates = new Set<string>([normalized]);
  const extension = path.extname(normalized).toLowerCase();

  if (extension) {
    // Resilience: if the request includes an incorrect trailing extension
    // (for example ".docx.pdf"), also try the stem with and without that suffix.
    const withoutFinalExt = normalized.slice(0, -extension.length);
    if (withoutFinalExt) {
      candidates.add(withoutFinalExt);

      const stem = path.parse(withoutFinalExt).name || withoutFinalExt;
      for (const ext of SUPPORTED_FILE_EXTENSIONS) {
        candidates.add(`${withoutFinalExt}${ext}`);
        candidates.add(`${stem}${ext}`);
      }
    }

    return [...candidates];
  }

  for (const ext of SUPPORTED_FILE_EXTENSIONS) {
    candidates.add(`${normalized}${ext}`);
  }

  return [...candidates];
}

function findPolicyFileWithExtensions(filename: string): { path: string; institution: string } | null {
  for (const candidate of getSearchCandidates(filename)) {
    const found = findPolicyFile(candidate);
    if (found) {
      return found;
    }
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const decodedFilename = decodeURIComponent(filename);

    // Security check
    if (!isSafePath(decodedFilename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Log search for debugging
    console.log(`[PDF] Looking for "${decodedFilename}"`);
    console.log(`[PDF] Searching in: ${getPolicyDirs().join(", ")}`);

    // Find the file
    const result = findPolicyFileWithExtensions(decodedFilename);

    if (!result) {
      console.error(`[PDF] File not found: ${decodedFilename}`);
      return NextResponse.json(
        {
          error: "File not found",
          filename: decodedFilename,
          tried: getSearchCandidates(decodedFilename),
          searchedDirectories: getPolicyDirs(),
        },
        { status: 404 }
      );
    }

    console.log(`[PDF] Found: ${result.path} (${result.institution})`);

    // Read and serve the file
    const fileBuffer = fs.readFileSync(result.path);

    // Determine content type
    const ext = path.extname(result.path).toLowerCase();
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : ext === ".pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : ext === ".txt"
          ? "text/plain; charset=utf-8"
        : ext === ".md"
          ? "text/markdown; charset=utf-8"
        : "application/octet-stream";

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${path.basename(result.path)}"`,
        "Cache-Control": "public, max-age=86400", // 24 hour cache
        "X-Institution": result.institution, // Custom header for debugging
      },
    });
  } catch (error) {
    console.error("Error serving policy file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
