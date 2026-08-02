import { Card } from "@/components/Card";
import type { RuntimeArtifact, RuntimeBinding, RuntimeTask, RuntimeTaskInputPort, RuntimeTaskOutputPort } from "../types";

/** Lista só-leitura das RuntimeTasks com seus contratos de entrada/saída e o artefato esperado —
 * nenhum botão de ação: tudo aqui descreve o que ESTÁ preparado, nunca o que rodou. */
export function RuntimeTaskContracts({
  tasks,
  inputs,
  outputs,
  bindings,
  artifacts,
}: {
  tasks: readonly RuntimeTask[];
  inputs: readonly RuntimeTaskInputPort[];
  outputs: readonly RuntimeTaskOutputPort[];
  bindings: readonly RuntimeBinding[];
  artifacts: readonly RuntimeArtifact[];
}) {
  const inputsByTask = groupBy(inputs, (port) => port.runtimeTaskId);
  const outputsByTask = groupBy(outputs, (port) => port.runtimeTaskId);
  const artifactByTask = new Map(artifacts.map((artifact) => [artifact.runtimeTaskId, artifact]));
  const bindingByInputPort = new Map(bindings.map((binding) => [`${binding.toRuntimeTaskId}:${binding.toInputPort}`, binding]));

  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => {
        const artifact = artifactByTask.get(task.id);
        return (
          <Card key={task.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">{task.type}</p>
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">{task.capability}</span>
            </div>

            {(inputsByTask.get(task.id) ?? []).length > 0 ? (
              <div className="mt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Entradas</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {(inputsByTask.get(task.id) ?? []).map((port) => {
                    const binding = bindingByInputPort.get(`${task.id}:${port.portKey}`);
                    return (
                      <li key={port.portKey} className="text-xs text-ink-muted">
                        <span className="font-medium text-ink">{port.portKey}</span> — aceita [{port.acceptedArtifactTypes.join(", ")}]
                        {port.required ? " · obrigatória" : " · opcional"}
                        {binding ? (
                          <span className="text-ink-faint"> · vem de {binding.fromRuntimeTaskId === task.id ? "—" : `"${binding.fromOutputPort}"`}</span>
                        ) : (
                          <span className="text-red-600"> · sem binding</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {(outputsByTask.get(task.id) ?? []).length > 0 ? (
              <div className="mt-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Saídas</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {(outputsByTask.get(task.id) ?? []).map((port) => (
                    <li key={port.portKey} className="text-xs text-ink-muted">
                      <span className="font-medium text-ink">{port.portKey}</span> — produz &quot;{port.artifactType}&quot;
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {artifact ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2">
                <p className="text-xs font-medium text-ink-muted">Artefato esperado — {artifact.schema.artifactType}</p>
                <p className="mt-0.5 text-xs text-ink-faint">{artifact.schema.description}</p>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}
