const GITHUB_API_BASE = "https://api.github.com";
const GIST_FILENAME = "bytebeat-plotter-project.json";

export interface BbProject {
  code: string;
  sampleRate: number;
  classic: boolean;
  float: boolean;
}

export type ValidateGithubTokenResult =
  | { ok: true; login: string }
  | { ok: false; error: string };

export async function validateGithubToken(
  token: string,
): Promise<ValidateGithubTokenResult> {
  if (!token.trim()) {
    return { ok: false, error: "GitHub token is empty." };
  }

  try {
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        error:
          response.status === 401
            ? "Invalid or expired GitHub token."
            : `GitHub API error (${response.status}).`,
      };
    }

    const data = (await response.json()) as { login?: string };
    return { ok: true, login: data.login ?? "" };
  } catch (error) {
    console.error("Failed to validate GitHub token", error);
    return { ok: false, error: "Network error while talking to GitHub." };
  }
}

export type SaveProjectOptions = {
  gistId?: string | null;
  description?: string;
  public?: boolean;
  filename?: string | null;
};

export type SaveProjectResult = {
  gistId: string;
  htmlUrl: string | null;
  filename: string;
};

export async function saveProjectToGist(
  token: string,
  project: BbProject,
  options: SaveProjectOptions = {},
): Promise<SaveProjectResult> {
  const { gistId, description, public: isPublic, filename } = options;

  let targetFilename: string;
  if (filename && filename.trim()) {
    targetFilename = filename.trim();
  } else if (description && description.trim()) {
    const sanitizedDescription = description
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project";
    targetFilename = `bytebeat-plotter-${sanitizedDescription}.json`;
  } else {
    targetFilename = GIST_FILENAME;
  }

  const payload = {
    description: description || "bytebeat-plotter project",
    public: isPublic ?? false,
    files: {
      [targetFilename]: {
        content: JSON.stringify(project, null, 2),
      },
      "readme.txt": {
        content:
          "This is a [bytebeat-plotter](https://github.com/pckerneis/bytebeat-plotter) project.\n",
      },
    },
  };

  const url = gistId
    ? `${GITHUB_API_BASE}/gists/${encodeURIComponent(gistId)}`
    : `${GITHUB_API_BASE}/gists`;

  const method = gistId ? "PATCH" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to save project to GitHub Gist (status ${response.status}).`,
    );
  }

  const data = (await response.json()) as {
    id: string;
    html_url?: string;
  };

  return { gistId: data.id, htmlUrl: data.html_url ?? null, filename: targetFilename };
}

export type LoadedProject = {
  project: BbProject;
  filename: string;
};

export async function loadProjectFromGist(
  token: string,
  gistId: string,
): Promise<LoadedProject> {
  if (!gistId.trim()) {
    throw new Error("Gist ID is empty.");
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/gists/${encodeURIComponent(gistId)}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Gist not found."
        : `Failed to load project from GitHub Gist (status ${response.status}).`,
    );
  }

  const data = (await response.json()) as {
    files?: Record<
      string,
      {
        filename?: string;
        content?: string;
      } | null
    >;
  };

  const files = data.files || {};

  // Find first JSON file with "bytebeat-plotter-" prefix
  const file = Object.values(files).find(
    (file) => file?.filename?.startsWith("bytebeat-plotter-"),
  );

  if (!file || !file.content) {
    throw new Error(
      `Gist does not contain expected file "bytebeat-plotter-*.json".`,
    );
  }

  try {
    const parsed = JSON.parse(file.content) as BbProject;
    const filename = file.filename || GIST_FILENAME;
    return { project: parsed, filename };
  } catch (error) {
    console.error("Failed to parse project JSON from Gist", error);
    throw new Error("Invalid project JSON in Gist.");
  }
}

export interface BbPlotterGistSummary {
  id: string;
  description: string;
  updatedAt: string;
  htmlUrl: string | null;
}

export async function listBbPlotterGists(
  token: string,
  options: { perPage?: number } = {},
): Promise<BbPlotterGistSummary[]> {
  const perPage = options.perPage ?? 50;

  const response = await fetch(
    `${GITHUB_API_BASE}/gists?per_page=${encodeURIComponent(String(perPage))}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to list GitHub gists (status ${response.status}).`,
    );
  }

  const data = (await response.json()) as Array<{
    id: string;
    description: string | null;
    updated_at: string;
    html_url?: string;
    files?: Record<
      string,
      {
        filename?: string;
      } | null
    >;
  }>;

  const results: BbPlotterGistSummary[] = [];

  for (const gist of data) {
    const files = gist.files || {};
    const hasProjectFile = Object.keys(files).some(
      (key) => key === GIST_FILENAME || files[key]?.filename?.startsWith("bytebeat-plotter-"),
    );
    const desc = gist.description ?? "";
    if (!hasProjectFile) continue;

    results.push({
      id: gist.id,
      description: desc,
      updatedAt: gist.updated_at,
      htmlUrl: gist.html_url ?? null,
    });
  }

  results.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return results;
}
