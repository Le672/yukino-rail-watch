import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        RailMonitorEngine.shared.registerBackgroundTask()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

import Foundation
import UIKit
import Capacitor
import BackgroundTasks
import UserNotifications

private struct RailError: LocalizedError { let message: String; var errorDescription: String? { message } }

final class RailMonitorEngine {
    static let shared = RailMonitorEngine()
    static let refreshID = "bond.yukino.rail.refresh"
    private let storage = UserDefaults.standard
    private let lock = NSRecursiveLock()
    private let queue = DispatchQueue(label: "bond.yukino.rail.monitor", qos: .utility)
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 25
        return URLSession(configuration: config)
    }()
    private var busy = false
    private var currentRequest: URLSessionDataTask?
    private var timer: Timer?
    var onState: (([String: Any]) -> Void)?
    private func protected<T>(_ block: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try block() }
    private func stored(_ key: String) -> [String: Any]? { guard let data = storage.data(forKey: "rail." + key) else { return nil }; return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
    private func save(_ key: String, _ value: [String: Any]) { if let data = try? JSONSerialization.data(withJSONObject: value) { storage.set(data, forKey: "rail." + key) } }
    private func defaults() -> [String: Any] {
        let date = DateFormatter(); date.dateFormat = "yyyy-MM-dd"; date.locale = Locale(identifier: "en_US_POSIX"); date.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return ["queryMode": "train", "date": date.string(from: Date()), "train": "", "from": "", "to": "", "seat": "任意席别", "intervalMinutes": 5, "enabled": false]
    }
    private func settings() -> [String: Any] { stored("settings") ?? defaults() }
    func snapshot() -> [String: Any] { protected { ["settings": settings(), "result": stored("result") as Any? ?? NSNull(), "error": storage.string(forKey: "rail.error") as Any? ?? NSNull(), "checking": busy] } }
    private func publish() { let state = snapshot(); DispatchQueue.main.async { self.onState?(state) } }
    private func validQuery(_ value: [String: Any]) -> Bool {
        if value["queryMode"] as? String == "train" { return (value["train"] as? String ?? "").range(of: "^(?:[GDCZTKYS]\\d{1,4}[A-Z]?|\\d{4})$", options: .regularExpression) != nil }
        let from = value["from"] as? String ?? "", to = value["to"] as? String ?? ""
        return !from.isEmpty && !to.isEmpty && from != to
    }
    private func validate(_ input: [String: Any]) throws -> [String: Any] {
        var next = defaults()
        for key in ["queryMode", "date", "train", "from", "to", "seat"] { if let value = input[key] as? String { next[key] = value.trimmingCharacters(in: .whitespacesAndNewlines) } }
        next["train"] = (next["train"] as! String).uppercased()
        let interval = (input["intervalMinutes"] as? NSNumber)?.doubleValue ?? 5
        guard input["enabled"] as? Bool != true || (interval >= 1 && interval <= 60 && interval == interval.rounded() && (next["date"] as! String).range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil && ["train", "route"].contains(next["queryMode"] as! String)) else { throw RailError(message: "请填写有效日期和 1–60 分钟的间隔") }
        next["intervalMinutes"] = Int(interval); next["enabled"] = input["enabled"] as? Bool ?? false
        if next["enabled"] as? Bool == true && !validQuery(next) { throw RailError(message: "请先填写车次或两个不同的车站") }
        return next
    }
    func configure(_ input: [String: Any]) throws -> [String: Any] {
        let next = try validate(input)
        protected {
            storage.set(storage.integer(forKey: "rail.revision") + 1, forKey: "rail.revision"); save("settings", next)
            for key in ["result", "error", "availability", "checked"] { storage.removeObject(forKey: "rail." + key) }
        }
        scheduleBackground(); publish()
        if next["enabled"] as? Bool == true { check(nil, notify: true) { _ in } }
        return snapshot()
    }
    private func request(_ items: [URLQueryItem], completion: @escaping (Result<[String: Any], Error>) -> Void) -> URLSessionDataTask {
        var url = URLComponents(string: "https://www.yukino.bond/api/rail")!; url.queryItems = items
        var request = URLRequest(url: url.url!); request.setValue("application/json", forHTTPHeaderField: "Accept"); request.setValue("YukinoRailMobile/1.0.0 (iOS)", forHTTPHeaderField: "User-Agent")
        let task = session.dataTask(with: request) { data, response, error in
            if let error = error { completion(.failure(error)); return }
            guard let data = data, data.count <= 4 * 1024 * 1024, let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { completion(.failure(RailError(message: "查询结果格式不正确"))); return }
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { completion(.failure(RailError(message: value["error"] as? String ?? "查询服务暂不可用"))); return }
            completion(.success(value))
        }
        task.resume(); return task
    }
    func stations(_ completion: @escaping (Result<[String: Any], Error>) -> Void) { _ = request([URLQueryItem(name: "mode", value: "stations")], completion: completion) }
    func check(_ supplied: [String: Any]?, notify: Bool, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        queue.async {
            let selected: [String: Any], version: Int
            do {
                (selected, version) = try self.protected {
                    if self.busy { throw RailError(message: "正在查询，请稍后再试") }
                    let value = try supplied.map { try self.validate($0) } ?? self.settings()
                    if supplied == nil && value["enabled"] as? Bool != true { return (value, -1) }
                    guard self.validQuery(value) else { throw RailError(message: "请填写有效车次或区间") }
                    self.busy = true
                    return (value, self.storage.integer(forKey: "rail.revision"))
                }
            } catch { completion(.failure(error)); return }
            if version < 0 { completion(.success([:])); return }
            self.publish()
            var items = [URLQueryItem(name: "date", value: selected["date"] as? String), URLQueryItem(name: "search", value: selected["queryMode"] as? String)]
            if selected["queryMode"] as? String == "train" { items.append(URLQueryItem(name: "train", value: selected["train"] as? String)) }
            else { items += [URLQueryItem(name: "from", value: selected["from"] as? String), URLQueryItem(name: "to", value: selected["to"] as? String)] }
            let task = self.request(items) { outcome in
                self.queue.async {
                    var outcome = outcome
                    if case .success(let value) = outcome, !(value["trains"] is [[String: Any]]) { outcome = .failure(RailError(message: "查询结果缺少车次列表")) }
                    self.protected {
                        self.busy = false; self.currentRequest = nil
                        if version == self.storage.integer(forKey: "rail.revision") {
                            switch outcome {
                            case .success(let value):
                                self.save("result", value); self.storage.set(Date().timeIntervalSince1970, forKey: "rail.checked"); self.storage.removeObject(forKey: "rail.error")
                                if notify && self.settings()["enabled"] as? Bool == true { self.notifyChanges(selected, value) }
                            case .failure(let error): self.storage.set(error.localizedDescription, forKey: "rail.error")
                            }
                        }
                    }
                    self.publish(); completion(outcome)
                }
            }
            self.protected { self.currentRequest = task }
        }
    }
    private func notifyChanges(_ selected: [String: Any], _ result: [String: Any]) {
        let previous = stored("availability") ?? [:]; var current: [String: Any] = [:]
        for train in result["trains"] as? [[String: Any]] ?? [] {
            let code = train["code"] as? String ?? "", date = selected["date"] as? String ?? "", seat = selected["seat"] as? String ?? "任意席别"
            let seats = (train["seats"] as? [[String: Any]] ?? []).filter { $0["available"] as? Bool == true && (seat == "任意席别" || $0["label"] as? String == seat) }
            let key = date + "/" + code; current[key] = !seats.isEmpty
            if !seats.isEmpty && previous[key] as? Bool != true {
                let content = UNMutableNotificationContent(); content.title = code + " 有余票"; content.sound = .default
                let details = seats.map { ($0["label"] as? String ?? "") + " " + ($0["value"] as? String ?? "") }.joined(separator: " · ")
                content.body = date + " " + (train["from"] as? String ?? "") + " → " + (train["to"] as? String ?? "") + " · " + details
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "rail/" + key, content: content, trigger: nil))
            }
        }
        save("availability", current)
    }
    func setForeground(_ active: Bool) {
        DispatchQueue.main.async {
            self.timer?.invalidate(); self.timer = nil
            if active {
                self.checkIfDue()
                self.timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in self.checkIfDue() }
            } else { self.scheduleBackground() }
        }
    }
    private func checkIfDue() {
        let due = protected { settings()["enabled"] as? Bool == true && !busy && Date().timeIntervalSince1970 - storage.double(forKey: "rail.checked") >= Double(settings()["intervalMinutes"] as? Int ?? 5) * 60 }
        if due { check(nil, notify: true) { _ in } }
    }
    func registerBackgroundTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshID, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            self.scheduleBackground()
            task.expirationHandler = { self.protected { self.currentRequest?.cancel() } }
            self.check(nil, notify: true) { outcome in task.expirationHandler = nil; if case .success = outcome { task.setTaskCompleted(success: true) } else { task.setTaskCompleted(success: false) } }
        }
    }
    private func scheduleBackground() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshID)
        let settings = protected { self.settings() }
        guard settings["enabled"] as? Bool == true else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Double(max(15, settings["intervalMinutes"] as? Int ?? 5)) * 60)
        do { try BGTaskScheduler.shared.submit(request) }
        catch { storage.set("系统暂未接受后台检查，前台监控仍可使用。", forKey: "rail.error"); publish() }
    }
}

@objc(RailMonitorPlugin)
public class RailMonitorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailMonitorPlugin"
    public let jsName = "RailMonitor"
    public let pluginMethods: [CAPPluginMethod] = ["getState", "configure", "checkNow", "stations"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    public override func load() { RailMonitorEngine.shared.onState = { [weak self] state in self?.notifyListeners("state", data: state) } }
    @objc func getState(_ call: CAPPluginCall) { call.resolve(RailMonitorEngine.shared.snapshot()) }
    @objc func configure(_ call: CAPPluginCall) {
        guard let value = call.options["settings"] as? [String: Any] else { call.reject("无效查询设置"); return }
        do { call.resolve(try RailMonitorEngine.shared.configure(value)) } catch { call.reject(error.localizedDescription) }
    }
    @objc func checkNow(_ call: CAPPluginCall) {
        guard let value = call.options["settings"] as? [String: Any] else { call.reject("无效查询设置"); return }
        RailMonitorEngine.shared.check(value, notify: false) { outcome in switch outcome { case .success(let result): call.resolve(result); case .failure(let error): call.reject(error.localizedDescription) } }
    }
    @objc func stations(_ call: CAPPluginCall) { RailMonitorEngine.shared.stations { outcome in switch outcome { case .success(let result): call.resolve(result); case .failure(let error): call.reject(error.localizedDescription) } } }
}

class RailBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(RailMonitorPlugin()) }
}
