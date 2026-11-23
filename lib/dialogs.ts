/**
 * The one way to ask a yes/no question or tell a person something.
 *
 * A native confirm()/alert() is a browser popup: it looks foreign, some embedded
 * browsers refuse it, it freezes automation, and the message a person most needs
 * to read (why a delete was refused) lives in it. These render the shared
 * centred Modal instead, through the single <DialogHost /> in the root layout.
 *
 *   if (!await askConfirm("Delete this?")) return;
 *   tell("Could not download the PDF.");
 *
 * Imperative on purpose: ~90 call sites already had the `if (!confirm(...)) return`
 * shape, and a hook per site would have meant rewriting each component.
 */

export interface DialogRequest {
  id: number;
  kind: "confirm" | "alert";
  message: string;
  resolve: (ok: boolean) => void;
}

type Listener = (queue: DialogRequest[]) => void;

let nextId = 1;
let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(queue);
}

export function subscribeDialogs(l: Listener): () => void {
  listeners.add(l);
  l(queue);
  return () => { listeners.delete(l); };
}

function push(kind: DialogRequest["kind"], message: string): Promise<boolean> {
  // Server render, or before the host has mounted: nobody can answer, and a
  // destructive action must never proceed on a missing answer.
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { id: nextId++, kind, message, resolve }];
    emit();
  });
}

/** Resolves true on OK, false on Cancel/close. */
export function askConfirm(message: string): Promise<boolean> {
  return push("confirm", message);
}

/** Shows a message with a single OK. Fire and forget. */
export function tell(message: string): void {
  void push("alert", message);
}

/** Called by the host when a dialog is answered. */
export function answerDialog(id: number, ok: boolean): void {
  const req = queue.find((r) => r.id === id);
  if (!req) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  req.resolve(ok);
}
