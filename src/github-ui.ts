import {
  type BbPlotterGistSummary,
  listBbPlotterGists,
  type LoadedProject,
  loadProjectFromGist,
  saveProjectToGist,
  validateGithubToken
} from './github-gist-storage.ts';
import {setError, setInfo} from './status.ts';
import {applyProject, getCurrentProject} from './project.ts';

let githubToken: string | null = null;
let githubGistId: string | null = null;
let githubLogin: string | null = null;
let githubGistFilename: string | null = null;

const githubConnectButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-connect",
);
const githubActionsContainer = document.querySelector<HTMLDivElement>(
    "#bb-github-actions",
);
const githubSaveButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-save",
);
const githubSaveAsButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-save-as",
);
const githubLoadButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-load",
);
const githubDisconnectButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-disconnect",
);
const githubModal = document.querySelector<HTMLDivElement>("#bb-github-modal");
const githubTokenInput = document.querySelector<HTMLInputElement>(
    "#bb-github-token-input",
);
const githubModalError = document.querySelector<HTMLParagraphElement>(
    "#bb-github-modal-error",
);
const githubModalCancelButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-modal-cancel",
);
const githubModalConfirmButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-modal-confirm",
);
const githubLoadModal = document.querySelector<HTMLDivElement>(
    "#bb-github-load-modal",
);
const githubLoadList = document.querySelector<HTMLDivElement>(
    "#bb-github-load-list",
);
const githubLoadModalError = document.querySelector<HTMLParagraphElement>(
    "#bb-github-load-modal-error",
);
const githubLoadModalCancelButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-load-modal-cancel",
);
const githubRememberSessionCheckbox = document.querySelector<HTMLInputElement>(
    "#bb-github-remember-session",
);
const githubSaveAsModal = document.querySelector<HTMLDivElement>(
    "#bb-github-save-as-modal",
);
const githubSaveAsNameInput = document.querySelector<HTMLInputElement>(
    "#bb-github-save-as-name",
);
const githubSaveAsPublicCheckbox = document.querySelector<HTMLInputElement>(
    "#bb-github-save-as-public",
);
const githubSaveAsModalError = document.querySelector<HTMLParagraphElement>(
    "#bb-github-save-as-modal-error",
);
const githubSaveAsModalCancelButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-save-as-modal-cancel",
);
const githubSaveAsModalConfirmButton = document.querySelector<HTMLButtonElement>(
    "#bb-github-save-as-modal-confirm",
);

function openGithubModal() {
  if (!githubModal) return;
  githubModal.setAttribute("aria-hidden", "false");
  if (githubModalError) {
    githubModalError.textContent = "";
  }
  if (githubTokenInput) {
    githubTokenInput.value = "";
    githubTokenInput.focus();
  }
}

function closeGithubModal() {
  if (!githubModal) return;
  githubModal.setAttribute("aria-hidden", "true");
}

function openGithubLoadModal() {
  if (!githubLoadModal) return;
  githubLoadModal.setAttribute("aria-hidden", "false");
}

function closeGithubLoadModal() {
  if (!githubLoadModal) return;
  githubLoadModal.setAttribute("aria-hidden", "true");
}

function openGithubSaveAsModal() {
  if (!githubSaveAsModal) return;
  githubSaveAsModal.setAttribute("aria-hidden", "false");
  if (githubSaveAsModalError) githubSaveAsModalError.textContent = "";
  if (githubSaveAsPublicCheckbox) githubSaveAsPublicCheckbox.checked = false;
  if (githubSaveAsNameInput) {
    githubSaveAsNameInput.value = "";
    githubSaveAsNameInput.focus();
  }
}

function closeGithubSaveAsModal() {
  if (!githubSaveAsModal) return;
  githubSaveAsModal.setAttribute("aria-hidden", "true");
}

if (githubConnectButton) {
  githubConnectButton.addEventListener("click", () => {
    openGithubModal();
  });
}

if (githubModalCancelButton) {
  githubModalCancelButton.addEventListener("click", () => {
    closeGithubModal();
  });
}

if (githubLoadModalCancelButton) {
  githubLoadModalCancelButton.addEventListener("click", () => {
    closeGithubLoadModal();
  });
}

if (githubSaveAsModalCancelButton) {
  githubSaveAsModalCancelButton.addEventListener("click", () => {
    closeGithubSaveAsModal();
  });
}

if (githubModalConfirmButton && githubTokenInput) {
  githubModalConfirmButton.addEventListener("click", async () => {
    const token = githubTokenInput.value.trim();
    if (!token) {
      if (githubModalError) {
        githubModalError.textContent = "Please paste a GitHub token.";
      }
      return;
    }

    if (githubModalError) {
      githubModalError.textContent = "Validating token...";
    }
    githubModalConfirmButton.disabled = true;

    try {
      const result = await validateGithubToken(token);
      if (!result.ok) {
        if (githubModalError) {
          githubModalError.textContent = result.error;
        }
        return;
      }

      githubToken = token;
      githubLogin = result.login || null;

      if (githubRememberSessionCheckbox?.checked) {
        try {
          window.sessionStorage.setItem("bb-github-token", token);
        } catch {
          // ignore
        }
      } else {
        try {
          window.sessionStorage.removeItem("bb-github-token");
        } catch {
          // ignore
        }
      }

      githubGistId = null;
      try {
        window.sessionStorage.removeItem("bb-github-gist-id");
      } catch {
        // ignore
      }

      updateGithubUi();
      closeGithubModal();
      setInfo(
          githubLogin
              ? `Connected to GitHub as ${githubLogin}.`
              : "Connected to GitHub.",
      );
    } catch {
      if (githubModalError) {
        githubModalError.textContent = "Failed to validate token.";
      }
    } finally {
      githubModalConfirmButton.disabled = false;
    }
  });
}

if (githubSaveButton) {
  githubSaveButton.addEventListener("click", async () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }

    try {
      const project = getCurrentProject();
      const result = await saveProjectToGist(githubToken, project, {
        gistId: githubGistId,
        public: false,
        filename: githubGistFilename,
      });
      githubGistId = result.gistId;
      githubGistFilename = result.filename;
      try {
        window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
      } catch {
        // ignore
      }
      setInfo(`Saved to GitHub Gist.`);
    } catch (error) {
      console.error("Failed to save project to GitHub Gist", error);
      setError("Failed to save project to GitHub.");
    }
  });
}

if (githubLoadButton) {
  githubLoadButton.addEventListener("click", async () => {
    if (!githubToken) {
      openGithubModal();
      return;
    }
    if (!githubLoadList || !githubLoadModal) return;

    githubLoadList.innerHTML = "<p class=\"bb-modal-body\">Loading gists...</p>";
    if (githubLoadModalError) {
      githubLoadModalError.textContent = "";
    }
    openGithubLoadModal();

    let gists: BbPlotterGistSummary[] = [];
    try {
      gists = await listBbPlotterGists(githubToken, { perPage: 50 });
    } catch (error) {
      console.error("Failed to list GitHub gists", error);
      if (githubLoadModalError) {
        githubLoadModalError.textContent =
            "Failed to list GitHub gists. Please try again.";
      }
      githubLoadList.innerHTML = "";
      return;
    }

    if (!gists.length) {
      githubLoadList.innerHTML =
          "<p class=\"bb-modal-body\">No bytebeat-plotter gists found. Save a project first.</p>";
      return;
    }

    githubLoadList.innerHTML = gists
        .map((gist) => {
          const date = new Date(gist.updatedAt);
          const name =
              gist.description && gist.description.trim().length > 0
                  ? gist.description
                  : "(unnamed project)";
          const baseLabel = `${name} — ${date.toLocaleString()}`;
          const label =
              githubGistId && gist.id === githubGistId
                  ? `${baseLabel} (last used)`
                  : baseLabel;
          return `<button class=\"bb-button bb-modal-list-item\" type=\"button\" data-gist-id=\"${gist.id}\">${label}</button>`;
        })
        .join("");

    githubLoadList.querySelectorAll<HTMLButtonElement>("[data-gist-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!githubToken) {
          openGithubModal();
          return;
        }

        const id = button.dataset.gistId;
        if (!id) return;

        try {
          const loaded: LoadedProject = await loadProjectFromGist(
              githubToken,
              id,
          );
          const project = loaded.project;
          githubGistFilename = loaded.filename;
          githubGistId = id;
          try {
            window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
          } catch {
            // ignore
          }
          applyProject(project);
          setInfo(`Loaded project from GitHub Gist.`);
          updateGithubUi();
          closeGithubLoadModal();

          // TODO
          // handleStopClick();
        } catch (error) {
          console.error("Failed to load project from GitHub Gist", error);
          if (githubLoadModalError) {
            githubLoadModalError.textContent =
                "Failed to load project from GitHub.";
          }
        }
      });
    });
  });
}

if (githubDisconnectButton) {
  githubDisconnectButton.addEventListener("click", () => {
    githubToken = null;
    githubGistId = null;
    githubGistFilename = null;
    githubLogin = null;
    try {
      window.sessionStorage.removeItem("bb-github-token");
    } catch {
      // ignore
    }
    try {
      window.sessionStorage.removeItem("bb-github-gist-id");
    } catch {
      // ignore
    }
    updateGithubUi();
    setInfo("Disconnected from GitHub.");
  });
}

updateGithubUi();

if (githubToken && githubGistId) {
  (async () => {
    try {
      const loaded: LoadedProject = await loadProjectFromGist(
          githubToken as string,
          githubGistId as string,
      );
      githubGistFilename = loaded.filename;
      applyProject(loaded.project);
      setInfo("Loaded project from last GitHub Gist.");
    } catch {
      githubGistId = null;
      try {
        window.sessionStorage.removeItem("bb-github-gist-id");
      } catch {
      }
    }
    updateGithubUi();
  })();
} else {
  updateGithubUi();
}

export function loadGitHubInfoFromStorage() {
  try {
    const storedToken = window.sessionStorage.getItem("bb-github-token");
    const storedGistId = window.sessionStorage.getItem("bb-github-gist-id");

    if (storedToken && storedToken.trim()) {
      githubToken = storedToken;
      if (storedGistId && storedGistId.trim()) {
        githubGistId = storedGistId;
      }
    } else {
      githubGistId = null;
      if (storedGistId && storedGistId.trim()) {
        try {
          window.sessionStorage.removeItem("bb-github-gist-id");
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore sessionStorage errors
  }
}

function updateGithubUi() {
  const isConnected = !!githubToken;
  const hasGist = !!githubGistId;
  if (githubConnectButton) {
    githubConnectButton.hidden = isConnected;
  }
  if (githubActionsContainer) {
    githubActionsContainer.hidden = !isConnected;
  }
  if (githubSaveButton) {
    githubSaveButton.hidden = !isConnected || !hasGist;
  }
}

export function setupGitHubUi() {
  if (githubSaveAsButton) {
    githubSaveAsButton.addEventListener("click", () => {
      if (!githubToken) {
        openGithubModal();
        return;
      }
      openGithubSaveAsModal();
    });
  }

  if (githubSaveAsModalConfirmButton && githubSaveAsNameInput) {
    githubSaveAsModalConfirmButton.addEventListener("click", async () => {
      if (!githubToken) {
        openGithubModal();
        return;
      }

      const rawName = githubSaveAsNameInput.value;
      if (!rawName || !rawName.trim()) {
        if (githubSaveAsModalError) {
          githubSaveAsModalError.textContent = "Please enter a name.";
        }
        return;
      }

      let name = rawName.trim().toLowerCase();
      name = name.replace(/[^a-z0-9-]+/g, "-");
      name = name.replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!name) name = "project";
      if (name.length > 40) {
        name = name.slice(0, 40);
      }

      const isPublic = !!githubSaveAsPublicCheckbox?.checked;

      githubSaveAsModalConfirmButton.disabled = true;
      if (githubSaveAsModalError) githubSaveAsModalError.textContent = "Saving...";

      try {
        const project = getCurrentProject();
        const result = await saveProjectToGist(githubToken, project, {
          gistId: null,
          description: rawName,
          public: isPublic,
        });
        githubGistId = result.gistId;
        githubGistFilename = result.filename;
        try {
          window.sessionStorage.setItem("bb-github-gist-id", githubGistId);
        } catch {
          // ignore
        }
        closeGithubSaveAsModal();
        updateGithubUi();
        setInfo(`Saved project as ${rawName}.`);
      } catch (error) {
        console.error("Failed to save project to GitHub Gist", error);
        if (githubSaveAsModalError) {
          githubSaveAsModalError.textContent = "Failed to save project to GitHub.";
        }
      } finally {
        githubSaveAsModalConfirmButton.disabled = false;
      }
    });
  }
}