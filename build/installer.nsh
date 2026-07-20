!macro customCheckAppRunning
  Var /GLOBAL KunInstallerCurrentPid
  Var /GLOBAL KunInstallerStopAttempt
  Var /GLOBAL KunInstallerStopResult

  ${if} $INSTDIR == ""
    Return
  ${endif}

  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  StrCpy $KunInstallerCurrentPid $0
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_APP_ROOT", "$INSTDIR").r0'
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_SELF_PID", "$KunInstallerCurrentPid").r0'
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("KUN_INSTALLER_UNINSTALL_EXE", "${UNINSTALL_FILENAME}").r0'

  StrCpy $KunInstallerStopAttempt 0

  KunStopProcessesFromInstallDir:
    IntOp $KunInstallerStopAttempt $KunInstallerStopAttempt + 1
    DetailPrint "Checking for running ${PRODUCT_NAME} processes under $INSTDIR."
    ; taskkill 不带 /T（07-20-installer-treekill-fix）：应用内更新时本安装器是主程序的
    ; 子进程（electron-updater spawn detached），/T 树杀会连带杀死安装器自身导致
    ; 安装中途退出。目录内进程已按 ExecutablePath 逐个枚举命中，无需 /T；
    ; Windows 杀父不连子，主程序被杀后安装器成孤儿继续安装。
    nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='SilentlyContinue';$$r=[IO.Path]::GetFullPath($$env:KUN_INSTALLER_APP_ROOT).TrimEnd('\')+'\';$$s=[int]$$env:KUN_INSTALLER_SELF_PID;$$u=$$env:KUN_INSTALLER_UNINSTALL_EXE;function p{@(gcim Win32_Process|?{if(!$$_.ExecutablePath){$$false}else{$$x=[IO.Path]::GetFullPath($$_.ExecutablePath);$$n=[IO.Path]::GetFileName($$x);$$_.ProcessId -ne $$s -and $$x.StartsWith($$r,'OrdinalIgnoreCase') -and !$$n.Equals($$u,'OrdinalIgnoreCase') -and !$$n.Equals('old-uninstaller.exe','OrdinalIgnoreCase')}})};$$a=p;if($$a.Count -eq 0){exit 1};$$a|%{& $$env:SystemRoot\System32\taskkill.exe /PID $$_.ProcessId /F|Out-Null};Start-Sleep -Milliseconds 500;if((p).Count -gt 0){exit 0}else{exit 1}"`
    Pop $KunInstallerStopResult

    ${if} $KunInstallerStopResult != 0
      Goto KunInstallDirProcessesStopped
    ${endif}

    Sleep 1200
    ${if} $KunInstallerStopAttempt <= 5
      Goto KunStopProcessesFromInstallDir
    ${endif}

    !ifdef BUILD_UNINSTALLER
      ${ifNot} ${isUpdated}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY KunStopProcessesFromInstallDir
        Quit
      ${endif}
    !endif

    DetailPrint "${PRODUCT_NAME} processes may still be running; continuing with managed overwrite cleanup."

  KunInstallDirProcessesStopped:
  !ifndef BUILD_UNINSTALLER
    ${if} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      DetailPrint "Removing previous ${PRODUCT_NAME} install directory directly before overwrite install."
      SetOutPath $TEMP
      RMDir /r "$INSTDIR"
      DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}"
      !endif
      DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
    ${endif}
  !endif
!macroend

!macro kunContinueAfterOldUninstallerFailure
  ${if} $R0 != 0
    DetailPrint "Old ${PRODUCT_NAME} uninstaller returned $R0; removing $INSTDIR directly before overwrite install."
    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
    ClearErrors
    StrCpy $R0 0
  ${endif}
!macroend

!macro customUnInstallCheck
  !insertmacro kunContinueAfterOldUninstallerFailure
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro kunContinueAfterOldUninstallerFailure
!macroend
