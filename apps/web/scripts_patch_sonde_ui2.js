const fs = require('fs');
const edit = (file, fn) => {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error('no change ' + file);
  fs.writeFileSync(file, after);
};
const must = (s, a, b) => {
  if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80));
  return s.replace(a, b);
};

edit('src/app/(app)/layout.tsx', (s) => {
  // Wrap the returned shell in the provider: rename the component body to an inner component.
  s = must(s, 'export default function AppLayout({ children }: { children: React.ReactNode }) {', 'export default function AppLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <SondeContextProvider>\n      <AppShell>{children}</AppShell>\n    </SondeContextProvider>\n  );\n}\n\nfunction AppShell({ children }: { children: React.ReactNode }) {');
  return s;
});

edit('src/components/shell/sonde-panel.tsx', (s) => {
  s = must(s, '  const queryClient = useQueryClient();', '  const queryClient = useQueryClient();\n  const { context: caseContext } = useSondeCaseContext();');
  s = must(s, "import { streamCopilotMessage,", "import { useSondeCaseContext } from '../../lib/sonde-context';\nimport { streamCopilotMessage,");
  return s;
});

edit('src/components/orchestration/orchestration-panel.tsx', (s) => {
  s = must(s, "import { ActionButtons } from './action-controls';", "import { useSondeCaseContext } from '../../lib/sonde-context';\nimport { ActionButtons } from './action-controls';");
  s = must(s, "  const { data: graph, isLoading, isError, error, refetch } = useOrchestration(caseId, { mode, planRevision });", "  const { data: graph, isLoading, isError, error, refetch } = useOrchestration(caseId, { mode, planRevision });\n  // Sonde sees what the user sees: the case, the selected step and the revision (the server re-validates this hint).\n  const { setContext } = useSondeCaseContext();\n  useEffect(() => {\n    setContext({ caseId, nodeId: selected ?? undefined, planRevision });\n    return () => setContext(null);\n  }, [caseId, selected, planRevision, setContext]);");
  return s;
});
console.log('ok');
