import { transform } from "../transform"
import { WorkflowData, WorkflowTransactionContext } from "../type"
import { OrchestrationUtils } from "@medusajs/utils"
import { resolveValue } from "./resolve-value"

export function proxify<T>(obj: WorkflowData<any>): T {
  return new Proxy(obj, {
    get(target: any, prop: string | symbol): any {
      if (prop in target) {
        return target[prop]
      }

      return transform({}, async function (_, context) {
        const { invoke } = context as WorkflowTransactionContext
        let output =
          target.__type === OrchestrationUtils.SymbolInputReference ||
          target.__type === OrchestrationUtils.SymbolWorkflowStepTransformer
            ? target
            : invoke?.[obj.__step__]?.output

        output = await resolveValue(output, context)

        return output?.[prop]
      })
    },
  }) as unknown as T
}
