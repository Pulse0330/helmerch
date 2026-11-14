; Хэлмэрч — Windows суулгагч (NSIS 3, Unicode)
; Бүтээх: installer/build_setup.sh  (makensis -DVERSION=x.y.z -DSTAGE=<бэлдсэн хавтас> helmerch.nsi)
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGE
  !define STAGE "stage"
!endif
!ifndef OUTFILE
  !define OUTFILE "Helmerch-Setup.exe"
!endif

!ifndef APPNAME
  !define APPNAME "Хэлмэрч"
!endif
!ifndef ART
  !define ART "art"
!endif
!define APPID "Helmerch"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
!define OLDDIR "$LOCALAPPDATA\MongolHadmal"

Name "${APPNAME}"
Caption "${APPNAME} ${VERSION} — суулгах"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${APPID}"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=0 "FileDescription" "${APPNAME} — видео, PDF, текстийн монгол орчуулга"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "${APPNAME}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!define MUI_ICON "${ART}\helmerch.ico"
!define MUI_UNICON "${ART}\helmerch.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ART}\wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ART}\wizard.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${ART}\header.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Суулгалтыг цуцлах уу?"

; --- хуудсууд
!define MUI_WELCOMEPAGE_TITLE "${APPNAME}-д тавтай морил"
!define MUI_WELCOMEPAGE_TEXT "${APPNAME} нь Chrome дээр үзэж буй видеог монгол хадмалтай болгож, PDF болон вэб хуудсыг монгол руу орчуулдаг програм.$\r$\n$\r$\n  •  Видео — монгол хадмал$\r$\n  •  PDF — хүснэгт, загвар хэвээр монгол хуудас$\r$\n  •  Үг, текст — хулгана очиход орчуулга$\r$\n  •  Дэлгэцээс — Ctrl+Alt+T$\r$\n$\r$\nСуулгахад 1–2 минут болно. Үргэлжлүүлэх бол «Цааш» дарна уу."
!insertmacro MUI_PAGE_WELCOME

!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_PAGE_HEADER_TEXT "Юу суулгах вэ"
!define MUI_PAGE_HEADER_SUBTEXT "Видео картын хурдан горимыг NVIDIA карттай үед сонгоно уу."
!insertmacro MUI_PAGE_COMPONENTS

Page custom KeyPage KeyPageLeave

!define MUI_PAGE_HEADER_TEXT "Суулгаж байна"
!define MUI_PAGE_HEADER_SUBTEXT "Түр хүлээнэ үү…"
!insertmacro MUI_PAGE_INSTFILES

Page custom ChromePage

!define MUI_FINISHPAGE_TITLE "${APPNAME} бэлэн боллоо"
!define MUI_FINISHPAGE_TEXT "Цагны хажууд ${APPNAME}-ийн дүрс гарна. Компьютер асахад өөрөө эхэлнэ.$\r$\nВидео дээр «МН» товч эсвэл Alt+M, дэлгэцээс орчуулах: Ctrl+Alt+T."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_RUN_TEXT "${APPNAME}-ийг одоо нээх"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\ZAAVAR.html"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Ашиглах зааврыг унших"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Mongolian"

; --- монгол товчны бичиг (Mongolian.nlf-ийн дутууг нөхнө)
MiscButtonText "< Буцах" "Цааш >" "Болих" "Хаах"
InstallButtonText "Суулгах"
UninstallButtonText "Устгах"

Var KeyEdit
Var GeminiKey
Var HasGpu

; ----------------------------------------------------------------------------- хуучин файл шилжүүлэх
!macro MoveOld NAME
  ${IfNot} ${FileExists} "$INSTDIR\${NAME}"
  ${AndIf} ${FileExists} "${OLDDIR}\${NAME}"
    CopyFiles /SILENT "${OLDDIR}\${NAME}" "$INSTDIR\${NAME}"
  ${EndIf}
!macroend

!macro _TrimSpaces VAR
  Push ${VAR}
  Call TrimFn
  Pop ${VAR}
!macroend
!define TrimSpaces "!insertmacro _TrimSpaces"

Function TrimFn
  Exch $R1
  Push $R2
  loop1:
    StrCpy $R2 $R1 1
    StrCmp $R2 " " trim1
    StrCmp $R2 "$\r" trim1
    StrCmp $R2 "$\n" trim1
    StrCmp $R2 "$\t" trim1
    Goto loop2
  trim1:
    StrCpy $R1 $R1 "" 1
    Goto loop1
  loop2:
    StrCpy $R2 $R1 1 -1
    StrCmp $R2 " " trim2
    StrCmp $R2 "$\r" trim2
    StrCmp $R2 "$\n" trim2
    StrCmp $R2 "$\t" trim2
    Goto done
  trim2:
    StrCpy $R1 $R1 -1
    Goto loop2
  done:
  Pop $R2
  Exch $R1
FunctionEnd

!macro DelLinks NAME
  Delete "$DESKTOP\${NAME}.lnk"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$SMSTARTUP\${NAME}.lnk"
!macroend

; ----------------------------------------------------------------------------- ажиллаж буйг хаах
!macro StopRunning
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe' OR Name='python.exe'\" | Where-Object { $$_.CommandLine -like '*hadmal_*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $$_.CommandLine -like '*ui-profile*' -and ($$_.CommandLine -like '*Helmerch*' -or $$_.CommandLine -like '*MongolHadmal*') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  Sleep 800
!macroend

; ----------------------------------------------------------------------------- хэсгүүд
Section "${APPNAME} (заавал)" SecMain
  SectionIn RO
  SetShellVarContext current
  DetailPrint "Ажиллаж буй програмыг хааж байна…"
  !insertmacro StopRunning

  SetOutPath "$INSTDIR"
  DetailPrint "Файлуудыг хуулж байна…"
  ; хуучин програмын файлуудыг цэвэрлээд шинээр хуулна (тохиргоо, түлхүүр үлдэнэ)
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\extension"
  File /r "${STAGE}\python"
  File /r "${STAGE}\server"
  File /r "${STAGE}\extension"
  File "${STAGE}\ZAAVAR.html"
  File "${STAGE}\README.txt"
  File "${ART}\helmerch.ico"
  Delete "$INSTDIR\edition.txt"   ; хуучин «My Heart» хувилбарын тэмдэг

  ; хуучин (MongolHadmal) хувилбараас тохиргоо, түлхүүрийг шилжүүлнэ
  ${If} ${FileExists} "${OLDDIR}\*.*"
    DetailPrint "Хуучин хувилбарын тохиргоог шилжүүлж байна…"
    !insertmacro MoveOld "gemini_key.txt"
    !insertmacro MoveOld "github_token.txt"
    !insertmacro MoveOld "api_key.txt"
    !insertmacro MoveOld "settings.json"
    !insertmacro MoveOld "glossary.txt"
    !insertmacro MoveOld "usage.json"
    !insertmacro MoveOld "message.txt"
    !insertmacro MoveOld "message_shown.txt"
    ${IfNot} ${FileExists} "$INSTDIR\cache\*.*"
      CopyFiles /SILENT "${OLDDIR}\cache" "$INSTDIR"
    ${EndIf}
    DetailPrint "Хуучин хувилбарыг устгаж байна…"
    RMDir /r "${OLDDIR}"
  ${EndIf}

  ; Gemini түлхүүр
  ${If} $GeminiKey != ""
    FileOpen $0 "$INSTDIR\gemini_key.txt" w
    FileWrite $0 $GeminiKey
    FileClose $0
  ${EndIf}

  ; товчлолууд
  DetailPrint "Товчлол үүсгэж байна…"
  !insertmacro DelLinks "My Heart"
  !insertmacro DelLinks "Хэлмэрч"
  !insertmacro DelLinks "Mongol hadmal"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\server\hadmal_app.pyw"' "$INSTDIR\helmerch.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\server\hadmal_app.pyw"' "$INSTDIR\helmerch.ico"
  CreateShortcut "$SMSTARTUP\${APPNAME}.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\server\hadmal_app.pyw" --tray' "$INSTDIR\helmerch.ico"

  ; "Programs and Features" / "Apps" жагсаалтад
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\helmerch.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Видео картын хурдан горим (NVIDIA, ~1.5 ГБ татна)" SecGpu
  DetailPrint "Видео картын сангуудыг татаж байна (интернэтээс, хэдэн минут)…"
  nsExec::ExecToLog '"$INSTDIR\python\python.exe" -m pip install --disable-pip-version-check --no-warn-script-location -r "$INSTDIR\server\requirements-gpu.txt"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Видео картын сангуудыг татаж чадсангүй — дараа нь онлайн горимоор ажиллана."
  ${EndIf}
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "Програм, Chrome өргөтгөл, заавар."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecGpu} "NVIDIA видео карттай бол видеоны яриаг компьютер дээрээ маш хурдан таньна. Видео картгүй бол хэрэггүй (онлайнаар таньна)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ----------------------------------------------------------------------------- эхлэхэд
Function .onInit
  ; NVIDIA видео карт байгаа эсэх — байхгүй бол хурдан горимыг сонгохгүй
  nsExec::ExecToStack `powershell -NoProfile -Command "if ((Get-CimInstance Win32_VideoController).Name -match 'NVIDIA') {'1'} else {'0'}"`
  Pop $0
  Pop $1
  StrCpy $HasGpu $1 1
  ${If} $HasGpu != "1"
    !insertmacro UnselectSection ${SecGpu}
  ${EndIf}
  ; аль хэдийн суусан GPU сан байвал дахин татахгүй
  ${If} ${FileExists} "$INSTDIR\python\Lib\site-packages\nvidia\cublas\*.*"
    !insertmacro UnselectSection ${SecGpu}
  ${EndIf}
FunctionEnd

; ----------------------------------------------------------------------------- Gemini түлхүүрийн хуудас
Function KeyPage
  ; түлхүүр аль хэдийн байвал асуухгүй
  ${If} ${FileExists} "$INSTDIR\gemini_key.txt"
  ${OrIf} ${FileExists} "${OLDDIR}\gemini_key.txt"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Gemini түлхүүр (заавал биш)" "Сайн чанартай орчуулга, видео картгүй үед яриа таних, зургаас орчуулахад хэрэгтэй."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 44u "Google-ийн Gemini түлхүүр үнэгүй. «Түлхүүр авах» дээр дарж Google бүртгэлээрээ нэвтрээд «Create API key» дарна. Гарсан түлхүүрийг доор хуулж тавина.$\r$\n$\r$\nАлгасаж болно — дараа нь Хэлмэрчийн цонхноос оруулна."
  Pop $0
  ${NSD_CreateButton} 0 50u 110u 16u "Түлхүүр авах →"
  Pop $0
  ${NSD_OnClick} $0 OpenKeyPage
  ${NSD_CreateLabel} 0 76u 100% 10u "Gemini түлхүүр:"
  Pop $0
  ${NSD_CreateText} 0 88u 100% 13u "$GeminiKey"
  Pop $KeyEdit
  nsDialogs::Show
FunctionEnd

Function LaunchApp
  Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\server\hadmal_app.pyw"'
FunctionEnd

Function OpenKeyPage
  ExecShell "open" "https://aistudio.google.com/apikey"
FunctionEnd

Function KeyPageLeave
  ${NSD_GetText} $KeyEdit $GeminiKey
  ; хоосон зай арилгах
  ${TrimSpaces} $GeminiKey
FunctionEnd

; ----------------------------------------------------------------------------- Chrome өргөтгөлийн хуудас
Function ChromePage
  !insertmacro MUI_HEADER_TEXT "Сүүлийн алхам: Chrome өргөтгөл" "Нэг удаа хийнэ. Видео хадмал, PDF орчуулга үүгээр ажиллана."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 96u "1.  «Chrome-ийн өргөтгөлийн хуудсыг нээх» дарна.$\r$\n2.  Баруун дээд буланд «Developer mode»-ийг асаана.$\r$\n3.  «Load unpacked» дарна. Хавтас сонгох цонхны дээд хаягийн мөрөнд Ctrl+V дараад Enter, «Select Folder» дарна.$\r$\n      (Хавтасны хаяг аль хэдийн хуулагдсан.)$\r$\n4.  Хэлмэрч → Details → «Allow access to file URLs»-ийг асаана (компьютер дээрх PDF-д).$\r$\n$\r$\nӨмнө нь суулгасан бол: хуучин Хэлмэрч / My Heart өргөтгөлийг «Remove» хийгээд дээрх алхмыг давтана."
  Pop $0
  ${NSD_CreateButton} 0 104u 170u 18u "Chrome-ийн өргөтгөлийн хуудсыг нээх"
  Pop $0
  ${NSD_OnClick} $0 OpenChrome
  ${NSD_CreateButton} 176u 104u 120u 18u "Хавтасны хаягийг хуулах"
  Pop $0
  ${NSD_OnClick} $0 CopyExtPath
  ${NSD_CreateLabel} 0 128u 100% 12u "$INSTDIR\extension"
  Pop $0
  Call CopyExtPath
  nsDialogs::Show
FunctionEnd

Function OpenChrome
  StrCpy $1 ""
  ${If} ${FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    StrCpy $1 "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
    StrCpy $1 "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    StrCpy $1 "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ${EndIf}
  ${If} $1 != ""
    Exec '"$1" chrome://extensions'
  ${Else}
    MessageBox MB_OK|MB_ICONINFORMATION "Google Chrome олдсонгүй. Chrome-оо суулгаад chrome://extensions хаягаар орно уу."
  ${EndIf}
FunctionEnd

Function CopyExtPath
  StrCpy $0 "$INSTDIR\extension"
  ; clipboard руу хуулах (Unicode)
  System::Call 'user32::OpenClipboard(p 0) i'
  System::Call 'user32::EmptyClipboard() i'
  StrLen $1 $0
  IntOp $1 $1 + 1
  IntOp $1 $1 * 2
  System::Call 'kernel32::GlobalAlloc(i 0x2, i r1) p.r2'
  System::Call 'kernel32::GlobalLock(p r2) p.r3'
  System::Call 'kernel32::lstrcpyW(p r3, w r0)'
  System::Call 'kernel32::GlobalUnlock(p r2)'
  System::Call 'user32::SetClipboardData(i 13, p r2)'
  System::Call 'user32::CloseClipboard()'
FunctionEnd

; ----------------------------------------------------------------------------- устгагч
Section "Uninstall"
  SetShellVarContext current
  !insertmacro StopRunning
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$SMSTARTUP\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd

Function un.onUninstSuccess
  MessageBox MB_OK|MB_ICONINFORMATION "${APPNAME} устгагдлаа. Chrome-оос өргөтгөлийг chrome://extensions дээр «Remove» дарж устгана уу." /SD IDOK
FunctionEnd
