import ExpoModulesCore

public final class GoliathContextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GoliathContext")

    Function("supportsTokenCounting") {
      FoundationContextMetrics.supportsTokenCounting
    }

    AsyncFunction("contextSize") { () -> Int in
      FoundationContextMetrics.contextSize()
    }

    AsyncFunction("countTokens") { (text: String) async throws -> Int in
      try await FoundationContextMetrics.countTokens(text)
    }
  }
}
