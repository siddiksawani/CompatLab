#include <node_api.h>
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

static atomic_int stopping = 0;
static void *wait_thread(void *argument) {
  (void)argument;
  while (!atomic_load(&stopping)) usleep(1000);
  return NULL;
}
static napi_value initialize(napi_env env, napi_value exports) {
  struct rlimit limit;
  getrlimit(RLIMIT_NPROC, &limit);
  int count = 0, error = 0;
  const char *mode = getenv("FIXTURE_PROCESS_MODE");
  if (mode && strcmp(mode, "threads") == 0) {
    pthread_t threads[200];
    for (; count < 200; count++) {
      error = pthread_create(&threads[count], NULL, wait_thread, NULL);
      if (error) break;
    }
    atomic_store(&stopping, 1);
    for (int index = 0; index < count; index++) pthread_join(threads[index], NULL);
  } else {
    pid_t children[200];
    for (; count < 200; count++) {
      pid_t pid = fork();
      if (pid < 0) { error = errno; break; }
      if (pid == 0) { for (;;) pause(); }
      children[count] = pid;
    }
    for (int index = 0; index < count; index++) kill(children[index], SIGKILL);
    for (int index = 0; index < count; index++) waitpid(children[index], NULL, 0);
  }
  napi_value value;
  napi_create_int32(env, count, &value); napi_set_named_property(env, exports, "created", value);
  napi_create_int32(env, error, &value); napi_set_named_property(env, exports, "error", value);
  napi_create_int32(env, (int)limit.rlim_cur, &value); napi_set_named_property(env, exports, "limit", value);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
