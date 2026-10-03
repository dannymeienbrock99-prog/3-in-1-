#ifndef AppSource
 #define AppSource "..\desktop\dist\win-unpacked"
#endif
#ifndef OutputPath
 #define OutputPath "..\dist"
#endif
[Setup]
AppId={{2B151B53-163C-489D-80A2-B046578C2906}
AppName=Batto 3-in-1
AppVersion=1.8.7
AppPublisher=Crazy_Batto
AppPublisherURL=https://github.com/dannymeienbrock99-prog/3-in-1-
DefaultDirName={localappdata}\Programs\CrazyBatto\BattoSuite
DefaultGroupName=Batto 3-in-1
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputPath}
OutputBaseFilename=Batto-3-in-1-Setup-1.8.7
SetupIconFile=..\desktop\src\assets\app-icon.ico
UninstallDisplayIcon={app}\Batto 3-in-1.exe
WizardStyle=modern
WizardImageFile=..\desktop\src\assets\app-installer.png
WizardSmallImageFile=..\desktop\src\assets\app-icon.png
WizardImageStretch=yes
DisableWelcomePage=no
DisableProgramGroupPage=yes
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayName=Batto 3-in-1
VersionInfoDescription=Batto 3-in-1 Installation
[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
[Tasks]
Name: "desktopicon"; Description: "Verknüpfung auf dem Desktop"; GroupDescription: "Verknüpfungen:"; Flags: unchecked
[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Batto 3-in-1"; Filename: "{app}\Batto 3-in-1.exe"; IconFilename: "{app}\resources\app-icon.ico"
Name: "{group}\Kurzanleitung"; Filename: "{app}\resources\Extras\ANLEITUNG.html"
Name: "{autodesktop}\Batto 3-in-1"; Filename: "{app}\Batto 3-in-1.exe"; IconFilename: "{app}\resources\app-icon.ico"; Tasks: desktopicon
[Run]
Filename: "{app}\resources\FanAtlas\BattoDualStream.exe"; Parameters: "--register-cameras"; Flags: runhidden waituntilterminated
Filename: "{app}\resources\FanAtlas\BattoDualStream.exe"; Parameters: "--setup-cameras"; Flags: runhidden waituntilterminated skipifsilent
Filename: "{app}\Batto 3-in-1.exe"; Description: "Batto 3-in-1 starten"; Flags: nowait postinstall skipifsilent
Filename: "{app}\resources\Extras\de.crazybatto.suite.streamDeckPlugin"; Description: "Stream-Deck-Plugin zur Installation öffnen"; Flags: shellexec nowait postinstall skipifsilent unchecked
[UninstallRun]
Filename: "{app}\resources\FanAtlas\BattoDualStream.exe"; Parameters: "--unregister-cameras"; Flags: runhidden waituntilterminated; RunOnceId: "BattoVirtualCameras"
; Einstellungen, Zugangsdaten und Nutzerlayouts bleiben bei Deinstallation erhalten.
#include "InstallerKey.iss"
