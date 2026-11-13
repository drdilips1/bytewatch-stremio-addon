// swift-tools-version: 5.9
import PackageDescription

// The name must match what Capacitor derives from package.json ("paper-speech-ios").
let package = Package(
    name: "PaperSpeechIos",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PaperSpeechIos", targets: ["PaperSpeechPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "PaperSpeechPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/PaperSpeechPlugin"
        )
    ]
)
