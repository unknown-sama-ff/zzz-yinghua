import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundedInteger } from './runtime.js';

/** Each child handles one image at a time and keeps both ONNX sessions warm. */
export function createLayerWorkerPool({
  maxWorkers = 2,
  idleMs = boundedInteger(process.env.PUZZLE_LAYER_IDLE_MS, 60000, 1000, 300000),
  timeoutMs = 60000,
  workerFile = fileURLToPath(new URL('./worker.js', import.meta.url)),
} = {}) {
  const workers = new Set();
  let nextId = 0;
  let closed = false;

  function stop(worker, error) {
    // Keep shutdown observable even when the last worker was idle/unreferenced.
    worker.child.ref();
    if (worker.stopping) return;
    worker.stopping = true;
    worker.failure = error;
    clearTimeout(worker.idleTimer);
    clearTimeout(worker.task?.timer);
    worker.child.kill();
    worker.killTimer = setTimeout(() => worker.child.kill('SIGKILL'), 1000);
    worker.killTimer.unref();
  }

  function start(model, depthModel) {
    const child = fork(workerFile, [model, depthModel], {
      execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
    });
    const worker = { child, model, depthModel, task: null, stderr: '', stopping: false, warm: false };
    workers.add(worker);
    worker.exited = new Promise((resolve) => {
      child.once('close', () => {
        clearTimeout(worker.idleTimer);
        clearTimeout(worker.killTimer);
        clearTimeout(worker.task?.timer);
        workers.delete(worker);
        worker.task?.reject(worker.failure || new Error(worker.stderr || '分层处理进程已结束'));
        worker.task = null;
        resolve();
      });
    });
    child.stderr.on('data', (bytes) => { worker.stderr = (worker.stderr + bytes.toString()).slice(-1000); });
    child.stderr.unref?.();
    child.on('error', (error) => stop(worker, error));
    child.on('message', (message) => {
      const task = worker.task;
      if (!task || worker.stopping || message?.id !== task.id) return;
      if (!message.ok) {
        stop(worker, new Error(message.error || '分层推理失败'));
        return;
      }
      clearTimeout(task.timer);
      worker.task = null;
      worker.warm = true;
      worker.stderr = '';
      worker.idleTimer = setTimeout(() => stop(worker), idleMs);
      worker.idleTimer.unref();
      child.unref();
      child.channel?.unref();
      task.resolve(message.metrics);
    });
    return worker;
  }

  return {
    hasIdleWorker() {
      return [...workers].some((worker) => worker.warm && !worker.task && !worker.stopping);
    },
    async run({ model, depthModel, input, output }) {
      if (closed) throw new Error('分层服务已关闭');
      let worker = [...workers].find((entry) => !entry.task && !entry.stopping && entry.model === model && entry.depthModel === depthModel);
      if (!worker) {
        // Retiring children still count towards the cap until their memory is released.
        await Promise.all([...workers].filter((entry) => entry.stopping).map((entry) => entry.exited));
        if (closed) throw new Error('分层服务已关闭');
        if (workers.size >= maxWorkers) throw new Error('分层推理进程已满');
        worker = start(model, depthModel);
      }
      clearTimeout(worker.idleTimer);
      worker.child.ref();
      worker.child.channel?.ref();
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => stop(worker, new Error('分层处理超时')), timeoutMs);
        worker.task = { id, resolve, reject, timer };
        worker.child.send({ id, input, output }, (error) => { if (error) stop(worker, error); });
      });
    },
    async close() {
      closed = true;
      for (const worker of workers) stop(worker, new Error('分层服务已关闭'));
      await Promise.all([...workers].map((worker) => worker.exited));
    },
  };
}
