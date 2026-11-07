export const harnesses = [
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["hermes", "Hermes"],
  ["opencode", "OpenCode"],
  ["pi", "Pi"],
  ["other", "Other compatible harness"],
] as const;

export function connectionGuide(harness: string): string {
  switch (harness) {
    case "claude-code":
      return "ANTHROPIC_BASE_URL=http://127.0.0.1:8318\nANTHROPIC_AUTH_TOKEN=<your CLIProxyAPI key>\n# Select a model exposed by your proxy.";
    case "codex":
      return 'model_provider = "autoeval"\nmodel = "<proxy-model-id>"\n[model_providers.autoeval]\nname = "AutoEval recorder"\nbase_url = "http://127.0.0.1:8318/v1"\nwire_api = "responses"\nenv_key = "CLI_PROXY_API_KEY"';
    case "pi":
      return JSON.stringify(
        {
          providers: {
            autoeval: {
              baseUrl: "http://127.0.0.1:8318/v1",
              api: "openai-completions",
              apiKey: "$CLI_PROXY_API_KEY",
              models: [{ id: "<proxy-model-id>" }],
            },
          },
        },
        null,
        2,
      );
    case "opencode":
      return JSON.stringify(
        {
          provider: {
            autoeval: {
              npm: "@ai-sdk/openai-compatible",
              name: "AutoEval recorder",
              options: {
                baseURL: "http://127.0.0.1:8318/v1",
                apiKey: "{env:CLI_PROXY_API_KEY}",
              },
              models: { "<proxy-model-id>": { name: "Proxy model" } },
            },
          },
          model: "autoeval/<proxy-model-id>",
        },
        null,
        2,
      );
    case "hermes":
      return "Run hermes model and select a custom OpenAI-compatible endpoint.\nBase URL: http://127.0.0.1:8318/v1\nAPI key: your CLIProxyAPI key\nModel: a model exposed by your proxy";
    default:
      return "OpenAI Chat / Responses base URL: http://127.0.0.1:8318/v1\nAnthropic base URL: http://127.0.0.1:8318\nUse your CLIProxyAPI key and an explicitly selected model.";
  }
}
