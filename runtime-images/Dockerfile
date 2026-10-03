ARG SOURCE_IMAGE
FROM ${SOURCE_IMAGE} AS source

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:20afe6a70f2565277b704cc17289cb557f353a3619f6350f52a2317106598df4
ARG RUNTIME_BINARY
ARG SOURCE_IMAGE
ARG PROFILE_ID
COPY --from=source ${RUNTIME_BINARY} ${RUNTIME_BINARY}
LABEL compatlab.runtime.profile=${PROFILE_ID} compatlab.runtime.source=${SOURCE_IMAGE} compatlab.runtime.recipe=runtime_image_v1
ENV PATH=/usr/local/bin:/usr/bin
USER 65534:65534
WORKDIR /workspace
ENTRYPOINT []
