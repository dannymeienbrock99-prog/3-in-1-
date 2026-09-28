!macro customInstall
  DetailPrint "Konfiguriere lokale Handy-Verbindung ..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Batto OBS Tool Mobile Bridge"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Batto OBS Tool Mobile Bridge" dir=in action=allow protocol=TCP localport=48620 profile=private program="$INSTDIR\Batto OBS Tool.exe" enable=yes'
!macroend

!macro customUnInstall
  DetailPrint "Entferne lokale Firewall-Regel ..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Batto OBS Tool Mobile Bridge"'
!macroend
