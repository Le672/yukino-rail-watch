# Android / iOS 客户端：安装与发行

手机版本独立于 Windows 版本，版本号由 [`mobile-version.json`](../mobile-version.json) 管理。首版为 **1.0.0 / build 1**，包名与 Bundle ID 均为 `bond.yukino.rail`。最低 Android 7.0（API 24）、iOS 15。Windows 便携版仍为 1.8.3。

## 先理解三个文件

| 产物 | 用途 | 能否直接安装到手机 |
| --- | --- | --- |
| `*-debug.apk` | Android 预览与真机测试，使用临时测试签名 | 可以；需允许该下载来源安装应用 |
| `*-release.apk` / `*-signed.aab` | 使用你自己的密钥签名的正式版本 / Google Play 上传包 | APK 可以；AAB 要由应用商店或 bundletool 转为 APK |
| `*-unsigned.aab` | 无签名的 Android 构建结果 | 不可以；须用自己的上传密钥签名后提交 |
| `*-simulator.zip` | Xcode iPhone 模拟器使用的 `.app` | 只能装到 Mac 上的 iOS 模拟器，不能装到实体 iPhone |

源码、测试 APK 与模拟器应用的公开预览版本在 [GitHub Releases](https://github.com/Le672/yukino-rail-watch/releases)。模拟器包不是 IPA；本仓库不声称已获 App Store 或任何 Android 商店审核。

## 1. 手机版做了什么

- 独立的手机布局：底部「余票 / 位置 / 说明」导航、紧凑车次卡片、窄屏表单、系统安全区域；本地打包页面，不依赖加载整张网站页面。
- 原生定位、原生通知。查询条件和最近结果在本机保存，所选席别从无票变为有票时提醒；首次开启也提醒当前已有的票。
- 手机前台按所设 **1–60 分钟**检查。Android 后台由 WorkManager 执行，周期至少 **15 分钟**，省电策略可延迟；iOS 使用 BGAppRefreshTask，具体执行时间由系统决定，不能保证固定间隔，强制退出后不继续。应用状态里会说明这些差别。[Android 规则](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)、[Apple 调度规则](https://developer.apple.com/documentation/backgroundtasks/bgtaskrequest/earliestbegindate)。
- GPS 仅在前台位置页主动开启后使用；进入后台停止读取。精确坐标在设备上处理，地图服务会收到当前视野的瓦片请求。

如果后续要做到 iOS 锁屏后也尽可能及时到票，需要另建服务器监控、设备订阅和 APNs 推送服务；本版没有把不确定的后台刷新伪装成每分钟实时推送。

## 2. Android：先安装预览 APK

1. 在 Android 手机上进入 [Releases](https://github.com/Le672/yukino-rail-watch/releases)，选择 `Android / iOS 1.0.0 Preview`，展开 Assets，下载 `Yukino-Rail-Watch-Android-1.0.0-debug.apk`。
2. 打开文件，按系统提示允许当前浏览器或文件管理器安装应用，然后安装。这个版本是测试包，调试标记会保留。
3. 输入日期和车次，点「立即查询」。再点「开启监控」，允许系统通知；前台应立即检查。位置页点开启 GPS 后才申请定位。
4. 测试锁屏、前后台切换、撤销权限及无网络情况。部分品牌手机还需在系统设置允许应用后台活动；Android 强行停止应用后，要重新打开才能恢复任务。

每次 CI 的 debug 签名可能不同，后续安装可能需要先卸载旧测试版，卸载会清除本机设置。正式发行必须采用固定的私有密钥。[Android 签名说明](https://developer.android.com/studio/publish/app-signing)。

## 3. Android：用 Windows 构建自己的正式版

### 安装环境

安装 Node.js 22+、pnpm 11、Android Studio 2025.2.1+，并在 SDK Manager 安装 Android SDK Platform 36、Build-Tools 36.0.0；使用 Java 21。原生项目在 `android/`。[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)。

第一次取得代码：

```powershell
git clone https://github.com/Le672/yukino-rail-watch.git
cd yukino-rail-watch
pnpm install --frozen-lockfile
pnpm test
pnpm mobile:sync
pnpm mobile:android
```

最后一步在 Android Studio 打开 `android/`。如果 SDK 路径未自动识别，通过 Studio 的设置选择 SDK 目录；`android/local.properties` 是本机配置，已忽略。

### 最容易的正式打包方式

1. 在 Android Studio 选择 **Build → Generate Signed App Bundle or APK**。
2. 分享给用户选 **APK**；上传 Google Play 选 **Android App Bundle**。
3. 初次选择 **Create new**，把 keystore 保存在仓库以外，设置私有密码和 key alias。保存离线备份；之后升级同一应用继续使用同一签名。
4. 选择 `release`，完成构建。APK 在 `android/app/build/outputs/apk/release/`，AAB 在 `android/app/build/outputs/bundle/release/`；Studio 向导也可能将签名产物放在你选择的目录。

### 已有密钥时用命令行

下面只填写你自己的文件路径与别名，密码使用交互输入，不写进源码：

```powershell
$env:RAIL_ANDROID_KEYSTORE_PATH = 'D:\private-signing\yukino-rail.jks'
$env:RAIL_ANDROID_KEY_ALIAS = 'yukino-rail'
$railStoreSecret = Read-Host 'Keystore 密码' -AsSecureString
$railKeySecret = Read-Host 'Key 密码' -AsSecureString
$env:RAIL_ANDROID_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', $railStoreSecret).Password
$env:RAIL_ANDROID_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $railKeySecret).Password
try {
  pnpm mobile:sync
  Push-Location android
  try { .\gradlew.bat :app:assembleRelease :app:bundleRelease }
  finally { Pop-Location }
} finally {
  Remove-Item Env:RAIL_ANDROID_STORE_PASSWORD, Env:RAIL_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
```

仓库已忽略 `.jks`、`.keystore`、`.p12` 与描述文件，但仍应把私钥保存在仓库外。四个签名变量必须一起提供；未配置时构建出来的 release 产物是未签名状态。[官方命令行构建与签名](https://developer.android.com/build/building-cmdline)。

### 发行到 Google Play

1. 注册 [Play Console](https://play.google.com/console/)，目前开发者注册费为 **25 美元一次性**，按后台要求完成身份及设备验证。[注册说明](https://support.google.com/googleplay/android-developer/answer/6112435)。
2. 创建免费应用，填名称、分类、简介、图标和手机截图；本应用可选「工具」或「旅游与本地出行」。明确写「独立查询工具，非 12306 官方」。
3. 隐私政策填写 `https://cr.yukino.bond/rail-privacy.html`。按实际查询、地图供应商、IP 日志和定位处理情况填写 Data safety，不能仅凭没有统计 SDK 就勾选所有数据均不处理。
4. 启用 Play App Signing，向内部测试上传用你自己的 upload key 签名的 AAB，邀请真机测试者。
5. 2023 年 11 月 13 日之后创建的个人账号通常须先完成至少 **12 人连续参与 14 天**的封闭测试，才能申请生产权限；以账号页面实际要求为准。[Google 测试要求](https://support.google.com/googleplay/android-developer/answer/14151465)。
6. 完成内容分级、权限用途、商店资料及审核，获批准后发布。以后每次更新都增加 `mobile-version.json` 中的 `build`，需要对用户展示的新版本同时增加 `version`。

### 直接分享或国内 Android 商店

正式签名 APK 可作为 GitHub Release 附件或网站下载发行；用户需要允许下载来源安装。国内商店分别有开发者实名认证、APP 备案、隐私和权限审核要求，按所选商店的官方流程准备。应用包内已提供隐私入口和按需授权，但备案和主体信息须由你本人办理。

## 4. iOS：真机、TestFlight 和 App Store

### 你需要准备

- **Mac 与 Xcode 26+**，或能使用同等 Xcode 环境的云端 Mac。Windows 可以改共享代码、查看 CI 结果，但不能直接运行 Xcode 来给 iPhone 签名。
- Apple ID；公开 TestFlight / App Store 发行需要 [Apple Developer Program](https://developer.apple.com/programs/enroll/)，目前 **99 美元 / 年**。
- Apple 自 2026 年 4 月 28 日起要求提交使用 Xcode 26+、iOS 26+ SDK 构建；应用最低支持 iOS 15 与构建所用 SDK 是两件事。[Apple SDK 要求](https://developer.apple.com/news/?id=ueeok6yw)。

### 在 Mac 上首次运行

```bash
git clone https://github.com/Le672/yukino-rail-watch.git
cd yukino-rail-watch
pnpm install --frozen-lockfile
pnpm mobile:sync
pnpm mobile:ios
```

Xcode 会打开 `ios/App/App.xcodeproj`；工程采用 Swift Package Manager，不需要安装 CocoaPods。

1. 选中左侧 **App** 项目，再选 **App target → Signing & Capabilities**。
2. 登录自己的 Apple ID，选择你的 Team，勾选 **Automatically manage signing**。Bundle Identifier 使用 `bond.yukino.rail`；若它已被其他团队注册，须同时修改 Capacitor 配置和两个原生工程的标识再构建，不能只改网页名称。
3. 连接 iPhone，按手机系统要求打开开发者模式并信任 Mac，在 Xcode 选择这台 iPhone，点 Run。
4. 免费个人团队可用来短期在自己的设备上测试，受 Apple 的免费签名限制；它不能代替付费账号公开发行。

### 先发 TestFlight

1. 付费开发者账号完成协议后，在 [App Store Connect](https://appstoreconnect.apple.com/) 点 **我的 App → ＋ → 新建 App**。选择 iOS，名称 `Yukino 余票`，主要语言简体中文，选择 Bundle ID，SKU 可填 `yukino-rail-watch`。[新建 App 官方说明](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app)。
2. Xcode 选择 **Any iOS Device** 作为目标，执行 **Product → Archive**。
3. 在 Organizer 选择归档，执行 **Distribute App → App Store Connect → Upload**。处理完成后，构建会出现在 App Store Connect 的 TestFlight 中。
4. 先邀请内部测试者；开放外部测试通常需要 TestFlight 审核。测试完整查询、GPS 权限、拒绝通知、锁屏和后台恢复，不只检查首页能否打开。

### 提交 App Store

1. 填简介、关键词、支持网址 `https://github.com/Le672/yukino-rail-watch/issues`、隐私政策网址 `https://cr.yukino.bond/rail-privacy.html`，上传从实际客户端取得的所需尺寸截图。
2. 填 App 隐私与内容分级；按实际第三方网络行为填写定位及数据处理选项。工程已包含 `PrivacyInfo.xcprivacy`，原生本机 UserDefaults 使用原因为 `CA92.1`；第三方插件自带清单并参与构建。[Apple 隐私清单说明](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)。
3. 审核备注说明：无需登录；输入在 12306 可查询的车次和日期即可测试；GPS 与通知是可选权限，后台刷新受系统安排；本应用非官方、不售票、不自动购票。
4. 选择处理完成的构建，提交审核。获准后手动或自动发布。中国大陆供应需按 Apple 后台要求提供有效 APP / ICP 备案资料，网站已有备案不能自动代替应用所需信息。[Apple 中国大陆资料要求](https://developer.apple.com/cn/help/app-store-connect/reference/app-information/app-information)。

## 5. GitHub 自动构建怎么用

仓库的 [Build Android and iOS apps](https://github.com/Le672/yukino-rail-watch/actions/workflows/build-mobile.yml) 会在手机相关代码推送到 `main` 时执行：

1. 安装锁定依赖，运行测试，打包独立手机版资源。
2. Android / Java 21 环境编译测试 APK 和 release AAB；有签名 Secrets 时额外生成正式签名 APK。
3. macOS / Xcode 环境编译 iOS 模拟器应用，实际启动并保存模拟器截图和日志。模拟器附件只用于 Mac 模拟器；不替代真机签名与审核。

构建成功后打开运行记录，在底部 **Artifacts** 下载 `Yukino-Rail-Watch-Android` 或 `Yukino-Rail-Watch-iOS`。下载 Actions 附件通常需要登录 GitHub；Release 附件可公开下载。

### 配置 Android CI 正式签名（可选）

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

| Secret | 内容 |
| --- | --- |
| `RAIL_ANDROID_KEYSTORE_BASE64` | 你自己的 keystore 的 Base64 内容 |
| `RAIL_ANDROID_STORE_PASSWORD` | Keystore 密码 |
| `RAIL_ANDROID_KEY_ALIAS` | Key alias |
| `RAIL_ANDROID_KEY_PASSWORD` | Key 密码 |

在本机把文件转换为 Base64 后复制到 GitHub Secret，不提交文本文件。流水线解码到临时目录，构建完成清理；没有配置这些 Secrets 也可以正常构建预览包。

### 发一个新的公开预览版本

1. 增加 `mobile-version.json` 的 `version` 与 `build`；更新 `docs/releases/mobile-版本号.md`。
2. 推送并先检查 CI 成功。
3. Actions 选择 **Run workflow**，勾选 `publish`。两端构建成功后创建 **prerelease** `mobile-v版本号`，上传 APK、明确标记签名状态的 AAB、模拟器 ZIP 和 SHA256 校验文件。它保留 Windows 正式版作为 Latest，不覆盖旧版本附件。

目前 CI 没有 Apple 分发证书和描述文件，因此不生成可真机安装的 IPA。需要自动 TestFlight 时，先用自己的账号完成一次 Xcode 上传，再按 Apple 的证书、描述文件和 App Store Connect API key 流程配置单独的签名上传任务；不要把这些私钥提交到仓库。

## 6. 商店素材与数据许可

- 应用图标：iOS 的 1024 × 1024 不透明图在 `ios/App/App/Assets.xcassets/AppIcon.appiconset/`；Android 的多密度与自适应图在 `android/app/src/main/res/mipmap-*`。
- 应用功能、权限文案与公开隐私页已准备。商店截图须来自正式签名版本或对应模拟器的实际运行，不把网页截图当手机客户端截图。
- RailGo 要求显著署名、非商业使用及禁止公开接口中转；客户端保留署名并直接查询。卫星瓦片采用 EOX 非商业许可；出售应用、插广告或收费前需取得相应许可或更换服务。[RailGo 说明](https://api.railgo.dev/)、[EOX 许可](https://cloudless.eox.at/documentation/license)。
- 车型插画与软件依赖许可见 `public/rail-third-party-notices.txt` 及现有车型文档。

## 7. 升级和维护

每次发布增加 build；共享 TypeScript 修改后先运行 `pnpm test` 和 `pnpm mobile:sync`，避免旧 HTML 被继续打包。Android 正式签名与 iOS Team / Bundle ID 保持一致。修改原生 Java / Swift 后必须分别重新编译原生工程，单独网页构建成功不能证明手机包成功。
