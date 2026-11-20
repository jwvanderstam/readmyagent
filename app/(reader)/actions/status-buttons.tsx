import { allowedActionTransitions, type ActionStatus } from "@/lib/actions";
import { setActionStatusAction } from "./mutations";

const LABEL: Record<ActionStatus, string> = {
  todo: "Reopen",
  doing: "Start",
  done: "Done",
  dropped: "Drop",
};

export function ActionStatusButtons({ id, status }: { id: string; status: ActionStatus }) {
  return (
    <form action={setActionStatusAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="actionId" value={id} />
      {allowedActionTransitions(status).map((to) => (
        <button
          key={to}
          type="submit"
          name="status"
          value={to}
          className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-900"
        >
          {status === "doing" && to === "todo" ? "Pause" : LABEL[to]}
        </button>
      ))}
    </form>
  );
}
