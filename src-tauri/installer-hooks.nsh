; Le sidecar n'est pas le binaire principal : ni CheckIfAppIsRunning, qui ne vise
; que ${MAINBINARYNAME}.exe, ni la section de desinstallation, sautee en mode
; /UPDATE, ne l'arretent. Un tagger.exe orphelin verrouille alors son fichier
; pendant que l'installeur tente de l'ecraser.
!macro NSIS_HOOK_PREINSTALL
  nsis_tauri_utils::KillProcessCurrentUser "tagger.exe"
  Pop $0
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsis_tauri_utils::KillProcessCurrentUser "tagger.exe"
  Pop $0
  Sleep 500
!macroend
