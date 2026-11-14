# Хэлмэрч — Claude-д зориулсан төслийн тайлбар

Хэрэглэгчтэй **монголоор** харилцана. Код дахь тайлбарууд (comment) монголоор бичигдсэн — шинэ кодонд ч монголоор бичнэ.
Шинэ санаа, том өөрчлөлтийг эхлээд хэрэглэгчтэй ярилцаж тохирсны дараа хийнэ (хэрэглэгч "эхлээд ярилцъя" гэдгийг чухалчилдаг).

## Юу хийдэг програм вэ

Windows програм + Chrome өргөтгөл. Анх PMP шалгалтад бэлдэж буй найз охинд зориулж хийгдсэн, одоо танил хүрээнд тараагдаж байгаа (цаашдаа төлбөртэй болгох төлөвлөгөөтэй).

- **Видео хадмал** — Chrome дээрх ямар ч видеог монгол хадмалтай болгоно (видеоны «МН» товч эсвэл Alt+M, анхдагчаар унтраалттай).
- **PDF** — PDF-ийг хүснэгт, загвар хэвээр монгол хуудас болгож хажууд нь харуулна.
- **Вэб хуудас** — Эх / 2 хэл / Монгол горим (бүх хуудсанд хадгалагдана, анхдагч "Эх" = огт өөрчлөхгүй).
- **Үг, текст** — Ctrl + хулгана үг дээр, текст сонгох, баруун товчны цэс.
- **Дэлгэцээс** — Ctrl+Alt+T, хэсгийг зурж Gemini-ээр уншиж орчуулна.

## Бүтэц

| Хавтас / файл | Үүрэг |
|---|---|
| `server/hadmal_server.py` | Гол сервер (http://127.0.0.1:8765). Видео таних (yt-dlp, ffmpeg), Whisper (faster-whisper, GPU), хадмалын эх сурвалжууд, орчуулгын гинж, кэш, хэрэглээний тоолуур. `VERSION` энд. |
| `server/hadmal_app.pyw` | Desktop програм: tray дүрс, Ctrl+Alt+T, тохиргооны цонхыг Edge-ийн "app" горимоор нээнэ, splash (message.txt). |
| `server/ui/index.html` | Тохиргооны цонх (вэб UI). `/ui/api` руу `t` (ui_token.txt) токентой хүсэлт илгээнэ. |
| `server/logo.py` | Өлзий хээтэй лого — PIL-ээр зурна. |
| `extension/content.js` | Видео дээрх «МН» товч, хадмал харуулах; `video.textTracks` болон дэлгэц дээрх хадмалыг уншиж ашиглана. |
| `extension/pagetr.js` | Вэб хуудас орчуулах. **Хуудсанд шинэ элемент НЭМДЭГГҮЙ** — орчуулгыг `data-hm-tr` атрибут + `::after` CSS-ээр харуулна (React/YouTube эвдрэхгүйн тулд). Энэ зарчмыг бүү эвд. |
| `extension/pdfviewer.js` | pdf.js дээр суурилсан PDF үзүүлэгч, загвараар нь монгол хуудас зурна. |
| `extension/translate.js` | Ctrl+үг, сонгосон текст, баруун товчны орчуулга. |
| `extension/popup.*` | Өргөтгөлийн цэс (Эх/2 хэл/Монгол, орчуулгын хэлбэр, сайт хасах, асаах/унтраах). |
| `extension/background.js` | Өргөтгөл ↔ сервер холболт, видео/хадмалын холбоос барих, PDF-ийг өөрийн үзүүлэгч рүү чиглүүлэх, баруун товчны цэс. |
| `installer/helmerch.nsi` | NSIS суулгагч. |
| `installer/build_setup.sh` | Setup.exe бүтээх скрипт (**Linux** дээр ажилладаг). |
| `installer/art` | Суулгагчийн дүрс, зураг (өлзий). |
| `tests/` | `run_tests.ps1` — бүх тест (JS/Python синтакс, `test_server.py`, `pages/*.html`-ийг Chrome headless-ээр). |

## Сүүлд нэмэгдсэн (1.11.0)

- **Алдаа харуулахгүй**: орчуулга бүтэлгүйтвэл background.js 4 хүртэл удаа дахин оролдоно; хуудас/PDF/хадмал чимээгүй дахин оролдоно. Хэрэглэгчид улаан "Алдаа" бүү гарга.
- **Орчуулгын кэш диск дээр**: `cache/translations.json` (зөвхөн AI орчуулга; Google-ийн нөөцийг кэшлэхгүй).
- **Миний үгс**: Ctrl+үг, сонгосон ганц үг → `words.json`; тохиргооны цонхонд жагсаалт, давтах карт.
- **Шинэ хувилбар шалгах**: `UPDATE_REPO` (hadmal_server.py) = "owner/repo" — GitHub Releases-ийн tag `vX.Y.Z` + `Helmerch-Setup-X.Y.Z.exe` хавсралт. Хоосон бол унтраалттай.
- **pagetr.js**: iframe дотор ч ажиллана (товч зөвхөн үндсэн хуудсанд); нуугдаж байгаад харагдсан хэсгийг (class/hidden/aria-hidden) ажиглана; «Эх»-ээс буцахад дахин тулгана; булангийн товч сайтын товчийг халхлахгүй; 📝 шалгалтын горим (`examMode`).

## Утасны апп (`mobile/`, iOS + Android)

Expo SDK 58 (React Native) — **`mobile/AGENTS.md`-г заавал уншина** (Expo-ийн API SDK бүрт өөрчлөгддөг, санах ойгоор бүү бич).
- Таб: Хөтөч (апп доторх браузер) · Видео · PDF · Зураг (камер/OCR) · Миний үгс · Тохиргоо.
- **Видео** (`src/web/video.ts`): YouTube холбоос → m.youtube.com; тоглуулагчийн `/api/timedtext` хүсэлтийг fetch/XHR hook-оор барьж бүх хадмалыг урьдчилан орчуулна (YouTube шууд татахад токен шаарддаг тул барих нь цорын ганц арга; headless/автомат браузерт YouTube хоосон буцаадаг). Олдохгүй бол дэлгэц дээрх хадмалыг шууд орчуулна.
- **Safari өргөтгөл** (`targets/safari/`, `@bacons/apple-targets`): `assets/background.js` нь `scripts/build-safari.mjs`-ээр аппын translator.ts-ээс бүтнэ (store → `src/safari/store-shim.ts`); pagetr.js хуулагдана. Түлхүүр өргөтгөлийн цэсэнд тусдаа.
- **Share цэс «Хэлмэрчээр орчуулах»** (`targets/translate/`, action extension, SwiftUI): ямар ч аппад текст сонгоод Share → энэ. Google-ээр (түлхүүргүй) орчуулна; Safari-д `assets/index.js` сонголтыг уншина. Swift-ийг Windows дээр шалгах боломжгүй — алдааг CI build-ээс харна.
- **iPhone build**: `.github/workflows/iphone-ipa.yml` — `mobile-vX.Y.Z` tag push → гарын үсэггүй .ipa (prerelease) → AltStore/SideStore-оор суулгана.
- **Хөтөч нь `extension/pagetr.js`-ийг өөрчлөлтгүй ашиглана**: `scripts/sync-web.mjs` → `src/web/extension.generated.ts` (`npm start`/`typecheck` бүрд). `src/web/inject.ts`-ийн `bridgeJs` нь `chrome.runtime/storage`-ийг `ReactNativeWebView.postMessage` руу дамжуулна. pagetr.js-д `window.__hmNoPill` — утсанд булангийн товч гаргахгүй.
- Python сервер утсанд байхгүй → орчуулгын гинж `src/lib/translator.ts` (hadmal_server.py-тай ижил логик; засвар хийвэл хоёуланг нь).
- Түлхүүрүүд `expo-secure-store`-д (Keychain/Keystore); тохиргоо, үгс, кэш `Paths.document`-ийн JSON файлд.
- Хязгаар: iframe дотор орчуулахгүй (Android WebView зөвхөн үндсэн хуудсанд оруулдаг); видео хадмал нь зөвхөн сайт өөрөө хадмалтай үед; бусад аппаас «Share»-ээр хүлээж авах нь development build шаардана.
- Шалгах: `cd mobile; npx tsc --noEmit; npx expo lint` + `tests\run_tests.ps1`-ийн 5-р алхам (`mobile/tests/*_page.ts`).
- iPhone дээр турших: `cd mobile; npx expo start` → iPhone-ий камераар QR уншуулна (Expo Go). iOS-д тараах: Apple Developer ($99/жил) + `npx eas-cli@latest build -p ios`.

## Орчуулгын гинж (чухал)

1. **Хурдан шат**: хурдан AI (Gemini flash-lite / GPT mini) → бүтэхгүй бол Google (нөөц).
2. **Чанарын шат**: хүчтэй AI (Claude → Copilot → Gemini) ✨-ээр сольдог.
3. `/translate` хариу `tier`: `"pro"` | `"fast"` | `"google"`. Клиент `ai`/`tier`-ээр хоёр дахь шатыг хийх эсэхээ шийднэ.
4. Видео хадмалын AI сайжруулалт өдөрт `VIDEO_AI_DAILY` (300) хүртэл, видео хүсэлт текстийг түрүүлж явна.
5. Gemini 429 → загварыг алгасна (давтагдвал 30 мин), Google 429 → 3 хаягийн дунд солино.
6. Түлхүүрүүд суусан хавтсанд: `gemini_key.txt`, `github_token.txt`, `api_key.txt` (Claude). Эдгээрийг хэзээ ч кодонд, zip-д, логт бүү оруул.

Мэдэгдэж буй байдал: хэрэглэгчийн ажлын сүлжээнд Copilot (models.github.ai) хаагддаг; Google-ийн үнэгүй хаяг 429 өгөх нь элбэг; Gemini үнэгүй эрх хязгаартай.

## Нэр

Програмын нэр зөвхөн **Хэлмэрч** (Helmerch) — өлзий лого, цэнхэр. Өмнө нь байсан «My Heart ♥» (зүрхтэй) хувилбарыг хассан; дахин бүү нэм.
Хуучин нэртэй (Mongol hadmal, My Heart) товчлолуудыг програм эхлэхдээ өөрөө «Хэлмэрч» болгож солино.

## Суусан програм

- Хавтас: `%LOCALAPPDATA%\Helmerch` (`python\` дотор бүрэн Python 3.13, `server\`, `extension\`, тохиргоо, түлхүүр, `hadmal.log`).
- Chrome өргөтгөлийг `%LOCALAPPDATA%\Helmerch\extension`-оос "Load unpacked"-оор ачаалсан.

### Жижиг засварыг шууд туршиж үзэх (дахин суулгахгүй)

1. Өөрчилсөн файлаа `%LOCALAPPDATA%\Helmerch\server\` эсвэл `...\extension\` руу хуулна.
2. Сервер/програмын файл бол: цагны хажуугийн дүрс → **Дахин эхлүүлэх**.
3. Өргөтгөлийн файл бол: `chrome://extensions` → ↻, дараа нь хуудсаа F5.
4. Алдааг `%LOCALAPPDATA%\Helmerch\hadmal.log`-оос харна.

## Шинэ хувилбар гаргах

1. **Хувилбарын дугаар** нэмэх (хоёуланд нь ижил):
   - `server/hadmal_server.py` → `VERSION = "x.y.z"`
   - `extension/manifest.json` → `"version": "x.y.z"`
   (Ялгаатай бол PDF үзүүлэгч дээр ⚠ анхааруулга гарна.)
2. **Шалгах**:
   - `powershell -ExecutionPolicy Bypass -File tests\run_tests.ps1` — бүгд ногоон байх ёстой
   - Засвар бүрт тохирох тестийн хуудсыг `tests/pages/`-д нэмнэ (`stub.js` + `check([...])`)
   - Шинэ боломжийг дээрх "шууд туршиж үзэх" аргаар өөрийн компьютер дээр туршина.
3. Хэрэглэгчид харагдах өөрчлөлт бол **`ZAAVAR.html`** (ба шаардлагатай бол `README.txt`)-г шинэчилнэ.
4. **Setup.exe бүтээх** — Linux (эсвэл Windows дээр WSL Ubuntu) дээр:
   ```bash
   sudo apt install nsis                       # нэг удаа
   bash installer/build_setup.sh /tmp/hm-build        # → Helmerch-Setup-x.y.z.exe
   ```
   - Анх удаа micromamba-аар Windows-ийн Python 3.13 (conda-forge, tkinter-тэй) болон PyPI-ийн `win_amd64` wheel-үүдийг татна (`/tmp/hm-build/pyenv`). Дараагийн удаа дахин ашиглана.
   - Нэг суулгагч ~135 MB, бүтээхэд ~5 мин.
5. **Тараах**: GitHub Releases-д `vX.Y.Z` tag-тай release үүсгэж Setup.exe-г хавсаргавал (`UPDATE_REPO` тохируулсан бол) хэрэглэгчдийн програмд «Шинэчлэх» гарна. Эсвэл Setup.exe-г Google Drive / флашаар өгнө. Хуучин хувилбарын дээр суулгахад тохиргоо, түлхүүр хадгалагдана; хэрэглэгч дараа нь `chrome://extensions` → ↻ дарна.
6. Суулгагч гарын үсэггүй тул "Windows protected your PC" → More info → Run anyway гарна (хэвийн).

## Код бичихэд анхаарах

- Файлууд UTF-8. `installer/helmerch.nsi` нь Unicode NSIS.
- Python 3.13 (суулгагч доторх), Windows дээр ажиллана — `subprocess` дуудлагад хар цонх гаргахгүй (`CREATE_NO_WINDOW`).
- Сервер `127.0.0.1` дээр л сонсоно; тохиргоо өөрчлөх `/ui/api` нь токенгүй хүсэлтийг хүлээж авахгүй — үүнийг сулруулж болохгүй.
- Хуудсан дээрх өөрчлөлт "Эх" горимд **огт** хийгдэх ёсгүй.
- Видео хадмал анхдагчаар унтраалттай, хэрэглэгч асаах хүртэл серверт юу ч илгээхгүй.
- Хэрэглэгчийн хувийн файл (`message.txt`, түлхүүрүүд, `settings.json`, `usage.json`, `words.json`, `cache/`) суулгагч/zip-д орохгүй.
