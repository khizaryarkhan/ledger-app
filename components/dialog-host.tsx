"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { subscribeDialogs, answerDialog, type DialogRequest } from "@/lib/dialogs";

/** Mounted once in the root layout; renders whatever lib/dialogs queued. */
export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setQueue), []);

  const current = queue[0];
  if (!current) return null;
  const isConfirm = current.kind === "confirm";

  return (
    <Modal open center size="sm"
      title={isConfirm ? "Are you sure?" : "Notice"}
      onClose={() => answerDialog(current.id, false)}
      footer={<>
        {isConfirm && (
          <button onClick={() => answerDialog(current.id, false)}
            className="px-3 py-1.5 text-[13px] rounded-lg text-stone-300 hover:bg-stone-800">Cancel</button>
        )}
        <button autoFocus onClick={() => answerDialog(current.id, true)}
          className="px-3 py-1.5 text-[13px] rounded-lg bg-primary text-white hover:opacity-90">OK</button>
      </>}>
      <p className="px-5 py-4 text-[13px] text-stone-300 whitespace-pre-line">{current.message}</p>
    </Modal>
  );
}
