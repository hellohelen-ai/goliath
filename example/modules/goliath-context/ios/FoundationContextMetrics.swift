import Foundation
import FoundationModels

// Keep framework calls separate from the bridge so SDK compatibility can be checked directly.
enum FoundationContextMetrics {
  static var supportsTokenCounting: Bool {
    if #available(iOS 26.4, macOS 26.4, *) { return true }
    return false
  }

  static func contextSize() -> Int {
    SystemLanguageModel.default.contextSize
  }

  static func countTokens(_ text: String) async throws -> Int {
    if #available(iOS 26.4, macOS 26.4, *) {
      return try await SystemLanguageModel.default.tokenCount(for: text)
    }
    throw NSError(domain: "GoliathContext", code: 1,
                  userInfo: [NSLocalizedDescriptionKey: "Native token counting requires iOS 26.4 or newer."])
  }
}
