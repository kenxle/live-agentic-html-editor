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
//   --self-test [--vectors <file>] [--fixtures <dir>] [--decode <file>]...
//   --snapshot <dir> [--summary <file>]...
//   --dump-menu <summary.json | none> [--look not-running|stopped|cant-tell|updated]
//   --watch --state-dir <dir>    poll with no icon; one JSON line per change;
//                                stdin lines "wake", "poll", "polls", "quit"
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
    private static let digits = Array("0123456789abcdef".utf8)

    /// Lowercase hex. A table, not String(format:): a poll encodes about a
    /// hundred bytes, and formatting each one was a visible share of idle cost.
    static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        var out: [UInt8] = []
        out.reserveCapacity(64)
        for byte in bytes {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    static func sha256Hex(_ data: Data) -> String { return hex(SHA256.hash(data: data)) }

    private static var keyCache: (secret: String, key: SymmetricKey)?

    /// The key for a secret, kept while the secret stays the same. Main thread only.
    static func key(_ secret: String) -> SymmetricKey {
        if let cached = keyCache, cached.secret == secret { return cached.key }
        let key = SymmetricKey(data: Data(secret.utf8))
        keyCache = (secret, key)
        return key
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
        var bytes = [UInt8](repeating: 0, count: 16)
        arc4random_buf(&bytes, bytes.count)  // the system's cryptographic random source
        return hex(bytes)
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

/// Plain, with runs of spaces made one and the ends trimmed. A character the
/// helper or plain() removed can leave two spaces where it stood.
func tidy(_ text: String) -> String {
    return plain(text).split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
}

/// A row title: tidy, and cut with an ellipsis right after the last word or
/// letter kept, never after a space. The tooltip has the full name.
func cut(_ title: String) -> String {
    let text = tidy(title)
    if text.count <= titleLimit { return text }
    var kept = String(text.prefix(titleLimit - 1))
    while kept.last == " " { kept.removeLast() }
    return kept + "\u{2026}"
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

/// "Stopped by you at 11:41 AM" today, "Stopped by you on Oct 20 at 11:41 AM"
/// another day.
func stoppedLine(_ iso: String?) -> String {
    guard let iso = iso, let date = parseTime(iso) else { return "Stopped by you" }
    let time = DateFormatter()
    time.setLocalizedDateFormatFromTemplate("jmm")
    if Calendar.current.isDateInToday(date) { return "Stopped by you at " + time.string(from: date) }
    let day = DateFormatter()
    day.setLocalizedDateFormatFromTemplate("MMMd")
    return "Stopped by you on " + day.string(from: date) + " at " + time.string(from: date)
}

/// "1 question", "3 unread", or "1 question, 2 more unread". The helper's
/// unread counts the questions too, so the second number is the rest.
func waitingReason(_ doc: Summary.WaitingDoc) -> String {
    let rest = max(0, doc.unread - doc.questions)
    if doc.questions <= 0 { return "\(doc.unread) unread" }
    let questions = plural(doc.questions, "question")
    return rest > 0 ? "\(questions), \(rest) more unread" : questions
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

// A rebuild can fail and leave this app running on purpose, so say only what
// is known, and what to do if it lasts.
let updatedReason = "Lahe was updated. This icon is out of date."
let updatedNote = "If this stays, run lahe menubar rebuild."

/// The can't-tell reason for a signed answer that is not a summary.
func reason(forStatus code: Int) -> String {
    switch code {
    case 401: return "Lahe refused the request"
    case 409: return updatedReason
    case 200: return "Could not read Lahe's answer"
    default: return "Lahe had an error (\(code))"
    }
}

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

func tip(_ lines: String?...) -> String {
    return lines.compactMap { $0 }.map(tidy).filter { !$0.isEmpty }.joined(separator: "\n")
}

/// The overflow row. The agents section counts comments in its header but
/// lists documents, so its row names the unit.
func moreRow(_ more: Int, _ unit: String? = nil) -> [Row] {
    guard more > 0 else { return [] }
    let title = "\(more) more" + (unit.map { " " + (more == 1 ? $0 : $0 + "s") } ?? "")
    return [.note(title, "The Library lists every one.")]
}

let hideTipRunning = "Closes this icon only. Lahe keeps running. Run lahe menubar show in a terminal to bring it back."
let hideTipStopped = "Closes this icon only. Run lahe menubar show in a terminal to bring it back."

/// The brief's order: waiting on you, waiting on agents, open and connected,
/// recent, the Library, then Quit.
func menuRows(status: Status, stopped: Stopped?, libraryURL: String?) -> [Row] {
    var rows: [Row] = []
    let startRow = Row.item("Start Lahe", .start, "Starts the Lahe helper again.")

    switch status {
    case .notRunning:
        rows.append(.header(stopped.map { stoppedLine($0.at) } ?? "Lahe is not running"))
        rows += [startRow, .separator, .item("Hide the icon", .hide, hideTipStopped)]
        return rows

    case .cantTell(let reason):
        rows.append(.header("Can't tell what is waiting"))
        rows.append(.note(reason))
        if reason == updatedReason { rows.append(.note(updatedNote)) }
        rows.append(.separator)

    case .summary(let s):
        let you = s.waitingOnYou
        rows.append(.header(you.count > 0 ? "Waiting on you: \(you.count)" : "Nothing is waiting on you"))
        for doc in you.documents {
            rows.append(.item("\(cut(doc.title)) (\(waitingReason(doc)))", .openReview(doc.review),
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
        rows += moreRow(agents.more, "document")
        rows.append(.separator)

        let open = s.openDocuments
        rows.append(.header(open.count > 0 ? "Open documents: \(open.count)" : "No open documents"))
        for doc in open.items {
            rows.append(.item(cut(doc.title) + (doc.focused ? " (front tab)" : ""), .openReview(doc.review),
                              tip(doc.title, doc.pathHint)))
        }
        rows += moreRow(open.more)
        rows.append(.separator)

        let connected = s.sessions.connected
        rows.append(.header(connected.count > 0 ? "Connected sessions: \(connected.count)" : "No connected sessions"))
        for session in connected.items {
            let heard = heardAgo(session.lastHeardAt, now: s.generatedAt)
            let title = "\(cut(session.name)) (\(session.presence), last heard \(heard))"
            if let review = session.review {
                rows.append(.item(title, .openReview(review), tip(session.name, "Opens its most recent document.")))
            } else {
                rows.append(.item(title, .openLibrary, tip(session.name, "No document yet; opens the Library.")))
            }
        }
        rows += moreRow(connected.more)
        let others = s.sessions.open - connected.count
        if others > 0 {
            let line = others == 1 ? "1 other session still open" : "\(others) other sessions still open"
            rows.append(.note(line, "Open, but no agent is listening or working now. The Library lists every session."))
        }
        rows.append(.separator)

        rows.append(.header(s.recent.items.isEmpty ? "No recent documents" : "Recent documents"))
        for doc in s.recent.items {
            rows.append(.item(cut(doc.title), .openReview(doc.review), tip(doc.title, doc.pathHint)))
        }
        rows += moreRow(s.recent.more)
    }

    if libraryURL != nil {
        rows.append(.item("Open the Library", .openLibrary, "Every review, in the browser."))
    }
    rows.append(.separator)
    rows.append(.item("Hide the icon", .hide, hideTipRunning))
    rows.append(.item("Stop Lahe", .stop, "Stops the Lahe helper until you start it again."))
    return rows
}

/// The words of the alert a click on Stop Lahe shows first. The alert and the
/// self-test both read them here, so the words are tested even though the
/// alert itself cannot be clicked in a test.
enum StopConfirmation {
    static let message = "Stop Lahe?"
    static let detail = "Agents' lahe commands will fail until you start it again."
    static let confirm = "Stop"
    static let cancel = "Cancel"
}

/// The alert, not yet shown. "Stop" is the first button, so Return chooses it;
/// AppKit gives the button titled "Cancel" the Escape key.
func stopAlert() -> NSAlert {
    let alert = NSAlert()
    alert.messageText = StopConfirmation.message
    alert.informativeText = StopConfirmation.detail
    alert.addButton(withTitle: StopConfirmation.confirm)
    alert.addButton(withTitle: StopConfirmation.cancel)
    alert.icon = libraryIcon
    return alert
}

// MARK: - The icon, drawn in code

// The Library page's own icon, LIBRARY_ICON_URI in src/service/tab_icon.js,
// in its 32 by 32 viewBox, without its dark rounded-square background (a menu
// bar glyph is a template image with no plate). Four shapes:
//   M7 8h4v15H7z                              an upright book
//   M12.5 10h4v13h-4z                         a shorter upright book
//   M18.2 10.6l3.8-1.2 4.1 13.1-3.8 1.2z      a leaning book
//   M5.5 24h21v2h-21z                         the shelf
// Together they span x 5.5 to 26.5 and y 8 to 26; drawn here in a flipped
// (y down) space. Each shape is its own closed subpath, and none overlap.
func markShapes(scale s: CGFloat, origin o: CGPoint) -> [NSBezierPath] {
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { return NSPoint(x: o.x + (x - 5.5) * s, y: o.y + (y - 8) * s) }
    func shape(_ corners: [(CGFloat, CGFloat)]) -> NSBezierPath {
        let path = NSBezierPath()
        path.move(to: p(corners[0].0, corners[0].1))
        for corner in corners.dropFirst() { path.line(to: p(corner.0, corner.1)) }
        path.close()
        return path
    }
    return [
        shape([(7, 8), (11, 8), (11, 23), (7, 23)]),
        shape([(12.5, 10), (16.5, 10), (16.5, 23), (12.5, 23)]),
        shape([(18.2, 10.6), (22, 9.4), (26.1, 22.5), (22.3, 23.7)]),
        shape([(5.5, 24), (26.5, 24), (26.5, 26), (5.5, 26)]),
    ]
}

/// The whole mark as one path, for filling.
func markPath(scale s: CGFloat, origin o: CGPoint) -> NSBezierPath {
    let path = NSBezierPath()
    for shape in markShapes(scale: s, origin: o) { path.append(shape) }
    return path
}

let iconHeight: CGFloat = 18
let markScale: CGFloat = 15.0 / 18.0  // the mark's 18 units become 15 points
let markWidth = 21 * markScale
let iconFont = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)

/// The outline looks. Each book is stroked inside its own edge (a doubled line
/// clipped to the shape), so the gaps between the books stay open at 18
/// points; the shelf is too thin to hollow and stays solid.
let outlineWidth: CGFloat = 1.1
func strokeMarkOutline(origin: CGPoint) {
    let shapes = markShapes(scale: markScale, origin: origin)
    for book in shapes.dropLast() {
        NSGraphicsContext.saveGraphicsState()
        book.addClip()
        book.lineWidth = outlineWidth * 2
        book.stroke()
        NSGraphicsContext.restoreGraphicsState()
    }
    shapes.last?.fill()
}

/// The Library page's tab icon in full color, for the Stop alert and the app's
/// own icon: the dark rounded plate (rx 7 in the 32 unit viewBox), the white
/// upright books and shelf, and the blue leaning book. 64 points, drawn by a
/// handler, so it is sharp at any scale. Not a template: it keeps its colors.
let libraryIcon: NSImage = {
    let size: CGFloat = 64, unit = size / 32
    return NSImage(size: NSSize(width: size, height: size), flipped: true) { _ in
        NSColor(srgbRed: 0x23 / 255.0, green: 0x26 / 255.0, blue: 0x2b / 255.0, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size), xRadius: 7 * unit, yRadius: 7 * unit).fill()
        let shapes = markShapes(scale: unit, origin: CGPoint(x: 5.5 * unit, y: 8 * unit))
        let blue = NSColor(srgbRed: 0x5b / 255.0, green: 0x9b / 255.0, blue: 1, alpha: 1)
        for (index, shape) in shapes.enumerated() {
            (index == 2 ? blue : NSColor.white).setFill()
            shape.fill()
        }
        return true
    }
}()

/// The four looks as one template image, so macOS colors it for a light, dark
/// or highlighted menu bar. The count (or "?") is part of the image, so the
/// snapshot draws exactly what the menu bar shows.
///   clear        the filled mark
///   count        the filled mark and the number
///   not running  the mark as an outline, struck through
///   can't tell   the outline and a question mark, never the plain mark
func iconImage(_ look: Look) -> NSImage {
    let text = look.text
    let attrs: [NSAttributedString.Key: Any] = [.font: iconFont, .foregroundColor: NSColor.black]
    let textSize = text.map { ($0 as NSString).size(withAttributes: attrs) } ?? .zero
    let gap: CGFloat = text == nil ? 0 : 3
    let width = ceil(1 + markWidth + gap + textSize.width + 1)
    let image = NSImage(size: NSSize(width: width, height: iconHeight), flipped: true) { _ in
        let origin = CGPoint(x: 1, y: (iconHeight - 18 * markScale) / 2)
        let markHeight = 18 * markScale
        NSColor.black.set()
        switch look {
        case .clear, .count:
            markPath(scale: markScale, origin: origin).fill()
        case .notRunning, .cantTell:
            strokeMarkOutline(origin: origin)
        }
        if look == .notRunning {
            // The slash across the whole mark, with a clear band either side
            // so it reads apart from the books it crosses.
            let slash = NSBezierPath()
            slash.move(to: NSPoint(x: origin.x - 0.5, y: origin.y + markHeight + 0.5))
            slash.line(to: NSPoint(x: origin.x + markWidth + 0.5, y: origin.y - 0.5))
            slash.lineCapStyle = .round
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current?.compositingOperation = .clear
            slash.lineWidth = 2.9
            slash.stroke()
            NSGraphicsContext.restoreGraphicsState()
            slash.lineWidth = 1.5
            slash.stroke()
        }
        if let text = text {
            let y = (iconHeight - textSize.height) / 2
            (text as NSString).draw(at: NSPoint(x: 1 + markWidth + gap, y: y), withAttributes: attrs)
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

/// One request to the helper over a plain socket to 127.0.0.1.
///
/// Why not URLSession: each URLSession task hops across several threads and
/// queues, and that alone cost about 5 ms of processor time per poll, which put
/// the idle app over the plan's budget. This is a few system calls.
///
/// It speaks HTTP/1.0, so the helper answers with the plain body and closes the
/// connection: the answer is everything up to the end of the stream, with no
/// chunked encoding to undo. A new connection per poll is a few system calls on
/// loopback; a kept-open one would race the helper's own 5-second idle close.
enum Wire {
    enum Result {
        case answer(status: Int, headers: [String: String], body: Data)
        case refused, timedOut
        case failed(String)
    }

    static let maxAnswer = 4 << 20

    /// Blocking; call it off the main thread.
    static func exchange(port: Int, request: Data, timeout: TimeInterval) -> Result {
        let deadline = Date().addingTimeInterval(timeout)
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return .failed("socket") }
        defer { close(fd) }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(port).bigEndian)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        if connected != 0 {
            if errno == ECONNREFUSED { return .refused }
            guard errno == EINPROGRESS else { return .failed("connect: \(errno)") }
            guard wait(fd, Int16(POLLOUT), deadline) else { return .timedOut }
            var error: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length)
            if error == ECONNREFUSED { return .refused }
            if error != 0 { return .failed("connect: \(error)") }
        }

        var sent = 0
        while sent < request.count {
            guard wait(fd, Int16(POLLOUT), deadline) else { return .timedOut }
            let n = request.withUnsafeBytes { send(fd, $0.baseAddress! + sent, request.count - sent, 0) }
            if n < 0 {
                if errno == EAGAIN || errno == EINTR { continue }
                return .failed("send: \(errno)")
            }
            sent += n
        }

        var answer = Data()
        var buffer = [UInt8](repeating: 0, count: 16384)
        while true {
            guard wait(fd, Int16(POLLIN), deadline) else { return .timedOut }
            let n = recv(fd, &buffer, buffer.count, 0)
            if n == 0 { break }
            if n < 0 {
                if errno == EAGAIN || errno == EINTR { continue }
                return .failed("recv: \(errno)")
            }
            answer.append(buffer, count: n)
            if answer.count > maxAnswer { return .failed("answer too large") }
        }
        return parse(answer)
    }

    private static func wait(_ fd: Int32, _ events: Int16, _ deadline: Date) -> Bool {
        while true {
            let left = Int32(max(0, deadline.timeIntervalSinceNow * 1000))
            if left <= 0 { return false }
            var entry = pollfd(fd: fd, events: events, revents: 0)
            let ready = poll(&entry, 1, left)
            if ready > 0 { return true }
            if ready == 0 { return false }
            if errno != EINTR { return true }  // let the next call report the error
        }
    }

    /// Status line, headers (names lowercased), and the body as sent.
    static func parse(_ answer: Data) -> Result {
        guard let split = answer.range(of: Data("\r\n\r\n".utf8)),
              let head = String(data: answer[..<split.lowerBound], encoding: .utf8) else {
            return .failed("no header")
        }
        let lines = head.components(separatedBy: "\r\n")
        let statusParts = lines[0].split(separator: " ")
        guard statusParts.count >= 2, statusParts[0].hasPrefix("HTTP/1."),
              statusParts[1].count == 3, isDigits(statusParts[1]), let status = Int(statusParts[1]) else {
            return .failed("bad status line")
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].lowercased()
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        if headers["transfer-encoding"] != nil { return .failed("chunked answer to an HTTP/1.0 request") }
        var body = Data(answer[split.upperBound...])
        // Plain ASCII digits only. Int() alone takes "-1" and "+5", and a
        // negative length would trap in prefix() before the signature is read.
        if let raw = headers["content-length"] {
            guard isDigits(Substring(raw)), let declared = Int(raw) else { return .failed("bad content-length") }
            guard declared <= body.count else { return .failed("short answer") }
            body = body.prefix(declared)
        }
        return .answer(status: status, headers: headers, body: body)
    }

    /// One or more of the ASCII digits 0 to 9, and nothing else.
    static func isDigits(_ text: Substring) -> Bool {
        return !text.isEmpty && text.utf8.allSatisfy { $0 >= 0x30 && $0 <= 0x39 }
    }
}

final class HelperClient {
    let stateDir: URL
    let log: Log
    private var secret: String?
    // service.json lists every review with its token, so on a busy machine it
    // runs to hundreds of KB. It is parsed again only when its size, modified
    // time or inode change; a stat per poll is all an unchanged file costs.
    private struct Stamp: Equatable { let size: Int64; let modified: Int; let inode: UInt64 }
    private var serviceStamp: Stamp?
    private var serviceCache: ServiceInfo?
    private let queue = DispatchQueue(label: "lahe.menubar.wire")

    init(stateDir: URL, log: Log) {
        self.stateDir = stateDir
        self.log = log
    }

    func service() -> ServiceInfo? {
        let url = stateDir.appendingPathComponent("service.json")
        var info = stat()
        guard stat(url.path, &info) == 0 else {
            serviceStamp = nil
            serviceCache = nil
            return nil
        }
        let modified = Int(info.st_mtimespec.tv_sec) * 1_000_000_000 + Int(info.st_mtimespec.tv_nsec)
        let stamp = Stamp(size: Int64(info.st_size), modified: modified, inode: UInt64(info.st_ino))
        if stamp == serviceStamp { return serviceCache }
        serviceStamp = stamp
        serviceCache = nil
        guard let data = try? Data(contentsOf: url),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let port = json["port"] as? Int, port > 0, port < 65536 else { return nil }
        let pages = (json["pages"] as? [String: Any])?["port"] as? Int
        serviceCache = ServiceInfo(port: port, pagesPort: pages)
        return serviceCache
    }

    private func readSecret() -> String? {
        guard let data = try? Data(contentsOf: stateDir.appendingPathComponent("cli-secret")),
              let text = String(data: data, encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Sign and send one request; `completion` runs on the main thread.
    func send(method: String, path: String, body: Data, completion: @escaping (Answer) -> Void) {
        guard let service = service() else {
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
        let proof = Proof.hmacHex(secret: key, message: Proof.requestString(method: method, path: path, ts: ts, nonce: nonce, body: body))
        var head = "\(method) \(path) HTTP/1.0\r\n"
        head += "Host: 127.0.0.1:\(service.port)\r\n"
        head += "x-lahe-proof-ts: \(ts)\r\nx-lahe-proof-nonce: \(nonce)\r\nx-lahe-proof: \(proof)\r\n"
        if method == "POST" { head += "Content-Type: application/json\r\nContent-Length: \(body.count)\r\n" }
        let request = Data((head + "\r\n").utf8) + body

        queue.async { [weak self] in
            let result = Wire.exchange(port: service.port, request: request, timeout: requestTimeout)
            DispatchQueue.main.async {
                guard let self = self else { return }
                completion(self.check(result, key: key, nonce: nonce))
            }
        }
    }

    /// Drop anything the helper did not sign for this request.
    private func check(_ result: Wire.Result, key: String, nonce: String) -> Answer {
        switch result {
        case .refused:
            return .refused
        case .timedOut:
            log.write("net:timeout", "Lahe did not answer in time")
            return .failed("Lahe did not answer in time")
        case .failed(let why):
            log.write("net:" + why, "Lahe's answer failed: " + why)
            return .failed("Lahe's answer failed")
        case .answer(let status, let headers, let body):
            guard Proof.replyChecks(secret: key, nonce: nonce, status: status, body: body, header: headers["x-lahe-proof-reply"]) else {
                // The key may have changed under us; read it again for the next poll.
                secret = nil
                log.write("signature", "dropped an answer whose x-lahe-proof-reply did not check (status \(status))")
                return .failed("An answer on Lahe's port was not signed by Lahe")
            }
            if status == 401 { secret = nil }
            return .verified(status: status, body: body)
        }
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
    private var lastBody: Data?     // the last summary answer, to skip an unchanged one
    private var shownStopped = false  // the stopped look is up, from the marker
    private(set) var polls = 0      // poll() calls, sent or not; --watch prints it on "polls"
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
        timer.tolerance = 1  // lets macOS fold this wakeup in with others
        RunLoop.main.add(timer, forMode: .common)  // keeps firing while the menu is open
        self.timer = timer
        poll()
    }

    /// After a wake, "can't tell" until an answer to a request sent after it.
    func woke() {
        generation += 1
        inFlight = false
        lastBody = nil
        set(.cantTell("The Mac just woke"))
        poll()
    }

    /// One poll. While the stop hold stands it sends nothing: whatever holds
    /// the port then is not a helper this app started, and a fresh signed
    /// request every 5 seconds would hand it a proof to replay. The stopped
    /// look comes from the marker alone, and polling resumes when it goes.
    func poll() {
        polls += 1
        if FileManager.default.fileExists(atPath: stoppedURL.path) {
            if case .notRunning = status, shownStopped { return }
            generation += 1  // an answer to a request sent before the marker is ignored
            inFlight = false
            lastBody = nil
            shownStopped = true
            set(.notRunning)
            return
        }
        shownStopped = false
        if inFlight { return }
        inFlight = true
        let asked = generation
        client.send(method: "GET", path: "/lahe/v1/summary?v=\(builtSummaryVersion)", body: Data()) { [weak self] answer in
            guard let self = self, asked == self.generation else { return }
            self.inFlight = false
            // The same bytes as the last summary: nothing to decode, draw or rebuild.
            if case .verified(200, let body) = answer, case .summary = self.status, body == self.lastBody { return }
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
                lastBody = body
                return .summary(summary)
            }
            if code == 200 {
                log.write("decode", "could not read the summary answer")
                return .cantTell("Could not read Lahe's answer")
            }
            if code == 409 {
                log.write("version", "the helper answers another summary_version")
            } else {
                log.write("status:\(code)", "summary.read answered \(code)")
            }
            return .cantTell(reason(forStatus: code))
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
        poll()  // shows the stopped look from the marker, and sends nothing
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

/// A row's action, carried on its own menu item. A poll can change the menu
/// while it is open, so a click must never look its action up by position.
final class ActionBox: NSObject {
    let action: RowAction
    init(_ action: RowAction) { self.action = action }
}

/// A header row on macOS 13, which has no section header item: small,
/// semibold, in the secondary label colour. macOS 14 and later draw the
/// system's own section header.
let headerFont = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold)

func isSystemHeader(_ item: NSMenuItem) -> Bool {
    if #available(macOS 14, *) { return item.isSectionHeader }
    return false
}

/// The one place a row becomes a menu item. The live menu and the snapshot
/// drawing both go through it, so a picture cannot show a row the menu does not.
func menuItem(for row: Row, target: AnyObject?, action: Selector?) -> NSMenuItem {
    if row.kind == .separator { return .separator() }
    let item: NSMenuItem
    if row.kind == .header, #available(macOS 14, *) {
        item = NSMenuItem.sectionHeader(title: row.title)
    } else {
        item = NSMenuItem(title: row.title, action: row.enabled ? action : nil, keyEquivalent: "")
        item.target = target
    }
    update(item, to: row)
    return item
}

/// A row's title, tooltip and action onto an item made for a row of the same
/// kind, so an open menu can change in place.
func update(_ item: NSMenuItem, to row: Row) {
    item.title = row.title
    if row.kind == .header && !isSystemHeader(item) {
        item.attributedTitle = NSAttributedString(string: row.title, attributes: [
            .font: headerFont, .foregroundColor: NSColor.secondaryLabelColor,
        ])
    }
    item.isEnabled = row.enabled
    item.toolTip = row.tooltip
    item.representedObject = ActionBox(row.action)
}

/// How an item draws, read back from the item itself: the snapshot's input.
enum ItemLook: String { case rule, header, enabled, disabled }

func itemLook(_ item: NSMenuItem) -> ItemLook {
    if item.isSeparatorItem { return .rule }
    if isSystemHeader(item) || item.attributedTitle != nil { return .header }
    return item.isEnabled ? .enabled : .disabled
}

final class MenuBarApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let controller: Controller
    var statusItem: NSStatusItem?
    let menu = NSMenu()
    private var shownLook: Look?
    private var shownRows: [Row] = []
    private var menuOpen = false

    init(controller: Controller) { self.controller = controller }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = libraryIcon  // the app has no .icns; anything the system shows for it uses this
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        statusItem = item
        controller.onChange = { [weak self] in self?.redraw() }
        redraw()
        rebuildMenu()  // an empty status menu may not open at all, so start with rows
        controller.start()
    }

    // The menu is built just before it opens. While it is open, a poll changes
    // titles in place and never adds or removes a row, so the highlight stays
    // under the cursor; a row added or removed shows the next time it opens.
    // A closed menu costs nothing per poll, which matters because the "last
    // heard" times change on almost every answer.
    func menuNeedsUpdate(_ menu: NSMenu) { rebuildMenu() }
    func menuWillOpen(_ menu: NSMenu) {
        menuOpen = true
        controller.poll()
    }
    func menuDidClose(_ menu: NSMenu) { menuOpen = false }

    /// Redraws the icon only when its look changes, and the menu only while open.
    func redraw() {
        let current = look(of: controller.status)
        if current != shownLook {
            shownLook = current
            statusItem?.button?.image = iconImage(current)
            statusItem?.button?.setAccessibilityLabel(accessibilityText(current))
        }
        if menuOpen { refreshOpenMenu() }
    }

    private func rebuildMenu() {
        let rows = controller.rows()
        if rows == shownRows && menu.items.count == rows.count { return }
        shownRows = rows
        menu.removeAllItems()
        for row in rows { menu.addItem(menuItem(for: row, target: self, action: #selector(clicked(_:)))) }
    }

    /// Only rows whose kind is unchanged, in place. A different set of rows
    /// waits for the menu to close.
    private func refreshOpenMenu() {
        let rows = controller.rows()
        guard rows != shownRows, menu.items.count == shownRows.count,
              rows.map({ $0.kind }) == shownRows.map({ $0.kind }) else { return }
        for (index, row) in rows.enumerated() where row != shownRows[index] {
            update(menu.items[index], to: row)
        }
        shownRows = rows
    }

    @objc func clicked(_ sender: NSMenuItem) {
        guard let box = sender.representedObject as? ActionBox else { return }
        if box.action == .stop && !confirmStop() { return }
        controller.perform(box.action)
    }

    /// The confirmation lives on the click path only. perform(.stop) itself
    /// stays unconfirmed, so the test build's --action stop (and the live test
    /// that checks it writes the marker) runs with no alert to answer.
    private func confirmStop() -> Bool {
        let alert = stopAlert()
        NSApp.activate(ignoringOtherApps: true)  // a menu bar app has no window to bring it forward
        return alert.runModal() == .alertFirstButtonReturn
    }
}

func accessibilityText(_ look: Look) -> String {
    switch look {
    case .clear: return "Lahe: nothing waiting"
    case .count(let text): return "Lahe: \(text) waiting on you"
    case .notRunning: return "Lahe is not running"
    case .cantTell: return "Lahe: can't tell what is waiting"
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
    out["style"] = itemLook(menuItem(for: row, target: nil, action: nil)).rawValue  // as the live menu draws it
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

/// A drawing of the open menu. The real menu cannot be captured without a
/// screen recording permission, so this draws the menu items the live menu is
/// built from (menuItem(for:)), reading each one's title and look back from the
/// item: a header is small and semibold, a disabled row is grey.
func drawMenuPicture(rows: [Row], look: Look, palette: Palette, size: NSSize) {
    let barHeight: CGFloat = 26
    drawIconStrip(look, palette: palette, in: NSRect(x: 0, y: size.height - barHeight, width: size.width, height: barHeight))
    palette.panel.setFill()
    NSRect(x: 0, y: 0, width: size.width, height: size.height - barHeight).fill()
    var y = size.height - barHeight - 8
    for item in rows.map({ menuItem(for: $0, target: nil, action: nil) }) {
        let style = itemLook(item)
        if style == .rule {
            y -= 6
            palette.rule.setFill()
            NSRect(x: 10, y: y, width: size.width - 20, height: 1).fill()
            y -= 6
            continue
        }
        let font = style == .header ? headerFont : NSFont.menuFont(ofSize: 0)
        let color = style == .enabled ? palette.text : palette.dim
        y -= 20
        (item.title as NSString).draw(at: NSPoint(x: 14, y: y + 3), withAttributes: [.font: font, .foregroundColor: color])
    }
}

func menuPictureHeight(_ rows: [Row]) -> CGFloat {
    return 26 + 16 + rows.reduce(0) { $0 + ($1.kind == .separator ? 12 : 20) }
}

/// The stop alert, drawn from its own window's views without ever running it.
/// The alert's frosted window background does not draw offscreen, so the
/// system window colour for that appearance is painted behind the views.
func renderAlert(_ alert: NSAlert, appearance name: NSAppearance.Name, to url: URL) throws {
    _ = NSApplication.shared
    guard let appearance = NSAppearance(named: name) else { throw NSError(domain: "lahe", code: 3) }
    alert.layout()
    alert.window.appearance = appearance
    guard let view = alert.window.contentView,
          let views = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw NSError(domain: "lahe", code: 3) }
    view.cacheDisplay(in: view.bounds, to: views)
    let size = view.bounds.size
    try renderPNG(size: size, to: url) {
        appearance.performAsCurrentDrawingAppearance {
            NSColor.windowBackgroundColor.setFill()
            NSRect(origin: .zero, size: size).fill()
        }
        views.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1,
                   respectFlipped: false, hints: nil)
    }
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
        for (theme, appearance) in [("light", NSAppearance.Name.aqua), ("dark", NSAppearance.Name.darkAqua)] {
            let file = "alert_stop_\(theme).png"
            try renderAlert(stopAlert(), appearance: appearance, to: out.appendingPathComponent(file))
            written.append(file)
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
    // The answer parser: the body exactly as sent, cut at a declared length.
    func parsed(_ text: String) -> (Int, String?, String)? {
        guard case .answer(let status, let headers, let body) = Wire.parse(Data(text.utf8)) else { return nil }
        return (status, headers["x-lahe-proof-reply"], String(data: body, encoding: .utf8) ?? "")
    }
    let plainAnswer = parsed("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Lahe-Proof-Reply: ab\r\n\r\n{\"a\": 1}\n")
    t.check(plainAnswer?.0 == 200 && plainAnswer?.1 == "ab" && plainAnswer?.2 == "{\"a\": 1}\n", "an answer read to its end, header names in any case")
    t.check(parsed("HTTP/1.0 409 Conflict\r\nContent-Length: 2\r\n\r\n{}extra")?.2 == "{}", "a declared length cuts the body")
    t.check(parsed("HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n{}") == nil, "a short body is refused")
    t.check(parsed("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n") == nil, "a chunked answer is refused")
    t.check(parsed("garbage") == nil && parsed("SSH-2.0\r\n\r\n") == nil, "a non-HTTP answer is refused")

    // An answer whose length is not plain digits fails; it must never reach
    // prefix() with a negative count, which traps (fix round 3, finding 1).
    t.check(parsed("HTTP/1.1 200 OK\r\nContent-Length: abc\r\n\r\n{}") == nil, "a non-digit Content-Length is refused")
    t.check(parsed("HTTP/1.1 200 OK\r\nContent-Length: +2\r\n\r\n{}") == nil, "a signed Content-Length is refused")
    t.check(parsed("HTTP/1.1 200 OK\r\nContent-Length: 99999999999999999999999\r\n\r\n{}") == nil, "an overflowing Content-Length is refused")
    t.check(parsed("HTTP/1.1 +200 OK\r\n\r\n{}") == nil, "a status that is not three digits is refused")

    // The menu's words, on the committed summaries.
    var fixtureDir = argument("--fixtures", in: args)
    if fixtureDir == nil {
        let guess = FileManager.default.currentDirectoryPath + "/test/fixtures/menubar"
        if FileManager.default.fileExists(atPath: guess + "/summary.json") { fixtureDir = guess }
    }
    func summaryRows(_ name: String) -> [Row] {
        guard let dir = fixtureDir, let data = FileManager.default.contents(atPath: dir + "/" + name),
              let summary = Summary.decode(data) else {
            t.check(false, "could not read the fixture " + name + "; pass --fixtures <test/fixtures/menubar>")
            return []
        }
        return menuRows(status: .summary(summary), stopped: nil, libraryURL: summary.libraryUrl)
    }
    func titled(_ rows: [Row], _ title: String) -> Row? { return rows.first { $0.title == title } }
    let full = summaryRows("summary.json")
    let empty = summaryRows("summary_empty.json")
    let many = summaryRows("summary_many.json")
    let notRunningRows = menuRows(status: .notRunning, stopped: nil, libraryURL: nil)
    let stoppedRows = menuRows(status: .notRunning, stopped: Stopped(at: "2026-10-20T15:41:00.000Z"), libraryURL: nil)
    let updatedRows = menuRows(status: .cantTell(updatedReason), stopped: nil, libraryURL: "http://library.lahe.localhost:1483/catalog")
    let everyMenu = [full, empty, many, notRunningRows, stoppedRows, updatedRows]

    // Waiting rows: no "open", and questions said apart from the rest.
    t.check(titled(full, "Crucible: Menu bar app (1 question, 2 more unread)") != nil, "a waiting row says 1 question, 2 more unread")
    t.check(titled(full, "Stable addresses: the plan (2 unread)") != nil, "a waiting row with no question says 2 unread")
    t.check(!full.contains { $0.title.contains("(open") }, "a waiting row does not say open")
    t.check(full.first { $0.action == .openReview("r183d18583a43") }?.tooltip?.hasSuffix("Open in a browser window now.") == true,
            "an open document's tooltip says it is open")

    // Sessions: no "(5 open)"; the others are their own note row.
    t.check(titled(full, "Connected sessions: 2") != nil, "the sessions header is the connected count alone")
    t.check(titled(full, "3 other sessions still open")?.kind == .note, "the other open sessions are a note row")
    t.check(titled(empty, "No connected sessions") != nil, "the empty sessions header has no (0 open)")
    t.check(!everyMenu.joined().contains { $0.title.contains(" open)") }, "no header says (N open)")
    if let at = full.firstIndex(where: { $0.title == "Connected sessions: 2" }) {
        t.check(at > 0 && full[at - 1].kind == .separator, "a separator between open documents and connected sessions")
    } else {
        t.check(false, "a separator between open documents and connected sessions")
    }
    let sessionTips = full.filter { $0.title.contains("last heard") }.compactMap { $0.tooltip }
    t.check(sessionTips.count == 2 && !sessionTips.contains { $0.contains("s_") }, "a session's tooltip has no raw session id")

    // Small wording.
    t.check(titled(full, "Crucible: Menu bar app (front tab)") != nil, "the front tab says (front tab)")
    t.check(!everyMenu.joined().contains { $0.title.contains("(focused)") }, "no row says (focused)")
    t.check(titled(empty, "No recent documents")?.kind == .header && titled(empty, "Recent documents") == nil,
            "no recent documents says so")
    t.check(!everyMenu.joined().contains { $0.title.contains("`") || ($0.tooltip ?? "").contains("`") }, "no backticks in any menu text")
    for (name, rows) in [("not running", notRunningRows), ("stopped", stoppedRows)] {
        let hide = rows.first { $0.action == .hide }
        t.check(hide != nil && !(hide?.tooltip ?? "").contains("keeps running"), "the \(name) menu's Hide does not say Lahe keeps running")
        t.check(rows.first?.kind == .header, "the \(name) menu's first line is a header")
    }
    t.check(stoppedRows.first?.title.hasPrefix("Stopped by you on ") == true && stoppedRows.first?.title.contains(" at ") == true,
            "the stopped line reads Stopped by you on <day> at <time>")
    t.check(titled(updatedRows, "Lahe was updated. This icon is out of date.") != nil, "updated says the icon is out of date")
    t.check(titled(updatedRows, "If this stays, run lahe menubar rebuild.") != nil, "updated says what to run if it stays")
    t.check(!everyMenu.joined().contains { $0.title.contains("rebuilding") }, "nothing claims a rebuild is under way")
    t.check(accessibilityText(.cantTell) == "Lahe: can't tell what is waiting", "VoiceOver says can't tell what is waiting")

    // Cutting: no space before the ellipsis, no double space left behind.
    t.check(cut("A very long document title that keeps going well past what a menu row can show")
            == "A very long document title that keeps going well\u{2026}", "no space before the ellipsis")
    t.check(cut("Title with a lone surrogate half  here") == "Title with a lone surrogate half here", "a double space is made one")

    // The many fixture: each capped section draws its 8 rows and the overflow.
    func section(_ rows: [Row], _ header: String) -> [Row] {
        guard let at = rows.firstIndex(where: { $0.title.hasPrefix(header) }) else { return [] }
        return Array(rows[(at + 1)...].prefix { $0.kind != .separator && $0.kind != .header })
    }
    let manyAgents = section(many, "Your comments waiting on agents: ")
    t.check(manyAgents.filter { $0.kind == .item }.count == 8 && manyAgents.last?.title == "2 more documents",
            "many: 8 agent documents and 2 more documents")
    let manyOpen = section(many, "Open documents: ")
    t.check(titled(many, "Open documents: 14") != nil && manyOpen.filter { $0.kind == .item }.count == 8 && manyOpen.last?.title == "6 more",
            "many: open documents 14 is 8 rows and 6 more")
    let manySessions = section(many, "Connected sessions: ")
    t.check(titled(many, "Connected sessions: 11") != nil && manySessions.filter { $0.kind == .item }.count == 8
            && manySessions.contains { $0.title == "3 more" }, "many: connected sessions 11 is 8 rows and 3 more")
    t.check(section(many, "Waiting on you: ").filter { $0.kind == .item }.count == 120, "many: all 120 waiting documents are rows")
    fflush(stdout)  // a trap below would lose buffered lines
    t.check(parsed("HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n{}") == nil, "a negative Content-Length is refused")

    // Headers look like headers in the live menu, and the snapshot reads the
    // same items (fix round 3, finding 3).
    for row in everyMenu.joined() {
        let style = itemLook(menuItem(for: row, target: nil, action: nil))
        let expected: ItemLook = row.kind == .separator ? .rule : row.kind == .header ? .header : row.kind == .item ? .enabled : .disabled
        t.check(style == expected, "\(row.kind.rawValue) \"\(row.title)\" draws as \(expected.rawValue), not \(style.rawValue)")
    }
    if #available(macOS 14, *) {
        t.check(menuItem(for: .header("Waiting on you: 2"), target: nil, action: nil).isSectionHeader, "macOS 14 uses the system section header")
    }
    let fallback = NSMenuItem(title: "x", action: nil, keyEquivalent: "")
    update(fallback, to: .header("Waiting on you: 2"))
    t.check(itemLook(fallback) == .header && (fallback.attributedTitle?.attribute(.font, at: 0, effectiveRange: nil) as? NSFont) == headerFont,
            "the macOS 13 header is small and semibold")
    t.check(reason(forStatus: 500) == "Lahe had an error (500)", "a 500 says Lahe had an error (500)")
    t.check(reason(forStatus: 409) == updatedReason && reason(forStatus: 401) == "Lahe refused the request", "409 and 401 reasons")

    let nonce = Proof.newNonce()
    t.check(nonce.count == 32 && Proof.fromHex(nonce) != nil, "a nonce is 32 lowercase hex characters")

    // Stop asks first. The alert cannot be clicked in a test, so its words are
    // checked here, from the one value the alert reads.
    t.check(StopConfirmation.message == "Stop Lahe?", "the stop alert asks Stop Lahe?")
    t.check(StopConfirmation.detail == "Agents' lahe commands will fail until you start it again.",
            "the stop alert says agents' commands will fail")
    t.check(StopConfirmation.confirm == "Stop" && StopConfirmation.cancel == "Cancel", "the stop alert's buttons are Stop and Cancel")
    t.check(!everyMenu.joined().contains { $0.title.contains("until you start it again") }, "no menu has the note row under Stop")
    for rows in [full, empty, many, updatedRows] {
        let at = rows.firstIndex { $0.action == .stop }
        t.check(at != nil && rows[at!].title == "Stop Lahe" && at == rows.count - 1, "Stop Lahe is the last row")
        t.check(at.map { rows[$0].tooltip == "Stops the Lahe helper until you start it again." } == true, "Stop Lahe keeps its tooltip")
    }

    // The icon: the Library mark, about 15 points tall, and each look drawn.
    let markBounds = markPath(scale: markScale, origin: .zero).bounds
    t.check(abs(markBounds.height - 15) < 0.01 && abs(markBounds.width - markWidth) < 0.01, "the mark is 15 points tall")
    /// Pixels drawn at 2x whose alpha is over half, and, given a color, whose
    /// red, green and blue are each within 2/255 of it.
    func inked(_ image: NSImage, _ color: (Int, Int, Int)? = nil) -> Int {
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(image.size.width * 2), pixelsHigh: Int(image.size.height * 2),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return 0 }
        rep.size = image.size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(origin: .zero, size: image.size))
        NSGraphicsContext.restoreGraphicsState()
        var count = 0
        var pixel = [Int](repeating: 0, count: 4)
        for x in 0..<rep.pixelsWide {
            for y in 0..<rep.pixelsHigh {
                rep.getPixel(&pixel, atX: x, y: y)
                guard pixel[3] > 127 else { continue }
                if let (r, g, b) = color, abs(pixel[0] - r) > 2 || abs(pixel[1] - g) > 2 || abs(pixel[2] - b) > 2 { continue }
                count += 1
            }
        }
        return count
    }

    // The Stop alert's icon: the Library page's tab icon in full color.
    let alertIcon = stopAlert().icon
    t.check(alertIcon != nil && alertIcon === libraryIcon, "the stop alert's icon is the Library icon")
    t.check(libraryIcon.size.width == 64 && libraryIcon.size.height == 64, "the Library icon is 64 points square")
    t.check(!libraryIcon.isTemplate, "the Library icon is not a template image")
    t.check(inked(libraryIcon, (0x23, 0x26, 0x2b)) > 0, "the Library icon has its dark plate")
    t.check(inked(libraryIcon, (0x5b, 0x9b, 0xff)) > 0, "the Library icon has its blue leaning book")
    t.check(inked(libraryIcon, (0xff, 0xff, 0xff)) > 0, "the Library icon has its white books and shelf")
    let clearIcon = iconImage(.clear), threeIcon = iconImage(.count("3")), manyIcon = iconImage(.count("99+"))
    t.check(clearIcon.isTemplate && clearIcon.size.height == iconHeight, "the icon is an 18 point template image")
    t.check(threeIcon.size.width > clearIcon.size.width && manyIcon.size.width > threeIcon.size.width, "count is wider than clear, 99+ wider than 3")
    t.check(iconImage(.notRunning).size.width == clearIcon.size.width, "not running is as wide as clear")
    t.check(iconImage(.cantTell).size.width > clearIcon.size.width, "can't tell is wider than clear, for its question mark")
    let clearInk = inked(clearIcon), outlineInk = inked(iconImage(.notRunning))
    t.check(clearInk > 0, "the clear icon is not empty")
    t.check(outlineInk > 0 && outlineInk != clearInk, "not running draws something other than the filled mark")

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
                case "polls":
                    print("{\"polls\":\(controller.polls)}")
                    fflush(stdout)
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
