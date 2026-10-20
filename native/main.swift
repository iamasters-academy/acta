// acta-audio — native helper for Acta.
//   capture [--no-mic] [--no-system] [--aec] [--mic-device UID]
//       Streams 16 kHz mono Int16 PCM to stdout, framed as [channel u8][count u32 LE][samples].
//       channel 0 = microphone ("me"), 1 = system audio ("them"). Status as JSON lines on stderr.
//   detect [--interval S]   JSON line per tick: mic in use + meeting apps/windows.
//   check | request <mic|screen|calendar|all> | devices | events --from MS --to MS
import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreAudio
import CoreMedia
import AppKit
import EventKit

signal(SIGPIPE, SIG_IGN)
let stdoutHandle = FileHandle.standardOutput
let outQueue = DispatchQueue(label: "acta.out")

func log(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

func printJSON(_ obj: Any) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
    stdoutHandle.write(d)
    stdoutHandle.write("\n".data(using: .utf8)!)
}

func emit(_ channel: UInt8, _ samples: [Int16]) {
    guard !samples.isEmpty else { return }
    var data = Data(capacity: 5 + samples.count * 2)
    data.append(channel)
    var n = UInt32(samples.count).littleEndian
    withUnsafeBytes(of: &n) { data.append(contentsOf: $0) }
    samples.withUnsafeBytes { data.append(contentsOf: $0) }
    outQueue.async {
        do { try stdoutHandle.write(contentsOf: data) } catch { exit(0) }
    }
}

// Box-filter resampler to 16 kHz: averages the input samples that fall in each output slot,
// which doubles as a simple anti-alias low-pass when downsampling.
final class Resampler {
    let ratio: Double
    var pos: Double = 0
    var carry: [Float] = []
    init(inRate: Double, outRate: Double = 16000) { ratio = inRate / outRate }
    func process(_ input: [Float]) -> [Int16] {
        let x = carry + input
        var out: [Int16] = []
        out.reserveCapacity(Int(Double(input.count) / ratio) + 4)
        let half = max(0.5, ratio / 2)
        var p = pos
        while p + half < Double(x.count) {
            let lo = max(0, Int((p - half).rounded(.up)))
            let hi = min(x.count - 1, Int((p + half).rounded(.down)))
            var sum: Float = 0
            var cnt = 0
            if hi >= lo { for i in lo...hi { sum += x[i]; cnt += 1 } }
            let v = cnt > 0 ? sum / Float(cnt) : x[min(x.count - 1, Int(p))]
            out.append(Int16(max(-1, min(1, v)) * 32767))
            p += ratio
        }
        let keepFrom = max(0, min(x.count, Int(p - half) - 1))
        carry = Array(x[keepFrom...])
        pos = p - Double(keepFrom)
        return out
    }
}

// MARK: - Core Audio helpers

func audioDevices() -> [AudioDeviceID] {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func hasInput(_ id: AudioDeviceID) -> Bool {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr && size > 0
}

func stringProp(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String {
    var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr, let v = value else { return "" }
    return v.takeRetainedValue() as String
}

func isRunningSomewhere(_ id: AudioDeviceID) -> Bool {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var running: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &running) == noErr && running != 0
}

func defaultInputDevice() -> AudioDeviceID {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var id: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
    return id
}

func micInUse() -> Bool {
    audioDevices().contains { hasInput($0) && isRunningSomewhere($0) }
}

// MARK: - Microphone

final class MicCapture {
    let engine = AVAudioEngine()
    var resampler: Resampler?

    func start(aec: Bool, deviceUID: String?) throws {
        let input = engine.inputNode
        if let uid = deviceUID, !uid.isEmpty,
           let dev = audioDevices().first(where: { hasInput($0) && stringProp($0, kAudioDevicePropertyDeviceUID) == uid }),
           let au = input.audioUnit {
            var id = dev
            AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, UInt32(MemoryLayout<AudioDeviceID>.size))
        }
        if aec {
            do {
                try input.setVoiceProcessingEnabled(true)
                if #available(macOS 14.0, *) {
                    input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
                }
            } catch {
                log(["event": "warn", "source": "mic", "message": "Cancelación de eco no disponible: \(error.localizedDescription)"])
            }
        }
        let fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0 else { throw NSError(domain: "acta", code: 2, userInfo: [NSLocalizedDescriptionKey: "El micrófono no devuelve audio (¿permiso denegado?)"]) }
        resampler = Resampler(inRate: fmt.sampleRate)
        input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buf, _ in
            guard let self, let ch = buf.floatChannelData else { return }
            let n = Int(buf.frameLength)
            let mono = Array(UnsafeBufferPointer(start: ch[0], count: n))
            if let out = self.resampler?.process(mono) { emit(0, out) }
        }
        if aec {
            // Voice processing needs a running output path; route the mic into a muted mixer.
            engine.connect(input, to: engine.mainMixerNode, format: fmt)
            engine.mainMixerNode.outputVolume = 0
        } else {
            _ = engine.mainMixerNode
        }
        engine.prepare()
        try engine.start()
        log(["event": "started", "source": "mic", "sampleRate": fmt.sampleRate, "channels": fmt.channelCount, "aec": aec])
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

// MARK: - System audio (ScreenCaptureKit)

final class SystemCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    var stream: SCStream?
    var resampler: Resampler?
    let queue = DispatchQueue(label: "acta.system")

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "acta", code: 1, userInfo: [NSLocalizedDescriptionKey: "No se encontró ninguna pantalla"])
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 2
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        cfg.queueDepth = 5
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
        log(["event": "started", "source": "system"])
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid,
              let fd = CMSampleBufferGetFormatDescription(sb),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fd) else { return }
        let asbd = asbdPtr.pointee
        if resampler == nil { resampler = Resampler(inRate: asbd.mSampleRate) }
        let nonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        let channels = max(1, Int(asbd.mChannelsPerFrame))
        var mono: [Float] = []
        do {
            try sb.withAudioBufferList { abl, _ in
                if nonInterleaved {
                    let frames = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size
                    mono = [Float](repeating: 0, count: frames)
                    for b in abl {
                        guard let p = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
                        for i in 0..<frames { mono[i] += p[i] }
                    }
                    let k = Float(abl.count)
                    for i in 0..<frames { mono[i] /= k }
                } else if let p = abl[0].mData?.assumingMemoryBound(to: Float.self) {
                    let frames = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size / channels
                    mono = [Float](repeating: 0, count: frames)
                    for i in 0..<frames {
                        var s: Float = 0
                        for c in 0..<channels { s += p[i * channels + c] }
                        mono[i] = s / Float(channels)
                    }
                }
            }
        } catch { return }
        if let out = resampler?.process(mono) { emit(1, out) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log(["event": "error", "source": "system", "message": error.localizedDescription])
    }

    func stop() {
        let s = stream
        stream = nil
        Task { try? await s?.stopCapture() }
    }
}

// MARK: - Meeting detection

let browserBundles: Set<String> = [
    "com.google.Chrome", "com.google.Chrome.canary", "company.thebrowser.Browser", "com.apple.Safari", "com.microsoft.edgemac",
    "com.brave.Browser", "org.mozilla.firefox", "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "com.openai.atlas",
]
let nativeMeetingApps: [String: String] = [
    "us.zoom.xos": "Zoom", "com.microsoft.teams2": "Microsoft Teams", "com.microsoft.teams": "Microsoft Teams",
    "com.tinyspeck.slackmacgap": "Slack", "com.apple.FaceTime": "FaceTime", "com.hnc.Discord": "Discord",
    "Cisco-Systems.Spark": "Webex", "com.webex.meetingmanager": "Webex", "co.teamport.around": "Around",
]

func windowTitles() -> [(owner: String, pid: pid_t, title: String)] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.compactMap { w in
        guard let owner = w[kCGWindowOwnerName as String] as? String, let pid = w[kCGWindowOwnerPID as String] as? pid_t else { return nil }
        return (owner, pid, (w[kCGWindowName as String] as? String) ?? "")
    }
}

func detectMeetings() -> [[String: String]] {
    var out: [[String: String]] = []
    let apps = NSWorkspace.shared.runningApplications
    let byPid = Dictionary(uniqueKeysWithValues: apps.map { ($0.processIdentifier, $0.bundleIdentifier ?? "") })
    let wins = windowTitles()
    var seen = Set<String>()
    for w in wins {
        let bundle = byPid[w.pid] ?? ""
        let t = w.title
        var app: String?
        if browserBundles.contains(bundle) {
            if t.hasPrefix("Meet - ") || t.contains("Google Meet") || t.range(of: "meet.google.com", options: .caseInsensitive) != nil { app = "Google Meet" }
            else if t.contains("Microsoft Teams") && (t.contains("Meeting") || t.contains("Reunión") || t.contains("Call") || t.contains("Llamada")) { app = "Microsoft Teams" }
            else if t.contains("Whereby") { app = "Whereby" }
            else if t.contains("Riverside") { app = "Riverside" }
            else if t.contains("Zoom Meeting") || t.contains("Zoom Workplace") && t.contains("Meeting") { app = "Zoom" }
        } else if bundle == "us.zoom.xos" {
            if t == "Zoom Meeting" || t == "Zoom Webinar" || t.hasPrefix("Zoom Meeting") || t.contains("Reunión de Zoom") { app = "Zoom" }
        } else if bundle.hasPrefix("com.microsoft.teams") {
            if t.contains("Meeting") || t.contains("Reunión") || t.contains("Call") || t.contains("Llamada") || t.contains("Meet now") { app = "Microsoft Teams" }
        } else if bundle == "com.tinyspeck.slackmacgap" {
            if t.lowercased().contains("huddle") { app = "Slack" }
        } else if let name = nativeMeetingApps[bundle], bundle != "us.zoom.xos" {
            if bundle == "com.apple.FaceTime" || bundle == "co.teamport.around" || bundle.contains("webex") || bundle == "Cisco-Systems.Spark" { app = name }
        }
        if let a = app, !seen.contains(a + t) {
            seen.insert(a + t)
            out.append(["app": a, "bundleId": bundle, "title": t])
        }
    }
    // Without screen-recording permission window titles are empty: fall back to running Zoom/Teams.
    if out.isEmpty && !CGPreflightScreenCaptureAccess() {
        for a in apps {
            if let b = a.bundleIdentifier, let name = nativeMeetingApps[b], b == "us.zoom.xos" || b.hasPrefix("com.microsoft.teams") {
                out.append(["app": name, "bundleId": b, "title": ""])
            }
        }
    }
    return out
}

// MARK: - Permissions, devices, calendar

func micStatus() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "not-determined"
    }
}

func calendarStatus() -> String {
    let s = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        switch s {
        case .fullAccess: return "granted"
        case .writeOnly: return "write-only"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "not-determined"
        }
    }
    return s.rawValue == 3 ? "granted" : (s == .denied ? "denied" : "not-determined")
}

func permissionsJSON() -> [String: Any] {
    ["screen": CGPreflightScreenCaptureAccess() ? "granted" : "not-granted", "mic": micStatus(), "calendar": calendarStatus()]
}

func requestMic() -> Bool {
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    AVCaptureDevice.requestAccess(for: .audio) { g in ok = g; sem.signal() }
    sem.wait()
    return ok
}

func requestCalendar() -> Bool {
    let store = EKEventStore()
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { g, _ in ok = g; sem.signal() }
    } else {
        store.requestAccess(to: .event) { g, _ in ok = g; sem.signal() }
    }
    sem.wait()
    return ok
}

func argValue(_ name: String) -> String? {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: name), i + 1 < a.count { return a[i + 1] }
    return nil
}

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "help"

switch command {
case "check":
    printJSON(permissionsJSON())

case "request":
    let what = args.count > 2 ? args[2] : "all"
    var result: [String: Any] = [:]
    if what == "mic" || what == "all" { result["mic"] = requestMic() ? "granted" : micStatus() }
    if what == "screen" || what == "all" { result["screen"] = CGRequestScreenCaptureAccess() ? "granted" : "not-granted" }
    if what == "calendar" || what == "all" { result["calendar"] = requestCalendar() ? "granted" : calendarStatus() }
    printJSON(result)

case "devices":
    let def = defaultInputDevice()
    printJSON(audioDevices().filter(hasInput).map { ["uid": stringProp($0, kAudioDevicePropertyDeviceUID), "name": stringProp($0, kAudioObjectPropertyName), "default": $0 == def] })

case "events":
    let store = EKEventStore()
    let from = Date(timeIntervalSince1970: (Double(argValue("--from") ?? "") ?? Date().timeIntervalSince1970 * 1000) / 1000)
    let to = Date(timeIntervalSince1970: (Double(argValue("--to") ?? "") ?? (Date().timeIntervalSince1970 + 7 * 86400) * 1000) / 1000)
    guard calendarStatus() == "granted" else { printJSON([]); exit(0) }
    let pred = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let evs = store.events(matching: pred).map { e -> [String: Any] in
        [
            "id": e.calendarItemIdentifier, "title": e.title ?? "", "start": Int(e.startDate.timeIntervalSince1970 * 1000),
            "end": Int(e.endDate.timeIntervalSince1970 * 1000), "allDay": e.isAllDay, "location": e.location ?? "",
            "notes": e.notes ?? "", "url": e.url?.absoluteString ?? "", "calendar": e.calendar?.title ?? "",
            "attendees": (e.attendees ?? []).map { p in
                ["name": p.name ?? "", "email": p.url.absoluteString.replacingOccurrences(of: "mailto:", with: ""), "self": p.isCurrentUser]
            },
        ]
    }
    printJSON(evs)

case "detect":
    let interval = Double(argValue("--interval") ?? "2") ?? 2
    let tick = {
        printJSON(["micInUse": micInUse(), "meetings": detectMeetings(), "permissions": permissionsJSON()] as [String: Any])
    }
    tick()
    Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in tick() }
    RunLoop.main.run()

case "capture":
    let wantMic = !args.contains("--no-mic")
    let wantSystem = !args.contains("--no-system")
    var mic = MicCapture()
    let system = SystemCapture()
    if wantMic {
        if micStatus() == "not-determined" { _ = requestMic() }
        let wantAec = args.contains("--aec")
        do { try mic.start(aec: wantAec, deviceUID: argValue("--mic-device")) }
        catch {
            if wantAec {
                log(["event": "warn", "source": "mic", "message": "Cancelación de eco no disponible en este dispositivo; sigo sin ella (\(error.localizedDescription))"])
                mic.stop()
                mic = MicCapture()
                do { try mic.start(aec: false, deviceUID: argValue("--mic-device")) }
                catch { log(["event": "error", "source": "mic", "message": error.localizedDescription, "permission": micStatus()]) }
            } else {
                log(["event": "error", "source": "mic", "message": error.localizedDescription, "permission": micStatus()])
            }
        }
    }
    if wantSystem {
        Task {
            do { try await system.start() }
            catch {
                log(["event": "error", "source": "system", "message": error.localizedDescription,
                     "permission": CGPreflightScreenCaptureAccess() ? "granted" : "not-granted"])
            }
        }
    }
    let stopAll: () -> Void = {
        mic.stop()
        system.stop()
        outQueue.sync {}
        exit(0)
    }
    for sig in [SIGTERM, SIGINT] {
        signal(sig, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        src.setEventHandler(handler: stopAll)
        src.resume()
        _ = Unmanaged.passRetained(src)
    }
    // Exit when the parent goes away.
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in if getppid() == 1 { stopAll() } }
    RunLoop.main.run()

default:
    FileHandle.standardError.write("uso: acta-audio capture|detect|check|request|devices|events\n".data(using: .utf8)!)
    exit(1)
}
