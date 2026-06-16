# Repository Guidelines

## Branch Strategy

- Default branch: `main`.
- Do not use a long-lived `dev` branch.
- Create short-lived branches from `main` for all changes:
  - `feature/<short-description>` for new functionality.
  - `fix/<short-description>` for bug fixes.
  - `chore/<short-description>` for maintenance work.
- Merge work back into `main` through pull requests.
- Keep `main` stable and deployable.
- Prefer squash merge so history stays linear and easy to scan.
- Do not force-push to `main`.
- Do not delete `main`.
- When CI is added, required status checks should gate merges into `main`.

## Solo Development Workflow

1. Sync `main`.
2. Create a short-lived branch for the task.
3. Commit focused changes.
4. Open a pull request into `main`.
5. Merge after checks pass.

## Agent Notes

- Follow the branch strategy above unless the user explicitly requests a different workflow.
- Keep changes scoped to the current task.
- Do not create or restore a `dev` branch without explicit user approval.
- Do not commit files matched by `.git/info/exclude` or any `.gitignore`; do not use `git add -f` for ignored files unless the user explicitly approves that exact file.
- `docs/superpowers/` is intentionally ignored local planning output. Agents may write Superpowers specs there, but must not move them elsewhere just to commit them, must not force-add them, and must not commit them unless the user explicitly approves that exact file.
