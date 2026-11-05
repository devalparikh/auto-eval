# todo

- local inference (running model via LMStudio (did we already research?))
- ux agent graph editor
- review spec for agent integration

vercel deploy (fixes the prod 404 / "Unexpected token '<'" errors on auto-eval-sand.vercel.app):
- delete `NEXT_PUBLIC_API_URL` in Vercel (or set it to `/api/backend/api`) and redeploy. these values are baked in at build time.
- set the backend env vars listed in `docs/vercel-deployment.md`.
- turn on Vercel Deployment Protection. the app has no login, and AGENTS.md says it shouldn't be exposed on a network; a public Vercel URL is exactly that.

data structure:
- i want the traces to either be single go through of a agent system 
- or 1 trace could technically be a group of ordered go throughs of the agent system (like frames in a video) (robot arm VLA trajectory etc)

code changes:


- keep in mind modularity of the codebase as well like plugging in a different DBs and abstraction layers (maybe DI?). follow best practices for production python system and frontend js system (but do not do it too overcomplicated that we wont need) 