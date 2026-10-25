import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import {
  chaseScheduler, runOrgChase, brokenPromiseSweep, supplyChainWatchdog,
  ledgerHealthCheck,
  qboSyncScheduler, runOrgQboSync,
  xeroSyncScheduler, runOrgXeroSync,
  runBatchCommit, runBatchUndo, scheduledImportScan, runScheduledImportFn,
  runBatchChunkLoop, batchJobWatchdog,
  recurringDocScheduler, processOrgRecurring,
} from "@/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    chaseScheduler,
    runOrgChase,
    brokenPromiseSweep,
    supplyChainWatchdog,
    ledgerHealthCheck,
    qboSyncScheduler,
    runOrgQboSync,
    xeroSyncScheduler,
    runOrgXeroSync,
    runBatchCommit,
    runBatchUndo,
    scheduledImportScan,
    runScheduledImportFn,
    runBatchChunkLoop,
    batchJobWatchdog,
    recurringDocScheduler,
    processOrgRecurring,
  ],
});
