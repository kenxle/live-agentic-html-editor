// Lahe menu bar app: the icon and menu that show what is waiting on Ken.
//
// It asks the helper's summary.read route every 5 seconds and when the menu
// opens, and draws a count beside the Lahe mark. Everything it knows comes from
// that one signed answer; it keeps no record of its own.
//
// The wire is docs/CONTRACTS.md, "The summary routes and the signed-request
// wire (menu bar)". The design is docs/features/20261012.01_menu_bar_app/.
//
// Built on Ken's Mac by `lahe install --menu-bar` with swiftc, from this one
// file plus Info.plist. AppKit, Foundation and CryptoKit only: no packages,
// no Xcode project. See README.md beside this file.
//
// Debug modes (none needs a macOS permission):
//   --self-test [--vectors <file>] [--decode <file>]...
//   --snapshot <dir> [--summary <file>]...
//   --dump-menu <summary.json | none> [--look not-running|stopped|cant-tell|updated]
//   --watch --state-dir <dir>    poll with no icon; one JSON line per change;
//                                stdin lines "wake", "poll", "quit"
//   --wake-after <seconds>       post the system wake notification once
//   --action <hide|stop|start|open <review>>   test builds only

import AppKit
import CryptoKit
import Foundation

// MARK: - Constants

let builtSummaryVersion = 1  // the summary_version this app reads
let pollSeconds: TimeInterval = 5
// Shorter than the poll, so a hung helper shows "can't tell" within one poll.
let requestTimeout: TimeInterval = 4
let titleLimit = 50

// The helper's login item. These are constants on purpose (architecture, SR6):
// nothing read from a file decides which job launchctl stops or starts. A test
// build swaps in a lahe-test-<id> label and a plist inside its own state
// folder, so no test can touch the real job.
enum HelperJob {
    #if LAHE_TEST_LABELS
    static var label: String {
        let id = ProcessInfo.processInfo.environment["LAHE_TEST_ID"] ?? ""
        let digits = !id.isEmpty && id.allSatisfy { $0.isASCII && $0.isNumber }
        return "lahe-test-" + (digits ? id : String(getpid()))
    }
    static func plistPath(stateDir: URL) -> String {
        return stateDir.appendingPathComponent(label + ".plist").path
    }
    #else
    static let label = "lahe-helper"
    static func plistPath(stateDir: URL) -> String {
        return NSHomeDirectory() + "/Library/LaunchAgents/lahe-helper.plist"
    }
    #endif
}

// MARK: - The summary (CONTRACTS.md, summary.read field table)

struct Summary: Decodable {
    struct Helper: Decodable { let version: String; let startedAt: String; let alwaysOn: Bool }
    struct WaitingDoc: Decodable {
        let review: String; let title: String; let pathHint: String
        let open: Bool; let questions: Int; let unread: Int; let newestAt: String
    }
    struct WaitingOnYou: Decodable { let count: Int; let documents: [WaitingDoc] }
    struct AgentDoc: Decodable { let review: String; let title: String; let pathHint: String; let waiting: Int }
    struct WaitingOnAgents: Decodable { let count: Int; let more: Int; let documents: [AgentDoc] }
    struct OpenDoc: Decodable { let review: String; let title: String; let pathHint: String; let focused: Bool }
    struct OpenDocuments: Decodable { let count: Int; let more: Int; let items: [OpenDoc] }
    struct Session: Decodable {
        let session: String; let name: String; let presence: String
        let lastHeardAt: String; let review: String?
    }
    struct Connected: Decodable { let count: Int; let more: Int; let items: [Session] }
    struct Sessions: Decodable { let open: Int; let connected: Connected }
    struct RecentDoc: Decodable { let review: String; let title: String; let pathHint: String; let last: String }
    struct Recent: Decodable { let more: Int; let items: [RecentDoc] }

    let summaryVersion: Int
    let generatedAt: String
    let helper: Helper
    let waitingOnYou: WaitingOnYou
    let waitingOnAgents: WaitingOnAgents
    let openDocuments: OpenDocuments
    let sessions: Sessions
    let recent: Recent
    let libraryUrl: String

    static func decode(_ data: Data) -> Summary? {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let summary = try? decoder.decode(Summary.self, from: data) else { return nil }
        return summary.summaryVersion == builtSummaryVersion ? summary : nil
    }
}

// MARK: - The proof wire (AUTH.CLI_PROOF)

enum Proof {
    static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func sha256Hex(_ data: Data) -> String { return hex(SHA256.hash(data: data)) }

    static func key(_ secret: String) -> SymmetricKey {
        return SymmetricKey(data: Data(secret.utf8))
    }

    static func hmacHex(secret: String, message: String) -> String {
        return hex(HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key(secret)))
    }

    static func requestString(method: String, path: String, ts: String, nonce: String, body: Data) -> String {
        return ["lahe-proof-v1", method, path, ts, nonce, sha256Hex(body)].joined(separator: "\n")
    }

    static func replyString(nonce: String, status: Int, body: Data) -> String {
        return ["lahe-proof-reply-v1", nonce, String(status), sha256Hex(body)].joined(separator: "\n")
    }

    static func newNonce() -> String {
        return SymmetricKey(size: .bits128).withUnsafeBytes { hex($0) }
    }

    static func fromHex(_ text: String) -> Data? {
        guard text.count % 2 == 0, text.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { return nil }
        var data = Data(capacity: text.count / 2)
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(index, offsetBy: 2)
            guard let byte = UInt8(text[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }

    /// Does the reply header check? CryptoKit compares in constant time.
    static func replyChecks(secret: String, nonce: String, status: Int, body: Data, header: String?) -> Bool {
        guard let header = header, let mac = fromHex(header), mac.count == 32 else { return false }
        let message = Data(replyString(nonce: nonce, status: status, body: body).utf8)
        return HMAC<SHA256>.isValidAuthenticationCode(mac, authenticating: message, using: key(secret))
    }
}

// MARK: - Opening addresses (SR4 allowlist)

let reservedSiteNames: Set<String> = ["lahe", "www", "api"]

/// One DNS label as Lahe makes them (src/shared/protocol.js isSiteLabel).
func isSiteLabel(_ label: Substring) -> Bool {
    guard !label.isEmpty, label.count <= 63 else { return false }
    let allowed = label.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
    if !allowed || label.hasPrefix("-") || label.hasSuffix("-") || label.contains("--") { return false }
    return !label.hasPrefix("xn--")
}

/// One to four labels, at most 150 characters (protocol.js isSiteName).
func isSiteName(_ name: String) -> Bool {
    guard !name.isEmpty, name.count <= 150 else { return false }
    let labels = name.split(separator: ".", omittingEmptySubsequences: false)
    return labels.count <= 4 && labels.allSatisfy(isSiteLabel)
}

/// The address to open, rebuilt from its parsed parts, or nil when it is not a
/// Lahe address. Only plain http on library.lahe.localhost or <site>.lahe.localhost,
/// no user or password, and a port that is absent or the pages port.
func allowedURL(_ text: String, pagesPort: Int?) -> URL? {
    guard let parts = URLComponents(string: text),
          parts.scheme?.lowercased() == "http",
          parts.user == nil, parts.password == nil,
          let rawHost = parts.percentEncodedHost else { return nil }
    let host = rawHost.lowercased()
    let suffix = ".lahe.localhost"
    guard host.hasSuffix(suffix) else { return nil }
    let name = String(host.dropLast(suffix.count))
    guard name == "library" || (isSiteName(name) && !reservedSiteNames.contains(name)) else { return nil }
    if let port = parts.port, port != pagesPort { return nil }
    var rebuilt = URLComponents()
    rebuilt.scheme = "http"
    rebuilt.percentEncodedHost = host
    rebuilt.port = parts.port
    rebuilt.percentEncodedPath = parts.percentEncodedPath.isEmpty ? "/" : parts.percentEncodedPath
    rebuilt.percentEncodedQuery = parts.percentEncodedQuery
    rebuilt.percentEncodedFragment = parts.percentEncodedFragment
    return rebuilt.url
}

// MARK: - Formatting

/// The icon's number: nil for none, then 1 to 99, then "99+".
func countText(_ count: Int) -> String? {
    if count <= 0 { return nil }
    return count > 99 ? "99+" : String(count)
}

/// Page-derived text as menu text: control and format characters removed (the
/// helper already strips them; this keeps a bidirectional override from
/// reordering a row if one ever gets through).
func plain(_ text: String) -> String {
    let kept = text.unicodeScalars.filter { scalar in
        let category = scalar.properties.generalCategory
        return category != .control && category != .format
    }
    return String(String.UnicodeScalarView(kept))
}

/// A row title: plain, and cut with an ellipsis. The tooltip has the full name.
func cut(_ title: String) -> String {
    let text = plain(title)
    return text.count <= titleLimit ? text : String(text.prefix(titleLimit - 1)) + "\u{2026}"
}

func plural(_ n: Int, _ word: String) -> String { return "\(n) \(word)" + (n == 1 ? "" : "s") }

let isoWithFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()
let isoPlain = ISO8601DateFormatter()

func parseTime(_ text: String) -> Date? {
    return isoWithFraction.date(from: text) ?? isoPlain.date(from: text)
}

func isoNow() -> String { return isoWithFraction.string(from: Date()) }

/// "10 sec ago", measured against the summary's own generated_at so a menu
/// always describes one moment, the one the helper answered for.
func heardAgo(_ heard: String, now: String) -> String {
    guard let then = parseTime(heard), let at = parseTime(now) else { return "at an unknown time" }
    let seconds = max(0, Int(at.timeIntervalSince(then)))
    if seconds < 60 { return "\(seconds) sec ago" }
    if seconds < 3600 { return "\(seconds / 60) min ago" }
    if seconds < 86400 { return "\(seconds / 3600) hr ago" }
    return plural(seconds / 86400, "day") + " ago"
}

func clockTime(_ iso: String) -> String {
    guard let date = parseTime(iso) else { return "an unknown time" }
    let time = DateFormatter()
    time.setLocalizedDateFormatFromTemplate("jmm")
    if Calendar.current.isDateInToday(date) { return time.string(from: date) }
    let day = DateFormatter()
    day.setLocalizedDateFormatFromTemplate("MMMd")
    return time.string(from: date) + " on " + day.string(from: date)
}

/// "1 question", "3 unread", or both. unread counts questions too.
func waitingReason(_ doc: Summary.WaitingDoc) -> String {
    var parts: [String] = []
    if doc.questions > 0 { parts.append(plural(doc.questions, "question")) }
    if doc.unread > doc.questions || parts.isEmpty { parts.append("\(doc.unread) unread") }
    return parts.joined(separator: ", ")
}

// MARK: - What the app knows, and how it looks

struct Stopped { let at: String? }

enum Status {
    case summary(Summary)
    case notRunning
    case cantTell(String)
}

enum Look: Equatable {
    case clear, count(String), notRunning, cantTell
    var name: String {
        switch self {
        case .clear: return "clear"
        case .count: return "count"
        case .notRunning: return "not-running"
        case .cantTell: return "cant-tell"
        }
    }
    var text: String? {
        switch self {
        case .count(let text): return text
        case .cantTell: return "?"
        default: return nil
        }
    }
}

func look(of status: Status) -> Look {
    switch status {
    case .summary(let summary):
        if let text = countText(summary.waitingOnYou.count) { return .count(text) }
        return .clear
    case .notRunning: return .notRunning
    case .cantTell: return .cantTell
    }
}

let updatedReason = "Lahe was updated; rebuilding"

// MARK: - The menu, as plain rows (so --dump-menu prints exactly what is shown)

enum RowAction: Equatable {
    case none, openReview(String), openLibrary, hide, stop, start
    var name: String? {
        switch self {
        case .none: return nil
        case .openReview(let review): return "open " + review
        case .openLibrary: return "open library"
        case .hide: return "hide"
        case .stop: return "stop"
        case .start: return "start"
        }
    }
}

struct Row: Equatable {
    enum Kind: String { case header, item, note, separator }
    var kind: Kind
    var title: String = ""
    var tooltip: String? = nil
    var action: RowAction = .none
    var enabled: Bool { return kind == .item }

    static let separator = Row(kind: .separator)
    static func header(_ title: String) -> Row { return Row(kind: .header, title: title) }
    static func note(_ title: String, _ tooltip: String? = nil) -> Row { return Row(kind: .note, title: title, tooltip: tooltip) }
    static func item(_ title: String, _ action: RowAction, _ tooltip: String? = nil) -> Row {
        return Row(kind: .item, title: title, tooltip: tooltip, action: action)
    }
}

func tip(_ title: String, _ path: String, _ extra: String? = nil) -> String {
    return [plain(title), plain(path), extra].compactMap { $0 }.joined(separator: "\n")
}

func moreRow(_ more: Int) -> [Row] {
    return more > 0 ? [.note("\(more) more", "The Library lists every one.")] : []
}

/// The brief's order: waiting on you, waiting on agents, open and connected,
/// recent, the Library, then Quit.
func menuRows(status: Status, stopped: Stopped?, libraryURL: String?) -> [Row] {
    var rows: [Row] = []
    let hideRow = Row.item("Hide the icon", .hide,
                           "Closes this icon only. Lahe keeps running. `lahe menubar show` brings it back.")
    let startRow = Row.item("Start Lahe", .start, "Starts the Lahe helper again.")

    switch status {
    case .notRunning:
        if let stopped = stopped {
            rows.append(.note("Stopped by you at " + (stopped.at.map(clockTime) ?? "an unknown time")))
        } else {
            rows.append(.note("Lahe is not running"))
        }
        rows += [startRow, .separator, hideRow]
        return rows

    case .cantTell(let reason):
        rows.append(.header("Can't tell what is waiting"))
        rows.append(.note(reason))
        rows.append(.separator)

    case .summary(let s):
        let you = s.waitingOnYou
        rows.append(.header(you.count > 0 ? "Waiting on you: \(you.count)" : "Nothing is waiting on you"))
        for doc in you.documents {
            let reason = (doc.open ? "open, " : "") + waitingReason(doc)
            rows.append(.item("\(cut(doc.title)) (\(reason))", .openReview(doc.review),
                              tip(doc.title, doc.pathHint, doc.open ? "Open in a browser window now." : nil)))
        }
        rows.append(.separator)

        let agents = s.waitingOnAgents
        rows.append(.header(agents.count > 0
            ? "Your comments waiting on agents: \(agents.count)"
            : "No comments waiting on agents"))
        for doc in agents.documents {
            rows.append(.item("\(cut(doc.title)) (\(doc.waiting) waiting)", .openReview(doc.review),
                              tip(doc.title, doc.pathHint)))
        }
        rows += moreRow(agents.more)
        rows.append(.separator)

        let open = s.openDocuments
        rows.append(.header(open.count > 0 ? "Open documents: \(open.count)" : "No open documents"))
        for doc in open.items {
            rows.append(.item(cut(doc.title) + (doc.focused ? " (focused)" : ""), .openReview(doc.review),
                              tip(doc.title, doc.pathHint)))
        }
        rows += moreRow(open.more)

        let connected = s.sessions.connected
        rows.append(.header(connected.count > 0
            ? "Connected sessions: \(connected.count) (\(s.sessions.open) open)"
            : "No connected sessions (\(s.sessions.open) open)"))
        for session in connected.items {
            let heard = heardAgo(session.lastHeardAt, now: s.generatedAt)
            let title = "\(cut(session.name)) (\(session.presence), last heard \(heard))"
            if let review = session.review {
                rows.append(.item(title, .openReview(review), tip(session.name, session.session, "Opens its most recent document.")))
            } else {
                rows.append(.item(title, .openLibrary, tip(session.name, session.session, "No document yet; opens the Library.")))
            }
        }
        rows += moreRow(connected.more)
        rows.append(.separator)

        rows.append(.header("Recent documents"))
        for doc in s.recent.items {
            rows.append(.item(cut(doc.title), .openReview(doc.review), tip(doc.title, doc.pathHint)))
        }
        rows += moreRow(s.recent.more)
    }

    if libraryURL != nil {
        rows.append(.item("Open the Library", .openLibrary, "Every review, in the browser."))
    }
    rows.append(.separator)
    rows.append(hideRow)
    rows.append(.item("Stop Lahe", .stop, "Stops the Lahe helper until you start it again."))
    rows.append(.note("Agents' lahe commands will fail until you start it again"))
    return rows
}

// MARK: - The icon, drawn in code

// The review layer's speech-bubble mark, in its 32 by 32 viewBox (the tab icon
// in src/service/tab_icon.js before it became a document, commit e5397fda):
//   M9 8h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6l-6 5v-5H9a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z
// It spans x 6 to 26 and y 8 to 27; drawn here in a flipped (y down) space.
func bubblePath(scale s: CGFloat, origin o: CGPoint) -> NSBezierPath {
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { return NSPoint(x: o.x + (x - 6) * s, y: o.y + (y - 8) * s) }
    let path = NSBezierPath()
    path.move(to: p(9, 8))
    path.line(to: p(23, 8))
    path.appendArc(from: p(26, 8), to: p(26, 11), radius: 3 * s)
    path.line(to: p(26, 19))
    path.appendArc(from: p(26, 22), to: p(23, 22), radius: 3 * s)
    path.line(to: p(17, 22))
    path.line(to: p(11, 27))
    path.line(to: p(11, 22))
    path.line(to: p(9, 22))
    path.appendArc(from: p(6, 22), to: p(6, 19), radius: 3 * s)
    path.line(to: p(6, 11))
    path.appendArc(from: p(6, 8), to: p(9, 8), radius: 3 * s)
    path.close()
    return path
}

let iconHeight: CGFloat = 18
let bubbleScale: CGFloat = 15.0 / 19.0  // the mark's 19 units become 15 points
let iconFont = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)

/// The four looks as one template image, so macOS colors it for a light, dark
/// or highlighted menu bar. The count (or "?") is part of the image, so the
/// snapshot draws exactly what the menu bar shows.
///   clear        the filled mark
///   count        the filled mark and the number
///   not running  the mark as an outline, struck through
///   can't tell   the outline and a question mark, never the plain mark
func iconImage(_ look: Look) -> NSImage {
    let bubbleWidth = 20 * bubbleScale
    let text = look.text
    let attrs: [NSAttributedString.Key: Any] = [.font: iconFont, .foregroundColor: NSColor.black]
    let textSize = text.map { ($0 as NSString).size(withAttributes: attrs) } ?? .zero
    let gap: CGFloat = text == nil ? 0 : 3
    let width = ceil(1 + bubbleWidth + gap + textSize.width + 1)
    let image = NSImage(size: NSSize(width: width, height: iconHeight), flipped: true) { _ in
        let origin = CGPoint(x: 1, y: (iconHeight - 19 * bubbleScale) / 2)
        let path = bubblePath(scale: bubbleScale, origin: origin)
        NSColor.black.set()
        switch look {
        case .clear, .count:
            path.fill()
        case .notRunning, .cantTell:
            path.lineWidth = 1.4
            path.stroke()
        }
        if look == .notRunning {
            let slash = NSBezierPath()
            slash.move(to: NSPoint(x: origin.x - 0.5, y: origin.y + 15.5))
            slash.line(to: NSPoint(x: origin.x + bubbleWidth + 0.5, y: origin.y - 0.5))
            slash.lineWidth = 1.6
            slash.lineCapStyle = .round
            slash.stroke()
        }
        if let text = text {
            let y = (iconHeight - textSize.height) / 2
            (text as NSString).draw(at: NSPoint(x: 1 + bubbleWidth + gap, y: y), withAttributes: attrs)
        }
        return true
    }
    image.isTemplate = true
    return image
}

// MARK: - The log (menubar.log in the state folder)

final class Log {
    let url: URL?
    private var lastWritten: [String: Date] = [:]
    init(stateDir: URL?) { url = stateDir?.appendingPathComponent("menubar.log") }

    /// A repeating error is written at most once a minute per key.
    func write(_ key: String, _ message: String) {
        let now = Date()
        if let last = lastWritten[key], now.timeIntervalSince(last) < 60 { return }
        lastWritten[key] = now
        guard let url = url else { return }
        let line = Data((isoNow() + " " + message + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(line)
            try? handle.close()
        } else {
            try? line.write(to: url)
        }
    }
}

// MARK: - Talking to the helper

struct ServiceInfo { let port: Int; let pagesPort: Int? }

enum Answer {
    case verified(status: Int, body: Data)
    case refused            // nothing listening: the helper is not running
    case failed(String)     // can't tell, with the reason
}

final class HelperClient: NSObject, URLSessionTaskDelegate {
    let stateDir: URL
    let log: Log
    private var secret: String?
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = requestTimeout
        config.connectionProxyDictionary = [:]
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue.main)
    }()

    init(stateDir: URL, log: Log) {
        self.stateDir = stateDir
        self.log = log
    }

    func service() -> ServiceInfo? {
        guard let data = try? Data(contentsOf: stateDir.appendingPathComponent("service.json")),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let port = json["port"] as? Int, port > 0, port < 65536 else { return nil }
        let pages = (json["pages"] as? [String: Any])?["port"] as? Int
        return ServiceInfo(port: port, pagesPort: pages)
    }

    private func readSecret() -> String? {
        guard let data = try? Data(contentsOf: stateDir.appendingPathComponent("cli-secret")),
              let text = String(data: data, encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Never follow a redirect: an answer from anywhere but the helper is dropped.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func send(method: String, path: String, body: Data, completion: @escaping (Answer) -> Void) {
        guard let service = service(),
              let url = URL(string: "http://127.0.0.1:\(service.port)" + path) else {
            completion(.refused)
            return
        }
        if secret == nil { secret = readSecret() }
        guard let key = secret else {
            log.write("secret", "cannot read cli-secret in " + stateDir.path)
            completion(.failed("Cannot read Lahe's secret file"))
            return
        }
        let ts = String(Int64(Date().timeIntervalSince1970 * 1000))
        let nonce = Proof.newNonce()
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue(ts, forHTTPHeaderField: "x-lahe-proof-ts")
        request.setValue(nonce, forHTTPHeaderField: "x-lahe-proof-nonce")
        request.setValue(Proof.hmacHex(secret: key, message: Proof.requestString(method: method, path: path, ts: ts, nonce: nonce, body: body)),
                         forHTTPHeaderField: "x-lahe-proof")
        if method == "POST" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            if let error = error as? URLError {
                if error.code == .cannotConnectToHost || error.code == .cannotFindHost {
                    completion(.refused)
                } else {
                    let reason = error.code == .timedOut ? "Lahe did not answer in time" : "Lahe's answer failed"
                    self.log.write("net:\(error.code.rawValue)", reason + ": " + error.localizedDescription)
                    completion(.failed(reason))
                }
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failed("Lahe's answer failed"))
                return
            }
            let bytes = data ?? Data()
            let header = http.value(forHTTPHeaderField: "x-lahe-proof-reply")
            guard Proof.replyChecks(secret: key, nonce: nonce, status: http.statusCode, body: bytes, header: header) else {
                // The key may have changed under us; read it again for the next poll.
                self.secret = nil
                self.log.write("signature", "dropped an answer whose x-lahe-proof-reply did not check (status \(http.statusCode))")
                completion(.failed("An answer on Lahe's port was not signed by Lahe"))
                return
            }
            if http.statusCode == 401 { self.secret = nil }
            completion(.verified(status: http.statusCode, body: bytes))
        }.resume()
    }
}

// MARK: - The poll loop, shared by the icon and --watch

final class Controller {
    let stateDir: URL
    let log: Log
    let client: HelperClient
    private(set) var status: Status = .cantTell("Asking Lahe")
    private(set) var libraryURL: String?
    private var generation = 0      // bumped by a wake; older answers are ignored
    private var inFlight = false
    private var timer: Timer?
    var onChange: (() -> Void)?

    init(stateDir: URL) {
        self.stateDir = stateDir
        log = Log(stateDir: stateDir)
        client = HelperClient(stateDir: stateDir, log: log)
    }

    var stoppedURL: URL { return stateDir.appendingPathComponent("stopped.json") }

    func stopped() -> Stopped? {
        guard let data = try? Data(contentsOf: stoppedURL) else { return nil }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return Stopped(at: json?["at"] as? String)
    }

    func start() {
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
                                                          object: nil, queue: .main) { [weak self] _ in
            self?.woke()
        }
        let timer = Timer(timeInterval: pollSeconds, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer, forMode: .common)  // keeps firing while the menu is open
        self.timer = timer
        poll()
    }

    /// After a wake, "can't tell" until an answer to a request sent after it.
    func woke() {
        generation += 1
        inFlight = false
        set(.cantTell("The Mac just woke"))
        poll()
    }

    func poll() {
        if inFlight { return }
        inFlight = true
        let asked = generation
        client.send(method: "GET", path: "/lahe/v1/summary?v=\(builtSummaryVersion)", body: Data()) { [weak self] answer in
            guard let self = self, asked == self.generation else { return }
            self.inFlight = false
            self.set(self.status(for: answer))
        }
    }

    private func status(for answer: Answer) -> Status {
        switch answer {
        case .refused:
            return .notRunning
        case .failed(let reason):
            return .cantTell(reason)
        case .verified(let code, let body):
            if code == 200, let summary = Summary.decode(body) {
                libraryURL = summary.libraryUrl
                return .summary(summary)
            }
            if code == 200 {
                log.write("decode", "could not read the summary answer")
                return .cantTell("Could not read Lahe's answer")
            }
            if code == 409 {
                log.write("version", "the helper answers another summary_version")
                return .cantTell(updatedReason)
            }
            log.write("status:\(code)", "summary.read answered \(code)")
            return .cantTell(code == 401 ? "Lahe refused the request" : "Lahe answered \(code)")
        }
    }

    private func set(_ next: Status) {
        status = next
        onChange?()
    }

    func rows() -> [Row] {
        return menuRows(status: status, stopped: stopped(), libraryURL: libraryURL ?? fallbackLibrary())
    }

    /// Before the first answer, the Library at the pages port service.json names.
    private func fallbackLibrary() -> String? {
        guard case .cantTell = status, let pages = client.service()?.pagesPort else { return nil }
        return "http://library.lahe.localhost:\(pages)/catalog"
    }

    // MARK: Actions

    func perform(_ action: RowAction, done: @escaping () -> Void = {}) {
        switch action {
        case .none: done()
        case .hide: exit(0)
        case .stop: stopHelper(); done()
        case .start: startHelper(); done()
        case .openLibrary: openLibrary(); done()
        case .openReview(let review): openReview(review, done: done)
        }
    }

    /// Test builds print the address instead of opening a browser window.
    private func openInBrowser(_ url: URL) {
        #if LAHE_TEST_LABELS
        print("opened " + url.absoluteString)
        fflush(stdout)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }

    private func openLibrary() {
        guard let text = libraryURL ?? fallbackLibrary(),
              let url = allowedURL(text, pagesPort: client.service()?.pagesPort) else {
            log.write("library-url", "refused to open the Library address")
            return
        }
        openInBrowser(url)
    }

    private func openReview(_ review: String, done: @escaping () -> Void) {
        let body = (try? JSONSerialization.data(withJSONObject: ["review": review, "summary_version": builtSummaryVersion])) ?? Data()
        client.send(method: "POST", path: "/lahe/v1/summary/open", body: body) { [weak self] answer in
            defer { done() }
            guard let self = self else { return }
            guard case .verified(200, let data) = answer,
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  json.keys.contains("url") else {
                self.log.write("open", "summary.open failed for \(review)")
                return
            }
            guard let text = json["url"] as? String else {
                self.openLibrary()  // url: null, a document only an agent can serve
                return
            }
            guard let url = allowedURL(text, pagesPort: self.client.service()?.pagesPort) else {
                self.log.write("open-url", "refused to open an address that is not a Lahe address")
                return
            }
            self.openInBrowser(url)
        }
    }

    /// Stop holds: the marker first, so nothing restarts the helper in between,
    /// then unload the login item (a plain kill would be restarted at once).
    private func stopHelper() {
        let marker: [String: Any] = ["by": "menu bar", "at": isoNow()]
        do {
            let data = try JSONSerialization.data(withJSONObject: marker, options: [.sortedKeys])
            try data.write(to: stoppedURL, options: .atomic)
        } catch {
            log.write("stop", "could not write stopped.json: \(error.localizedDescription)")
            return
        }
        launchctl(["bootout", "gui/\(getuid())/\(HelperJob.label)"])
        set(.notRunning)
        poll()
    }

    /// Start: remove the marker, load the item, start it. No contents check of
    /// the plist (architecture, "Install, rebuild, and Quit").
    private func startHelper() {
        if FileManager.default.fileExists(atPath: stoppedURL.path) {
            do { try FileManager.default.removeItem(at: stoppedURL) } catch {
                log.write("start", "could not remove stopped.json: \(error.localizedDescription)")
                return
            }
        }
        // bootstrap fails when the item is already loaded; kickstart still starts it.
        launchctl(["bootstrap", "gui/\(getuid())", HelperJob.plistPath(stateDir: stateDir)], quietFailure: true)
        launchctl(["kickstart", "gui/\(getuid())/\(HelperJob.label)"])
        poll()
    }

    private func launchctl(_ arguments: [String], quietFailure: Bool = false) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            if process.terminationStatus != 0 && !quietFailure {
                log.write("launchctl:" + arguments[0], "launchctl \(arguments.joined(separator: " ")) exited \(process.terminationStatus)")
            }
        } catch {
            log.write("launchctl:" + arguments[0], "could not run launchctl: \(error.localizedDescription)")
        }
    }
}

// MARK: - The menu bar icon

/// A row's action, carried on its own menu item. A poll can rebuild the menu
/// while it is open, so a click must never look its action up by position.
final class ActionBox: NSObject {
    let action: RowAction
    init(_ action: RowAction) { self.action = action }
}

final class MenuBarApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let controller: Controller
    var statusItem: NSStatusItem?
    let menu = NSMenu()
    private var shownLook: Look?
    private var shownRows: [Row] = []

    init(controller: Controller) { self.controller = controller }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        statusItem = item
        controller.onChange = { [weak self] in self?.redraw() }
        redraw()
        controller.start()
    }

    func menuWillOpen(_ menu: NSMenu) { controller.poll() }

    /// Redraws only what changed, so an idle poll costs no drawing.
    func redraw() {
        let current = look(of: controller.status)
        if current != shownLook {
            shownLook = current
            statusItem?.button?.image = iconImage(current)
            statusItem?.button?.setAccessibilityLabel(accessibilityText(current))
        }
        let rows = controller.rows()
        if rows == shownRows { return }
        shownRows = rows
        menu.removeAllItems()
        for row in rows {
            if row.kind == .separator {
                menu.addItem(.separator())
                continue
            }
            let item = NSMenuItem(title: row.title, action: row.enabled ? #selector(clicked(_:)) : nil, keyEquivalent: "")
            item.target = self
            item.isEnabled = row.enabled
            item.toolTip = row.tooltip
            item.representedObject = ActionBox(row.action)
            menu.addItem(item)
        }
    }

    @objc func clicked(_ sender: NSMenuItem) {
        guard let box = sender.representedObject as? ActionBox else { return }
        controller.perform(box.action)
    }
}

func accessibilityText(_ look: Look) -> String {
    switch look {
    case .clear: return "Lahe: nothing waiting"
    case .count(let text): return "Lahe: \(text) waiting on you"
    case .notRunning: return "Lahe is not running"
    case .cantTell: return "Lahe: can't tell"
    }
}

// MARK: - Debug modes

func argument(_ name: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func arguments(_ name: String, in args: [String]) -> [String] {
    var found: [String] = []
    for (index, arg) in args.enumerated() where arg == name && index + 1 < args.count { found.append(args[index + 1]) }
    return found
}

func printJSON(_ object: Any) {
    let options: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    if let data = try? JSONSerialization.data(withJSONObject: object, options: options),
       let text = String(data: data, encoding: .utf8) { print(text) }
}

func rowJSON(_ row: Row) -> [String: Any] {
    var out: [String: Any] = ["kind": row.kind.rawValue]
    if row.kind == .separator { return out }
    out["title"] = row.title
    out["enabled"] = row.enabled
    if let tooltip = row.tooltip { out["tooltip"] = tooltip }
    if let action = row.action.name { out["action"] = action }
    return out
}

func lookJSON(_ look: Look) -> [String: Any] {
    var out: [String: Any] = ["look": look.name]
    if let text = look.text { out["text"] = text }
    return out
}

/// A dump or snapshot state: a summary file, or one of the looks with no summary.
func debugStatus(summaryPath: String?, lookName: String?) -> (Status, Stopped?)? {
    switch lookName {
    case "not-running": return (.notRunning, nil)
    case "stopped": return (.notRunning, Stopped(at: "2026-10-20T15:41:00.000Z"))
    case "cant-tell": return (.cantTell("Lahe did not answer in time"), nil)
    case "updated": return (.cantTell(updatedReason), nil)
    case nil: break
    default: return nil
    }
    guard let path = summaryPath, let data = FileManager.default.contents(atPath: path),
          let summary = Summary.decode(data) else { return nil }
    return (.summary(summary), nil)
}

func dumpMenu(_ args: [String]) -> Int32 {
    let path = argument("--dump-menu", in: args)
    guard let (status, stopped) = debugStatus(summaryPath: path == "none" ? nil : path, lookName: argument("--look", in: args)) else {
        FileHandle.standardError.write(Data("could not read the summary or the look\n".utf8))
        return 1
    }
    var library: String? = nil
    if case .summary(let s) = status { library = s.libraryUrl }
    if case .cantTell = status { library = "http://library.lahe.localhost:1483/catalog" }
    let rows = menuRows(status: status, stopped: stopped, libraryURL: library)
    var out = lookJSON(look(of: status))
    out["rows"] = rows.map(rowJSON)
    printJSON(out)
    return 0
}

// MARK: Snapshots

func renderPNG(size: NSSize, to url: URL, draw: () -> Void) throws {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2),
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
        throw NSError(domain: "lahe", code: 1)
    }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { throw NSError(domain: "lahe", code: 2) }
    try png.write(to: url)
}

/// A template image tinted the way the menu bar would draw it.
func tinted(_ image: NSImage, _ color: NSColor) -> NSImage {
    let out = NSImage(size: image.size, flipped: false) { rect in
        image.draw(in: rect)
        color.set()
        rect.fill(using: .sourceAtop)
        return true
    }
    return out
}

struct Palette {
    let bar: NSColor, ink: NSColor, panel: NSColor, text: NSColor, dim: NSColor, rule: NSColor
    static let light = Palette(bar: NSColor(white: 0.93, alpha: 1), ink: .black, panel: NSColor(white: 0.97, alpha: 1),
                               text: NSColor(white: 0.1, alpha: 1), dim: NSColor(white: 0.5, alpha: 1), rule: NSColor(white: 0.85, alpha: 1))
    static let dark = Palette(bar: NSColor(white: 0.13, alpha: 1), ink: .white, panel: NSColor(white: 0.18, alpha: 1),
                              text: NSColor(white: 0.93, alpha: 1), dim: NSColor(white: 0.55, alpha: 1), rule: NSColor(white: 0.3, alpha: 1))
}

func drawIconStrip(_ look: Look, palette: Palette, in rect: NSRect) {
    palette.bar.setFill()
    rect.fill()
    let image = tinted(iconImage(look), palette.ink)
    let origin = NSPoint(x: rect.maxX - image.size.width - 12, y: rect.midY - image.size.height / 2)
    image.draw(at: origin, from: .zero, operation: .sourceOver, fraction: 1)
}

/// A drawing of the open menu from the same rows the real menu uses. The real
/// menu cannot be captured without a screen recording permission.
func drawMenuPicture(rows: [Row], look: Look, palette: Palette, size: NSSize) {
    let barHeight: CGFloat = 26
    drawIconStrip(look, palette: palette, in: NSRect(x: 0, y: size.height - barHeight, width: size.width, height: barHeight))
    palette.panel.setFill()
    NSRect(x: 0, y: 0, width: size.width, height: size.height - barHeight).fill()
    var y = size.height - barHeight - 8
    for row in rows {
        if row.kind == .separator {
            y -= 6
            palette.rule.setFill()
            NSRect(x: 10, y: y, width: size.width - 20, height: 1).fill()
            y -= 6
            continue
        }
        let font = row.kind == .header ? NSFont.systemFont(ofSize: 11, weight: .semibold) : NSFont.systemFont(ofSize: 13)
        let color = row.kind == .item ? palette.text : palette.dim
        y -= 20
        (row.title as NSString).draw(at: NSPoint(x: 14, y: y + 3), withAttributes: [.font: font, .foregroundColor: color])
    }
}

func menuPictureHeight(_ rows: [Row]) -> CGFloat {
    return 26 + 16 + rows.reduce(0) { $0 + ($1.kind == .separator ? 12 : 20) }
}

func snapshot(_ args: [String]) -> Int32 {
    guard let dir = argument("--snapshot", in: args) else { return 1 }
    let out = URL(fileURLWithPath: dir)
    try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let looks: [(String, Look)] = [("clear", .clear), ("count_3", .count("3")), ("count_99plus", .count("99+")),
                                   ("not_running", .notRunning), ("cant_tell", .cantTell)]
    var written: [String] = []
    do {
        for (name, current) in looks {
            for (theme, palette) in [("light", Palette.light), ("dark", Palette.dark)] {
                let file = "icon_\(name)_\(theme).png"
                try renderPNG(size: NSSize(width: 96, height: 26), to: out.appendingPathComponent(file)) {
                    drawIconStrip(current, palette: palette, in: NSRect(x: 0, y: 0, width: 96, height: 26))
                }
                written.append(file)
            }
        }
        var menus: [(String, Status, Stopped?)] = []
        for path in arguments("--summary", in: args) {
            guard let data = FileManager.default.contents(atPath: path), let summary = Summary.decode(data) else {
                FileHandle.standardError.write(Data("could not read \(path)\n".utf8))
                return 1
            }
            let name = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
            menus.append((name, .summary(summary), nil))
        }
        if !menus.isEmpty {
            menus.append(("not_running", .notRunning, nil))
            menus.append(("stopped", .notRunning, Stopped(at: "2026-10-20T15:41:00.000Z")))
            menus.append(("cant_tell_updated", .cantTell(updatedReason), nil))
        }
        for (name, status, stopped) in menus {
            var library: String? = "http://library.lahe.localhost:1483/catalog"
            if case .summary(let s) = status { library = s.libraryUrl }
            let rows = menuRows(status: status, stopped: stopped, libraryURL: library)
            for (theme, palette) in [("light", Palette.light), ("dark", Palette.dark)] {
                let file = "menu_\(name)_\(theme).png"
                let size = NSSize(width: 420, height: menuPictureHeight(rows))
                try renderPNG(size: size, to: out.appendingPathComponent(file)) {
                    drawMenuPicture(rows: rows, look: look(of: status), palette: palette, size: size)
                }
                written.append(file)
            }
        }
    } catch {
        FileHandle.standardError.write(Data("snapshot failed: \(error)\n".utf8))
        return 1
    }
    written.forEach { print($0) }
    return 0
}

// MARK: Self-test

final class SelfTest {
    var failures = 0
    var passes = 0
    func check(_ ok: Bool, _ name: String) {
        if ok { passes += 1 } else { failures += 1; print("FAIL " + name) }
    }
}

func selfTest(_ args: [String]) -> Int32 {
    let t = SelfTest()

    // The allowlist (V30). The pages port here is 1483.
    let rejected = [
        "javascript:alert(1)", "file:///etc/passwd", "https://library.lahe.localhost/",
        "http://user@library.lahe.localhost/", "http://user:pw@notes.lahe.localhost/",
        "http://localhost:1483/", "http://127.0.0.1:1483/", "http://notes.lahe:1483/",
        "http://notes.lahe.localhost:9999/", "http://library.lahe.localhost:80/",
        "http://lahe.localhost/", "http://notes.lahe.localhost.evil.example/",
        "http://evil.example/notes.lahe.localhost", "http://-bad.lahe.localhost/",
        "http://a--b.lahe.localhost/", "http://xn--abc.lahe.localhost/", "http://www.lahe.localhost/",
        "http://api.lahe.localhost/", "http://lahe.lahe.localhost/", "http://a.b.c.d.e.lahe.localhost/",
        "http://%6cibrary.lahe.localhost/", "http://notes..lahe.localhost/", "http://notes.lahe.localhost./",
        "http://no_underscore.lahe.localhost/", "data:text/html,hi", "", "not a url",
    ]
    for text in rejected { t.check(allowedURL(text, pagesPort: 1483) == nil, "allowlist rejects " + text) }
    let accepted: [(String, String)] = [
        ("http://library.lahe.localhost/", "http://library.lahe.localhost/"),
        ("http://library.lahe.localhost:1483", "http://library.lahe.localhost:1483/"),
        ("http://notes.lahe.localhost/doc_0.md", "http://notes.lahe.localhost/doc_0.md"),
        ("http://my-site.docs.lahe.localhost:1483/a/b.html?x=1#y", "http://my-site.docs.lahe.localhost:1483/a/b.html?x=1#y"),
        ("http://Notes.LAHE.localhost/A%20B.md", "http://notes.lahe.localhost/A%20B.md"),
    ]
    for (text, expected) in accepted {
        t.check(allowedURL(text, pagesPort: 1483)?.absoluteString == expected, "allowlist accepts \(text) as \(expected)")
    }
    t.check(allowedURL("http://notes.lahe.localhost:1483/", pagesPort: nil) == nil, "no pages port means no port allowed")

    // Count formatting.
    let counts: [(Int, String?)] = [(0, nil), (-1, nil), (1, "1"), (3, "3"), (99, "99"), (100, "99+"), (120, "99+")]
    for (n, expected) in counts { t.check(countText(n) == expected, "count \(n)") }
    t.check(look(of: .cantTell("x")) != .clear && look(of: .cantTell("x")).text == "?", "can't tell is never the plain mark")
    t.check(cut(String(repeating: "a", count: 80)).count == titleLimit, "long titles are cut")
    t.check(cut("Title \u{202E}here\u{202C} and\u{0007} back") == "Title here and back", "control and format characters are removed")

    // The proof vectors.
    var vectorsPath = argument("--vectors", in: args)
    if vectorsPath == nil {
        let guess = FileManager.default.currentDirectoryPath + "/test/fixtures/menubar/proof_vectors.json"
        if FileManager.default.fileExists(atPath: guess) { vectorsPath = guess }
    }
    if let path = vectorsPath, let data = FileManager.default.contents(atPath: path),
       let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
       let secret = json["secret"] as? String,
       let requests = json["requests"] as? [[String: Any]], let replies = json["replies"] as? [[String: Any]] {
        for r in requests {
            let name = r["name"] as? String ?? "?"
            let body = Data((r["body"] as? String ?? "").utf8)
            let signed = Proof.requestString(method: r["method"] as? String ?? "", path: r["path"] as? String ?? "",
                                             ts: r["ts"] as? String ?? "", nonce: r["nonce"] as? String ?? "", body: body)
            t.check(Proof.sha256Hex(body) == r["body_sha256"] as? String, "request body hash: " + name)
            t.check(signed == r["signed_string"] as? String, "request signed string: " + name)
            t.check(Proof.hmacHex(secret: secret, message: signed) == r["proof"] as? String, "request proof: " + name)
            let headers = r["headers"] as? [String: String] ?? [:]
            t.check(headers["x-lahe-proof"] == r["proof"] as? String, "request header: " + name)
        }
        for r in replies {
            let name = r["name"] as? String ?? "?"
            let body = Data((r["body"] as? String ?? "").utf8)
            let nonce = r["nonce"] as? String ?? ""
            let status = r["status"] as? Int ?? 0
            let proof = r["proof"] as? String
            let signed = Proof.replyString(nonce: nonce, status: status, body: body)
            t.check(Proof.sha256Hex(body) == r["body_sha256"] as? String, "reply body hash: " + name)
            t.check(signed == r["signed_string"] as? String, "reply signed string: " + name)
            t.check(Proof.hmacHex(secret: secret, message: signed) == proof, "reply proof: " + name)
            t.check(Proof.replyChecks(secret: secret, nonce: nonce, status: status, body: body, header: proof), "reply checks: " + name)
            t.check(!Proof.replyChecks(secret: secret, nonce: nonce, status: status + 1, body: body, header: proof), "reply refuses another status: " + name)
            t.check(!Proof.replyChecks(secret: secret, nonce: nonce, status: status, body: body + Data(" ".utf8), header: proof), "reply refuses another body: " + name)
            t.check(!Proof.replyChecks(secret: secret + "0", nonce: nonce, status: status, body: body, header: proof), "reply refuses another key: " + name)
            t.check(!Proof.replyChecks(secret: secret, nonce: nonce, status: status, body: body, header: proof?.uppercased()), "reply refuses uppercase hex: " + name)
            t.check(!Proof.replyChecks(secret: secret, nonce: nonce, status: status, body: body, header: nil), "reply refuses a missing header: " + name)
        }
        t.check(requests.count == 3 && replies.count == 3, "three requests and three replies")
    } else {
        t.check(false, "proof vectors not found; pass --vectors <proof_vectors.json>")
    }
    let nonce = Proof.newNonce()
    t.check(nonce.count == 32 && Proof.fromHex(nonce) != nil, "a nonce is 32 lowercase hex characters")

    // Captured summaries.
    for path in arguments("--decode", in: args) {
        let data = FileManager.default.contents(atPath: path) ?? Data()
        t.check(Summary.decode(data) != nil, "decode " + path)
    }

    print("self-test: \(t.passes) passed, \(t.failures) failed")
    return t.failures == 0 ? 0 : 1
}

// MARK: Watch mode

func watch(_ controller: Controller) {
    var last = ""
    controller.onChange = {
        var out = lookJSON(look(of: controller.status))
        switch controller.status {
        case .summary(let s): out["waiting_on_you"] = s.waitingOnYou.count
        case .notRunning: out["stopped"] = controller.stopped() != nil
        case .cantTell(let reason): out["reason"] = reason
        }
        guard let data = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8), line != last else { return }
        last = line
        print(line)
        fflush(stdout)
    }
    // Commands on stdin, so a test can sequence the poll loop.
    let input = FileHandle.standardInput
    var buffer = ""
    input.readabilityHandler = { handle in
        let data = handle.availableData
        if data.isEmpty { DispatchQueue.main.async { exit(0) } }
        buffer += String(data: data, encoding: .utf8) ?? ""
        while let newline = buffer.firstIndex(of: "\n") {
            let command = buffer[..<newline].trimmingCharacters(in: .whitespaces)
            buffer = String(buffer[buffer.index(after: newline)...])
            DispatchQueue.main.async {
                switch command {
                case "wake": NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
                case "poll": controller.poll()
                case "quit": exit(0)
                default: break
                }
            }
        }
    }
    controller.start()
}

// MARK: - Main

let args = CommandLine.arguments

if args.contains("--self-test") { exit(selfTest(args)) }
if args.contains("--snapshot") { exit(snapshot(args)) }
if args.contains("--dump-menu") { exit(dumpMenu(args)) }

guard let stateArg = argument("--state-dir", in: args) else {
    FileHandle.standardError.write(Data("usage: LaheMenuBar --state-dir <path>\n".utf8))
    exit(2)
}
let controller = Controller(stateDir: URL(fileURLWithPath: stateArg, isDirectory: true))

if let wakeAfter = argument("--wake-after", in: args).flatMap(Double.init) {
    DispatchQueue.main.asyncAfter(deadline: .now() + wakeAfter) {
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
    }
}

#if LAHE_TEST_LABELS
// Run one menu action the way a click would, then exit. Test builds only.
if let name = argument("--action", in: args) {
    let action: RowAction
    switch name {
    case "hide": action = .hide
    case "stop": action = .stop
    case "start": action = .start
    case "open": action = .openReview(argument("open", in: args) ?? "")
    case "library": action = .openLibrary
    default:
        FileHandle.standardError.write(Data("unknown action\n".utf8))
        exit(2)
    }
    controller.poll()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        controller.perform(action) { exit(0) }
    }
    RunLoop.main.run()
}
#else
if args.contains("--action") {
    FileHandle.standardError.write(Data("--action is for test builds only\n".utf8))
    exit(2)
}
#endif

if args.contains("--watch") {
    watch(controller)
    RunLoop.main.run()
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)  // no Dock icon, even outside the bundle
let delegate = MenuBarApp(controller: controller)
app.delegate = delegate
app.run()
