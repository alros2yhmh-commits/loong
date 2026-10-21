[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=I
InstallPrompt=%InstallPrompt%
FinishedPrompt=%FinishedPrompt%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCaption=%PostInstallCaption%
PostInstallDesc=%PostInstallDesc%
[Strings]
InstallPrompt=This will install Loong AI Agent on your computer.
FinishedPrompt=Loong has been installed. A shortcut was added to your Desktop.
TargetName=C:\Users\Hamza\Desktop\Flow\build\Loong-Setup.exe
FriendlyName=Loong AI Agent Setup
AppLaunched=setup.bat
PostInstallCaption=Loong Setup
PostInstallDesc=Installation complete.
[SourceFiles]
SourceFiles0=C:\Users\Hamza\Desktop\Flow\build
[SourceFiles0]
%FILE0%=Loong.zip
%FILE1%=setup.bat
%FILE2%=README.txt
