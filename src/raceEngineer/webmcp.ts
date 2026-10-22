import { analysisTools } from "./tools";
import { AnalysisService } from "./service";
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};
export type ModelContext = {
  registerTool: (tool: Tool) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
};
const registrations = new WeakMap<
  ModelContext,
  { service?: AnalysisService; ready: Promise<void> }
>();
export function availableContext(
  doc: Document = document,
): ModelContext | undefined {
  return (doc as Document & { modelContext?: ModelContext }).modelContext;
}
export function connect(
  context: ModelContext,
  service: AnalysisService,
  onError: (e: unknown) => void = () => {},
) {
  let registration = registrations.get(context);
  if (!registration) {
    registration = { ready: Promise.resolve() };
    registrations.set(context, registration);
    const target = registration;
    target.ready = (async () => {
      for (const definition of analysisTools()) {
        const kind = definition.name.slice(5);
        await context.registerTool({
          ...definition,
          annotations: { readOnlyHint: true },
          execute: async (args) => {
            try {
              if (!target.service) throw Error("analysis_not_ready");
              return await target.service.query(kind, args);
            } catch (e) {
              return {
                error: e instanceof Error ? e.message : "Analysis unavailable",
              };
            }
          },
        });
      }
    })();
  }
  registration.ready.catch(onError);
  registration.service = service;
  return () => {
    if (registration!.service === service) registration!.service = undefined;
    service.dispose();
  };
}
