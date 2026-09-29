#!/usr/bin/env bash
set -euo pipefail

# SDK symbols must compile while preserving the starter's iOS 26.0 deployment target.
# This check needs Xcode 26.4+; it does not require Apple Intelligence or a simulator boot.
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
metrics="$repo_dir/example/modules/goliath-context/ios/FoundationContextMetrics.swift"
xcodebuild -version
for sdk in iphoneos iphonesimulator; do
  sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
  target="arm64-apple-ios26.0"
  if [ "$sdk" = "iphonesimulator" ]; then target="$target-simulator"; fi
  xcrun --sdk "$sdk" swiftc -typecheck -sdk "$sdk_path" -target "$target" "$metrics"
done
