!macro customInstall
  DetailPrint "Batto OBS Tool: lokale Handy-Verbindung freigeben"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Batto OBS Tool Mobile"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Batto OBS Tool Mobile" dir=in action=allow program="$INSTDIR\Batto OBS Tool.exe" enable=yes profile=private protocol=TCP localport=48620'
!macroend

!macro customUnInstall
  DetailPrint "Batto OBS Tool: Firewallregel entfernen"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Batto OBS Tool Mobile"'
!macroend
