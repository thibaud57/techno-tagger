; Le sidecar n'est pas le binaire principal : ni CheckIfAppIsRunning, qui ne vise
; que ${MAINBINARYNAME}.exe, ni la section de desinstallation, sautee en mode
; /UPDATE, ne l'arretent. Un tagger.exe orphelin verrouille alors son fichier
; pendant que l'installeur tente de l'ecraser.
!macro NSIS_HOOK_PREINSTALL
  ; Code de retour ignore : aucun process a tuer est le cas nominal.
  ; Sleep : Windows libere le verrou de fichier apres la fin du process, pas
  ; avec elle, et l'ecrasement suit immediatement.
  nsis_tauri_utils::KillProcessCurrentUser "tagger.exe"
  Pop $0
  Sleep 500
!macroend

; Ne couvre pas le defaut ci-dessus, la section de desinstallation etant sautee
; en mode /UPDATE : celui-ci vaut pour une desinstallation reelle, ou le meme
; verrou empecherait le Delete de tagger.exe.
!macro NSIS_HOOK_PREUNINSTALL
  nsis_tauri_utils::KillProcessCurrentUser "tagger.exe"
  Pop $0
  Sleep 500
!macroend
