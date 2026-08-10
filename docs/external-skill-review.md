# External frontend skill review

The project does not execute or install code from the linked skill repositories.

## Reviewed guidance

- Emil Kowalski skills: reused the animation decision framework, short ease-out transitions, active press feedback, transform and opacity preference, and reduced-motion handling.
- Anthropic frontend design skill: reused subject-specific visual direction, structural labels that encode real meaning, plain utility copy, and one memorable interaction surrounded by restrained UI.
- The referenced `devsagent/design-engineering-skills` repository could not be fetched through the available read-only web path. Nothing from that source was imported.

## Security decision

Only declarative design guidance was used. No shell scripts, package installers, MCP definitions, hooks, tool permissions, or nested instructions were copied. Frontend runtime dependencies come from the project package manifest and lockfile, not from third-party skill automation.
