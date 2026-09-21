// A small fixed-size worker_threads pool. CPU-heavy requests (full-size image
// passes, benchmark sweeps) go here so the event loop keeps answering traffic.
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";

export function createPool(scriptUrl, size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
  const idle = [];
  const all = [];
  const queue = [];

  const spawn = () => {
    const w = new Worker(scriptUrl);
    w.unref();                                  // never hold the process open
    all.push(w);
    idle.push(w);
    return w;
  };
  for (let i = 0; i < size; i++) spawn();

  const pump = () => {
    while (queue.length && idle.length) {
      const job = queue.shift();
      const w = idle.pop();
      const done = (fn) => (arg) => {
        w.off("message", onMsg);
        w.off("error", onErr);
        idle.push(w);
        fn(arg);
        pump();
      };
      const onMsg = done(job.resolve);
      const onErr = done(job.reject);
      w.once("message", onMsg);
      w.once("error", onErr);
      w.postMessage(job.payload, job.transfer || []);
    }
  };

  return {
    size,
    pending: () => queue.length,
    run(payload, transfer) {
      return new Promise((resolve, reject) => {
        queue.push({ payload, transfer, resolve, reject });
        pump();
      });
    },
    async close() { await Promise.all(all.map((w) => w.terminate())); }
  };
}
