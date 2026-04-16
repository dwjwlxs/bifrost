#!/bin/bash
set -euo pipefail

usage() {
  echo "Usage:"
  echo "  Export mode (run on build machine):  $0 export [tag]"
  echo "  Import mode (run on prod machine):   $0 import <tar-file>"
  exit 1
}

IMAGE_NAME="bifrost"
MODE="${1:-}"

case "${MODE}" in
  export)
    # Derive tag: use explicit argument if provided, otherwise the current git commit SHA
    TAG="${2:-$(git rev-parse --short HEAD)}"
    TAR_FILE="${IMAGE_NAME}-${TAG}.tar"

    # Save the already-built image to a tar archive
    docker save -o "${TAR_FILE}" "${IMAGE_NAME}:${TAG}" "${IMAGE_NAME}:latest"
    echo "Image exported: ${TAR_FILE}"
    ;;

  import)
    TAR_FILE="${2:-}"
    if [[ -z "${TAR_FILE}" ]]; then
      echo "Error: tar file path is required for import mode"
      usage
    fi
    if [[ ! -f "${TAR_FILE}" ]]; then
      echo "Error: file not found: ${TAR_FILE}"
      exit 1
    fi

    # Load the image archive into Docker
    docker load -i "${TAR_FILE}"
    echo "Image imported from: ${TAR_FILE}"
    ;;

  *)
    usage
    ;;
esac