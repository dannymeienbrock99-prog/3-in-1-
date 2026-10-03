; Only the compiler process receives the local key. No key or reusable hash belongs in source control.
#define InstallerBuildPassword GetEnv("BATTO_BUILD_PASSWORD")
#if InstallerBuildPassword == ""
 #error "Protected installer requires the local build key. Use scripts/build-installer.ps1."
#endif

[Setup]
Password={#InstallerBuildPassword}
Encryption=yes

[Code]
function ClearInstallerKeyEnvironment(lpName, lpValue: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

procedure InitializeWizard;
begin
  { Local unattended updates receive the key through the environment, never command arguments. }
  WizardForm.PasswordEdit.Text := GetEnv('BATTO_INSTALL_KEY');
  ClearInstallerKeyEnvironment('BATTO_INSTALL_KEY', '');
  WizardForm.PasswordLabel.Caption := 'Bitte den Installationsschlüssel eingeben.';
end;
