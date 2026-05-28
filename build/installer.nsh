; build/installer.nsh — Custom NSIS installer script
; Additional Windows installer customizations

; Custom welcome page text
!define MUI_WELCOMEPAGE_TITLE "Welcome to Flow Kit Setup"
!define MUI_WELCOMEPAGE_TEXT "Flow Kit is an AI video production desktop app powered by Google Flow.$\r$\n$\r$\nThis wizard will guide you through the installation of Flow Kit.$\r$\n$\r$\nNote: You will also need to install the Chrome extension separately. Setup instructions will be shown after installation."

; Custom finish page
!define MUI_FINISHPAGE_TITLE "Flow Kit Installation Complete"
!define MUI_FINISHPAGE_TEXT "Flow Kit has been installed successfully.$\r$\n$\r$\nNext steps:$\r$\n$\r$\n1. Launch Flow Kit from the desktop shortcut$\r$\n2. Load the Chrome extension (chrome://extensions)$\r$\n3. Open Google Flow in Chrome"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Flow Kit.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Flow Kit now"
