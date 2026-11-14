// swift-tools-version: 5.9
import PackageDescription

// The name must match what Capacitor derives from package.json ("paper-speech-ios").
// Frameworks/ (sherpa-onnx and onnxruntime for iPhone) and Sources/…/SherpaOnnx.swift are put in place
// by the iPhone build (.github/workflows/paper2audio-ios.yml): they are built or fetched there.
let package = Package(
    name: "PaperSpeechIos",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PaperSpeechIos", targets: ["PaperSpeechPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.19")
    ],
    targets: [
        .binaryTarget(name: "SherpaOnnxC", path: "Frameworks/sherpa-onnx.xcframework"),
        .binaryTarget(name: "onnxruntime", path: "Frameworks/onnxruntime.xcframework"),
        .target(
            name: "PaperSpeechPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation"),
                "SherpaOnnxC",
                "onnxruntime"
            ],
            path: "ios/Sources/PaperSpeechPlugin",
            linkerSettings: [
                .linkedLibrary("c++"),
                .linkedFramework("Accelerate"),
                .linkedFramework("CoreML")
            ]
        )
    ]
)
