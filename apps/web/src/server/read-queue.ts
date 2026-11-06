export class ReadBusy extends Error {
  constructor() {
    super("Evidence reads are busy. Retry shortly.");
    this.name = "ReadBusy";
  }
}

type Job<T> = {
  key: string;
  read: () => Promise<T>;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

// Share only unfinished reads. Completed evidence must be selected again after invalidation.
export function createReadQueue<T>() {
  const jobs = new Map<string, Job<T>>();
  const waiting: Job<T>[] = [];
  let active = 0,
    callers = 0;
  function start(job: Job<T>) {
    clearTimeout(job.timer);
    active++;
    const finish = () => {
      active--;
      jobs.delete(job.key);
      const next = waiting.shift();
      if (next) start(next);
    };
    void Promise.resolve()
      .then(job.read)
      .then(
        (value) => {
          finish();
          job.resolve(value);
        },
        (error: unknown) => {
          finish();
          job.reject(error);
        },
      );
  }
  return async (key: string, read: () => Promise<T>): Promise<T> => {
    if (callers >= 16) throw new ReadBusy();
    callers++;
    try {
      let job = jobs.get(key);
      if (!job) {
        if (active >= 2 && waiting.length >= 8) throw new ReadBusy();
        const { promise, resolve, reject } = Promise.withResolvers<T>();
        job = { key, read, promise, resolve, reject };
        jobs.set(key, job);
        if (active < 2) start(job);
        else {
          const queued = job;
          waiting.push(queued);
          queued.timer = setTimeout(() => {
            waiting.splice(waiting.indexOf(queued), 1);
            jobs.delete(key);
            reject(new ReadBusy());
          }, 250);
        }
      }
      return await job.promise;
    } finally {
      callers--;
    }
  };
}
