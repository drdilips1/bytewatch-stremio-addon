import Foundation
import Security

/// Saved sign-ins (Research4Life, UpToDate) in the iPhone's Keychain, kept on this device only.
enum Keychain {
    private static func base(_ provider: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dermscholar.login." + provider]
    }

    static func save(provider: String, user: String, password: String) {
        SecItemDelete(base(provider) as CFDictionary)
        var q = base(provider)
        q[kSecAttrAccount as String] = user
        q[kSecValueData as String] = Data(password.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load(provider: String) -> (user: String, password: String)? {
        var q = base(provider)
        q[kSecReturnAttributes as String] = true
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let d = out as? [String: Any],
              let user = d[kSecAttrAccount as String] as? String,
              let data = d[kSecValueData as String] as? Data,
              let pass = String(data: data, encoding: .utf8) else { return nil }
        return (user, pass)
    }

    static func delete(provider: String) { SecItemDelete(base(provider) as CFDictionary) }
}
