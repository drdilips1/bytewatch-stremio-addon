// swift-tools-version: 5.9
import PackageDescription

// The name must match what Capacitor derives from package.json ("inkwell-tts-ios").
let package = Package(
    name: "InkwellTtsIos",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "InkwellTtsIos", targets: ["InkwellTtsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "InkwellTtsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/InkwellTtsPlugin"
        )
    ]
)
