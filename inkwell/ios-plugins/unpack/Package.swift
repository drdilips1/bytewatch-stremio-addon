// swift-tools-version: 5.9
import PackageDescription

// The name must match what Capacitor derives from package.json ("inkwell-unpack-ios").
let package = Package(
    name: "InkwellUnpackIos",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "InkwellUnpackIos", targets: ["InkwellUnpackPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        // .zip
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.19"),
        // .rar (RAR 4 and RAR 5, split volumes): RARLAB's own unrar library
        .package(url: "https://github.com/mtgto/Unrar.swift.git", exact: "0.5.4")
    ],
    targets: [
        .target(
            name: "InkwellUnpackPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation"),
                .product(name: "Unrar", package: "Unrar.swift")
            ],
            path: "ios/Sources/InkwellUnpackPlugin"
        )
    ]
)
