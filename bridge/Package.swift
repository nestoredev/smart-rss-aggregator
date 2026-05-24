// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LLMBridge",
    platforms: [
        .macOS("26.0")
    ],
    products: [
        .executable(name: "llm-bridge", targets: ["LLMBridge"])
    ],
    targets: [
        .executableTarget(
            name: "LLMBridge",
            dependencies: [],
            path: "Sources"
        )
    ]
)
