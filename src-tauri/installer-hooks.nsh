; Ni CheckIfAppIsRunning (vise ${MAINBINARYNAME}.exe seul) ni la desinstallation (sautee
; en /UPDATE) n'arretent le sidecar : un tagger.exe orphelin verrouillerait son fichier.
!macro NSIS_HOOK_PREINSTALL
  ; Code de retour ignore : aucun process a tuer est le cas nominal.
  ; Sleep : Windows libere le verrou apres la fin du process, pas avec elle.
  nsis_tauri_utils::KillProcessCurrentUser "tagger.exe"
  Pop $0
  Sleep 500
!macroend

; Desinstallation reelle seulement (sautee en /UPDATE) : le meme verrou bloquerait le Delete.
!macro NSIS_HOOK_PREUNINSTALL
  nsis_tauri_utils::KillProcessCurrentUser "tagger.exe"
  Pop $0
  Sleep 500
!macroend
