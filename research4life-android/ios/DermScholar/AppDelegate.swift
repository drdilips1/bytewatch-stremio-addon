import UIKit
import AVFoundation

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    let main = MainViewController()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Read aloud keeps playing with the silent switch on and in the background.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = main
        w.makeKeyAndVisible()
        window = w
        return true
    }

    /// A PDF opened with DermScholar (Files, Mail, or Share → DermScholar from MyLOFT).
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        main.receive(url)
        return true
    }
}
