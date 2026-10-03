#define NAPI_VERSION 8
#include <node_api.h>

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value value;
  napi_create_string_utf8(env, "native", NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, exports, "value", value);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
