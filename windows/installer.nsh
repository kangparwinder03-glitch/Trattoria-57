; Trattoria 57 for Windows: a second desktop icon that always opens the Printers & backups window.
!macro customInstall
  CreateShortCut "$DESKTOP\T57 Printers & Backups.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--printers" "$INSTDIR\resources\printers.ico" 0
  CreateShortCut "$SMPROGRAMS\T57 Printers & Backups.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--printers" "$INSTDIR\resources\printers.ico" 0
!macroend
!macro customUnInstall
  Delete "$DESKTOP\T57 Printers & Backups.lnk"
  Delete "$SMPROGRAMS\T57 Printers & Backups.lnk"
!macroend
