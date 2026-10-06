import Foundation
import CryptoKit
import CommonCrypto

/// The encrypted part of the account sync (logins and AI keys), for screens that can't use the
/// browser's own crypto: the key comes from the DermScholar account password (PBKDF2-SHA256), and
/// the data is sealed with AES-GCM (nonce + ciphertext + tag, as the browser's crypto makes it).
enum Vault {
    static func deriveKey(password: String, salt: String) -> String? {
        var key = [UInt8](repeating: 0, count: 32)
        let pw = Array(password.utf8), sl = Array(salt.utf8)
        let rc = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password, pw.count, sl, sl.count,
                                      CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 150_000, &key, key.count)
        return rc == Int32(kCCSuccess) ? Data(key).base64EncodedString() : nil
    }

    static func seal(key: String, text: String) -> String? {
        guard let k = Data(base64Encoded: key), let box = try? AES.GCM.seal(Data(text.utf8), using: SymmetricKey(data: k)) else { return nil }
        return box.combined?.base64EncodedString()
    }

    static func open(key: String, blob: String) -> String? {
        guard let k = Data(base64Encoded: key), let d = Data(base64Encoded: blob),
              let box = try? AES.GCM.SealedBox(combined: d),
              let plain = try? AES.GCM.open(box, using: SymmetricKey(data: k)) else { return nil }
        return String(data: plain, encoding: .utf8)
    }

    /// Logins kept in the Keychain, for the sync (same shape as Android's exportSecrets).
    static let providers = ["r4l", "utd", "spr", "px"]

    static func exportLogins() -> [String: Any] {
        var creds: [String: Any] = [:]
        for p in providers {
            if let l = Keychain.load(provider: p) { creds[p] = ["active": l.user, "accounts": [["user": l.user, "pass": l.password]]] }
        }
        return creds
    }

    /// Logins from another device: added where this one has none.
    static func importLogins(_ creds: [String: Any]) -> [String: String] {
        var added: [String: String] = [:]
        for p in providers {
            guard Keychain.load(provider: p) == nil, let o = creds[p] as? [String: Any],
                  let list = o["accounts"] as? [[String: Any]], !list.isEmpty else { continue }
            let active = o["active"] as? String ?? ""
            let pick = list.first { ($0["user"] as? String) == active } ?? list[0]
            guard let u = pick["user"] as? String, let pw = pick["pass"] as? String, !u.isEmpty, !pw.isEmpty else { continue }
            Keychain.save(provider: p, user: u, password: pw)
            added[p] = u
        }
        return added
    }
}
