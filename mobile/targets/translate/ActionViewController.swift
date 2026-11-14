// Хэлмэрч — Share цэсний «Хэлмэрчээр орчуулах».
// Ямар ч аппад (Safari, Notes, Mail, Books, Messages…) текст сонгоод Share → энэ товч дарахад
// доороос цонх гарч монгол орчуулга, үгийн бусад утгыг харуулна. Алдааг улаанаар харуулахгүй.
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Орчуулга (Google — түлхүүргүй, хурдан)

struct Alt: Identifiable, Sendable {
    let id = UUID()
    let pos: String
    let terms: [String]
}

struct TranslationResult: Sendable {
    let text: String
    let alts: [Alt]
}

enum Translator {
    static let endpoints = [
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t&dt=bd",
        "https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=mn&dt=t&dt=bd",
    ]

    /// Урт текстийг догол мөрөөр хэсэглэж (≤1800 тэмдэгт) орчуулна.
    static func translate(_ text: String) async -> TranslationResult? {
        let chunks = chunked(text)
        var parts: [String] = []
        var alts: [Alt] = []
        for chunk in chunks {
            guard let r = await one(chunk) else { return nil }
            parts.append(r.text)
            if chunks.count == 1 { alts = r.alts }
        }
        return TranslationResult(text: parts.joined(separator: "\n"), alts: alts)
    }

    static func chunked(_ text: String) -> [String] {
        var out: [String] = []
        var cur = ""
        for line in text.components(separatedBy: "\n") {
            if !cur.isEmpty && cur.count + line.count > 1800 {
                out.append(cur)
                cur = ""
            }
            cur += cur.isEmpty ? line : "\n" + line
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    static func one(_ text: String) async -> TranslationResult? {
        for ep in endpoints {
            guard var comps = URLComponents(string: ep) else { continue }
            comps.queryItems = (comps.queryItems ?? []) + [URLQueryItem(name: "q", value: text)]
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            guard let url = comps.url else { continue }
            var req = URLRequest(url: url, timeoutInterval: 15)
            req.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard (resp as? HTTPURLResponse)?.statusCode == 200,
                      let json = try JSONSerialization.jsonObject(with: data) as? [Any] else { continue }
                let segs = json.first as? [Any] ?? []
                let mn = segs.compactMap { ($0 as? [Any])?.first as? String }.joined()
                var alts: [Alt] = []
                if json.count > 1, let dict = json[1] as? [Any] {
                    for entry in dict {
                        if let e = entry as? [Any], e.count > 1, let pos = e[0] as? String, let terms = e[1] as? [String] {
                            alts.append(Alt(pos: pos, terms: Array(terms.prefix(6))))
                        }
                    }
                }
                if !mn.isEmpty { return TranslationResult(text: mn, alts: alts) }
            } catch {
                continue
            }
        }
        return nil
    }
}

// MARK: - Төлөв

@MainActor
final class TranslateModel: ObservableObject {
    enum Phase { case loading, done, empty, failed }
    @Published var source = ""
    @Published var result = ""
    @Published var alts: [Alt] = []
    @Published var phase: Phase = .loading
    @Published var copied = false

    func start(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        source = String(text.prefix(6000))
        guard !text.isEmpty else { phase = .empty; return }
        Task { await run() }
    }

    func run() async {
        phase = .loading
        // алдаа гарвал чимээгүй дахин оролдоно (3 удаа)
        for attempt in 0..<3 {
            if let r = await Translator.translate(source) {
                result = r.text
                alts = r.alts
                phase = .done
                return
            }
            try? await Task.sleep(nanoseconds: UInt64(attempt + 1) * 900_000_000)
        }
        phase = .failed
    }

    func copy() {
        UIPasteboard.general.string = result
        copied = true
    }
}

// MARK: - Харагдах байдал

struct TranslateView: View {
    @ObservedObject var model: TranslateModel
    let onDone: () -> Void
    private let blue = Color(red: 21 / 255, green: 101 / 255, blue: 192 / 255)

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !model.source.isEmpty {
                        Text(model.source)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(6)
                            .textSelection(.enabled)
                    }
                    switch model.phase {
                    case .loading:
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Орчуулж байна…").foregroundColor(.secondary)
                        }
                        .padding(.top, 8)
                    case .done:
                        Text(model.result)
                            .font(.title3)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(blue.opacity(0.10))
                            .cornerRadius(14)
                        ForEach(model.alts.prefix(4)) { alt in
                            (Text(alt.pos + "  ").foregroundColor(blue) + Text(alt.terms.joined(separator: ", ")))
                                .font(.subheadline)
                        }
                        Button(action: model.copy) {
                            Label(model.copied ? "Хууллаа ✓" : "Орчуулгыг хуулах", systemImage: "doc.on.doc")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(blue)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                        }
                        .padding(.top, 4)
                    case .empty:
                        Text("Орчуулах текст олдсонгүй.\n\nТекстээ хуруугаараа удаан дарж сонгоод → Share… → «Хэлмэрчээр орчуулах».\n\nSafari-д бүтэн хуудсыг орчуулах бол хаягийн мөрний «аА» → Хэлмэрч.")
                            .foregroundColor(.secondary)
                    case .failed:
                        Text("Одоогоор орчуулж чадсангүй. Интернэт холболтоо шалгаад дахин оролдоно уу.")
                            .foregroundColor(.secondary)
                        Button("Дахин оролдох") { Task { await model.run() } }
                    }
                }
                .padding(18)
            }
            .navigationTitle("Хэлмэрч")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Болсон", action: onDone)
                }
            }
        }
        .navigationViewStyle(.stack)
    }
}

// MARK: - Extension-ий оролт

final class ActionViewController: UIViewController {
    private let model = TranslateModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: TranslateView(model: model, onDone: { [weak self] in self?.finish() }))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        loadInput()
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    /// loadItem-ийн хариу ар талын thread дээр ирдэг тул UI-д MainActor-оор дамжуулна.
    nonisolated private func deliver(_ text: String) {
        Task { @MainActor [weak self] in self?.model.start(text) }
    }

    /// Оролтоос текстийг олно: Safari (JavaScript-ийн сонголт) → энгийн текст → URL.
    private func loadInput() {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let plist = UTType.propertyList.identifier
        let plain = UTType.plainText.identifier
        let url = UTType.url.identifier

        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(plist) }) {
            p.loadItem(forTypeIdentifier: plist, options: nil) { [weak self] item, _ in
                let dict = item as? NSDictionary
                let res = dict?[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary
                let sel = (res?["selection"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                self?.deliver(sel)
            }
            return
        }
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(plain) }) {
            p.loadItem(forTypeIdentifier: plain, options: nil) { [weak self] item, _ in
                var text = ""
                if let s = item as? String { text = s }
                else if let d = item as? Data { text = String(data: d, encoding: .utf8) ?? "" }
                else if let u = item as? URL, let s = try? String(contentsOf: u, encoding: .utf8) { text = s }
                self?.deliver(text)
            }
            return
        }
        if let t = items.first(where: { ($0.attributedContentText?.length ?? 0) > 0 })?.attributedContentText?.string {
            deliver(t)
            return
        }
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(url) }) {
            // зөвхөн холбоос ирсэн (текст сонгоогүй) — юу хийхийг заана
            p.loadItem(forTypeIdentifier: url, options: nil) { [weak self] _, _ in self?.deliver("") }
            return
        }
        deliver("")
    }
}
